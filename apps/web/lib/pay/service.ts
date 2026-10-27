import "server-only";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { adminClient } from "@/lib/supabase";
import { createGatewayCheckout, enabledPayTypes, pchomepayConfigured, queryGatewayPayment, type PayType } from "./pchomepay";
import { GATEWAY_ORDER_RE, MIN_GATEWAY_AMOUNT, newGatewayOrderId, reconcileOrder, type MarkPaidResult, type ReconcileDeps, type ReconcileResult } from "./reconcile";

export type PayKind = "order" | "reg";
const ATM_EXPIRE_DAYS = 3;

export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (env) return env;
  const v = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return v ? `https://${v}` : "http://localhost:3000";
}

/** 金流是否可用：只看 PCHOMEPAY env 是否齊全（不再依賴 worker） */
export function paymentsEnabled(): boolean {
  return pchomepayConfigured();
}

export const liveDeps: ReconcileDeps = {
  async findPayment(orderId) {
    const sb = adminClient();
    if (!sb) throw new Error("db_unavailable");
    const { data, error } = await sb.from("payments").select("status").eq("gateway_order_id", orderId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { status: data.status as string } : null;
  },
  query: queryGatewayPayment,
  async markPaid(orderId, amount, payType, raw) {
    const sb = adminClient();
    if (!sb) return null;
    const { data, error } = await sb.rpc("mark_payment_paid", { p_gateway_order_id: orderId, p_amount: amount, p_pay_type: payType, p_raw: raw });
    if (error) {
      console.error("[pay] mark_payment_paid 失敗:", error.message);
      return null;
    }
    return data as MarkPaidResult;
  },
  async recordAtm(orderId, info, raw) {
    const sb = adminClient();
    if (!sb) throw new Error("db_unavailable");
    const { error } = await sb.rpc("record_atm_info", {
      p_gateway_order_id: orderId,
      p_bank_code: info.bankCode,
      p_virtual_account: info.account,
      p_expire_at: info.expireAt ? info.expireAt.toISOString() : null,
      p_raw: raw,
    });
    if (error) throw new Error(`record_atm_info 失敗：${error.message}`);
  },
  async markFailed(orderId, raw) {
    const sb = adminClient();
    if (!sb) throw new Error("db_unavailable");
    const { error } = await sb.rpc("mark_payment_failed", { p_gateway_order_id: orderId, p_raw: raw });
    if (error) throw new Error(`mark_payment_failed 失敗：${error.message}`);
  },
  async onPaid(kind) {
    try {
      if (kind === "reg") {
        revalidatePath("/events");
        revalidatePath("/");
      }
    } catch {
      /* revalidate 失敗不影響對帳 */
    }
  },
};

export async function reconcile(orderId: string, notifyType: string | null): Promise<ReconcileResult> {
  try {
    return await reconcileOrder(orderId, notifyType, liveDeps);
  } catch (err) {
    console.error("[pay] 對帳失敗:", err);
    return { http: 500, outcome: "db_failed" };
  }
}

export type CheckoutResult =
  | { ok: true; gatewayOrderId: string; paymentUrl: string }
  | { ok: false; reason: "disabled" | "below_minimum" | "db_failed" | "gateway_failed" };

/**
 * 為一筆訂單／報名開一次付款嘗試：建 payments(init) → PChomePay 建單 → 存 payment_url。
 * 失敗時把這筆付款標成 failed（不動訂單／報名本身，由呼叫端決定）。
 */
export async function startCheckout(input: {
  kind: PayKind;
  targetId: string;
  amount: number;
  payTypes: PayType[];
  itemName: string;
  itemPath: string;
  buyerEmail?: string | null;
}): Promise<CheckoutResult> {
  if (!paymentsEnabled()) return { ok: false, reason: "disabled" };
  if (input.amount < MIN_GATEWAY_AMOUNT) return { ok: false, reason: "below_minimum" };
  const allowed = enabledPayTypes();
  const payTypes = input.payTypes.filter((t) => allowed.includes(t));
  if (!payTypes.length) return { ok: false, reason: "disabled" };
  const sb = adminClient();
  if (!sb) return { ok: false, reason: "db_failed" };

  let gatewayOrderId = "";
  for (let i = 0; i < 3 && !gatewayOrderId; i++) {
    const id = newGatewayOrderId(new Date(), randomBytes(8));
    const { error } = await sb.from("payments").insert({
      gateway_order_id: id,
      order_id: input.kind === "order" ? input.targetId : null,
      registration_id: input.kind === "reg" ? input.targetId : null,
      amount: input.amount,
      pay_type: payTypes.join(","),
    });
    if (!error) gatewayOrderId = id;
    else if (error.code !== "23505") {
      console.error("[pay] 建立付款紀錄失敗:", error.message);
      return { ok: false, reason: "db_failed" };
    }
  }
  if (!gatewayOrderId) return { ok: false, reason: "db_failed" };

  const base = siteUrl();
  const checkout = await createGatewayCheckout({
    orderId: gatewayOrderId,
    amount: input.amount,
    payTypes,
    itemName: input.itemName,
    itemUrl: `${base}${input.itemPath}`,
    returnUrl: `${base}/api/pay/return/${gatewayOrderId}`,
    notifyUrl: `${base}/api/pay/pchomepay/notify`,
    buyerEmail: input.buyerEmail,
    atmExpireDays: ATM_EXPIRE_DAYS,
  });
  if (!checkout) {
    await sb.from("payments").update({ status: "failed" }).eq("gateway_order_id", gatewayOrderId).eq("status", "init");
    return { ok: false, reason: "gateway_failed" };
  }
  await sb.from("payments").update({ payment_url: checkout.paymentUrl }).eq("gateway_order_id", gatewayOrderId);
  return { ok: true, gatewayOrderId, paymentUrl: checkout.paymentUrl };
}

export interface PaymentView {
  gatewayOrderId: string;
  kind: PayKind;
  targetId: string;
  paymentStatus: "init" | "paid" | "failed";
  targetStatus: string;
  amount: number;
  payType: string | null;
  paymentUrl: string | null;
  atm: { bankCode: string | null; account: string; expireAt: string | null } | null;
  title: string;
  /** 同一筆訂單／報名之後是否已有更新的付款嘗試（舊連結不再可用） */
  superseded: boolean;
}

export async function getPaymentView(gatewayOrderId: string): Promise<PaymentView | null> {
  if (!GATEWAY_ORDER_RE.test(gatewayOrderId)) return null;
  const sb = adminClient();
  if (!sb) return null;
  const { data: p, error } = await sb
    .from("payments")
    .select("gateway_order_id,order_id,registration_id,status,amount,pay_type,payment_url,atm_bank_code,atm_virtual_account,atm_expire_at,created_at")
    .eq("gateway_order_id", gatewayOrderId)
    .maybeSingle();
  if (error || !p) return null;
  const kind: PayKind = p.order_id ? "order" : "reg";
  const targetId = (p.order_id ?? p.registration_id) as string;
  let targetStatus = "pending";
  let title = "十二星球";
  if (kind === "order") {
    const { data: o } = await sb.from("orders").select("status").eq("id", targetId).maybeSingle();
    targetStatus = (o?.status as string) ?? "cancelled";
    title = "星球寶寶訂單";
  } else {
    const { data: r } = await sb.from("registrations").select("status,events(title)").eq("id", targetId).maybeSingle();
    targetStatus = (r?.status as string) ?? "cancelled";
    const ev = (r as { events?: { title?: string } | { title?: string }[] } | null)?.events;
    const evTitle = Array.isArray(ev) ? ev[0]?.title : ev?.title;
    title = evTitle ? `聚會報名：${evTitle}` : "聚會報名";
  }
  const { count } = await sb
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq(kind === "order" ? "order_id" : "registration_id", targetId)
    .gt("created_at", p.created_at as string);
  return {
    gatewayOrderId,
    kind,
    targetId,
    paymentStatus: p.status as PaymentView["paymentStatus"],
    targetStatus,
    amount: p.amount as number,
    payType: (p.pay_type as string) ?? null,
    paymentUrl: (p.payment_url as string) ?? null,
    atm: p.atm_virtual_account
      ? { bankCode: (p.atm_bank_code as string) ?? null, account: p.atm_virtual_account as string, expireAt: (p.atm_expire_at as string) ?? null }
      : null,
    title,
    superseded: (count ?? 0) > 0,
  };
}

/** 重新付款：只有目標仍 pending、這筆嘗試未付款、且沒有仍有效的 ATM 帳號時，才開新的一筆 */
export async function retryCheckout(gatewayOrderId: string, payType: PayType): Promise<CheckoutResult | { ok: false; reason: "not_allowed" }> {
  const v = await getPaymentView(gatewayOrderId);
  if (!v || v.targetStatus !== "pending" || v.paymentStatus === "paid") return { ok: false, reason: "not_allowed" };
  if (v.atm && (!v.atm.expireAt || new Date(v.atm.expireAt).getTime() > Date.now()) && v.paymentStatus === "init") {
    return { ok: false, reason: "not_allowed" };
  }
  return startCheckout({
    kind: v.kind,
    targetId: v.targetId,
    amount: v.amount,
    payTypes: [payType],
    itemName: `十二星球｜${v.title}`,
    itemPath: v.kind === "order" ? "/shop" : "/events",
  });
}
