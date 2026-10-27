import "server-only";
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { triggerInvoiceAfterPayment } from "@/lib/invoice/issuer";
import { sendAdminAlert } from "@/lib/mail";
import { adminClient } from "@/lib/supabase";
import { blackcatApnUrl, blackcatConfigured, blackcatSandbox, createGatewayCheckout, queryGatewayPayment } from "./blackcat";
import { MAX_ORDER_AMOUNT } from "./blackcat-core";
import { GATEWAY_ORDER_RE, gatewayBlocksRetry, MIN_GATEWAY_AMOUNT, newGatewayOrderId, reconcileOrder, type MarkPaidResult, type ReconcileDeps, type ReconcileOpts, type ReconcileResult } from "./reconcile";

export type PayKind = "order" | "reg";

export function siteUrl(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "");
  if (env) return env;
  const v = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return v ? `https://${v}` : "http://localhost:3000";
}

/** 金流是否可用：黑貓PAY 帳密＋APN 密鑰齊全 */
export function paymentsEnabled(): boolean {
  return blackcatConfigured();
}

/** 同單號回查節流秒數 */
const CHECK_MIN_SECONDS = 10;

const ATTENTION_TEXT: Record<string, string> = {
  amount_mismatch: "黑貓PAY 實收金額（APN pay_amount）缺漏或與訂單金額不符（未標記付款）",
  paid_after_cancel: "訂單／報名已取消後才收到款項（需退款或恢復）",
  duplicate_payment: "同一筆訂單／報名重複付款（需退款其中一筆）",
  authorized_without_apn: "黑貓PAY 回查顯示已授權，但超過 30 分鐘沒收到 APN 通知（沒有實收金額可核對，未標記付款）——請到黑貓PAY 後台核對並用「APN 補發」",
  capture_failed: "黑貓PAY 請款失敗（process_code 23）",
  reversal_M: "黑貓PAY 回報「取消交易完成」，但本站仍為已付款（錢已退回，訂單／報名與發票需人工處理）",
  reversal_Q: "黑貓PAY 回報「取消授權完成」，但本站仍為已付款（錢已退回，訂單／報名與發票需人工處理）",
  reversal_P: "黑貓PAY 回報「請款失敗」，但本站仍為已付款",
};

function db() {
  const sb = adminClient();
  if (!sb) throw new Error("db_unavailable");
  return sb;
}

export async function alertAttention(orderId: string, reason: string, info: { kind?: string; amount?: number | null }): Promise<void> {
  const what = ATTENTION_TEXT[reason] ?? reason;
  const kind = info.kind === "reg" ? "聚會報名" : info.kind === "order" ? "購物訂單" : "";
  const ok = await sendAdminAlert(
    `【十二星球】付款需人工處理：${orderId}`,
    [
      `付款編號：${orderId}`,
      kind ? `類型：${kind}` : "",
      `狀況：${what}`,
      info.amount != null ? `APN 實收金額：NT$ ${info.amount}` : "",
      `環境：${blackcatSandbox() ? "sandbox（測試機）" : "正式"}`,
      "",
      `請到 Supabase planet.payments 查 gateway_order_id = ${orderId}（needs_attention 欄位），必要時到黑貓PAY 後台（www.ccat.com.tw）處理退款。`,
      `付款結果頁：${siteUrl()}/pay/${orderId}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  if (!ok) console.error(`[pay] needs_attention 通知未寄出：${orderId} ${reason}`);
}

export async function flagAttention(orderId: string, reason: string): Promise<boolean> {
  const { data, error } = await db().rpc("flag_payment_attention", { p_gateway_order_id: orderId, p_reason: reason });
  if (error) throw new Error(`flag_payment_attention 失敗：${error.message}`);
  return data === true;
}

export const liveDeps: ReconcileDeps = {
  async claimCheck(orderId) {
    const { data, error } = await db().rpc("claim_payment_check", { p_gateway_order_id: orderId, p_min_seconds: CHECK_MIN_SECONDS });
    if (error) throw new Error(`claim_payment_check 失敗：${error.message}`);
    return data === true;
  },
  async recordCheck(orderId, gatewayStatus) {
    const { error } = await db().rpc("record_payment_check", { p_gateway_order_id: orderId, p_gateway_status: gatewayStatus ?? "" });
    if (error) throw new Error(`record_payment_check 失敗：${error.message}`);
  },
  alertAttention,
  async findPayment(orderId) {
    const { data, error } = await db().from("payments").select("status,created_at").eq("gateway_order_id", orderId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { status: data.status as string, createdAt: data.created_at as string } : null;
  },
  query: queryGatewayPayment,
  async storedApnAmount(orderId) {
    const { data, error } = await db()
      .from("payment_events")
      .select("trans_id,pay_amount,created_at")
      .eq("provider", "blackcat")
      .eq("gateway_order_id", orderId)
      .in("status_code", ["B", "O", "E"])
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) throw new Error(`讀取 payment_events 失敗：${error.message}`);
    const row = data?.[0];
    return row ? { amount: row.pay_amount == null ? null : Number(row.pay_amount), transId: String(row.trans_id) } : null;
  },
  async markPaid(orderId, amount, transId, raw) {
    const { data, error } = await db().rpc("mark_blackcat_paid", { p_gateway_order_id: orderId, p_amount: amount, p_trans_id: transId, p_raw: raw });
    if (error) {
      console.error("[pay] mark_blackcat_paid 失敗:", error.message);
      return null;
    }
    return data as MarkPaidResult;
  },
  async markFailed(orderId, raw) {
    const { error } = await db().rpc("mark_payment_failed", { p_gateway_order_id: orderId, p_raw: raw });
    if (error) throw new Error(`mark_payment_failed 失敗：${error.message}`);
  },
  flagAttention,
  async onPaid(kind, _targetId, paymentId) {
    try {
      if (kind === "reg") {
        revalidatePath("/events");
        revalidatePath("/");
      }
    } catch {
      /* revalidate 失敗不影響對帳 */
    }
    // 自動開發票：失敗只留在 invoices 等排程補開，不影響已付款
    if (paymentId) {
      const r = await triggerInvoiceAfterPayment(paymentId);
      if (!r.ok) console.warn(`[pay] 發票尚未開出（${r.reason}），已列入補開清單`);
    }
  },
};

export async function reconcile(orderId: string, source: string | null, opts: ReconcileOpts = { throttle: true }): Promise<ReconcileResult> {
  try {
    return await reconcileOrder(orderId, source, liveDeps, opts);
  } catch (err) {
    console.error("[pay] 對帳失敗:", err);
    return { http: 500, outcome: "db_failed" };
  }
}

export type CheckoutResult =
  | { ok: true; gatewayOrderId: string; paymentUrl: string }
  | { ok: false; reason: "disabled" | "below_minimum" | "over_maximum" | "db_failed" | "gateway_failed" | "misconfigured" };

/**
 * 為一筆訂單／報名開一次付款嘗試：建 payments(init) → 黑貓PAY 建單 → 存刷卡頁網址。
 * 失敗時把這筆付款標成 failed（不動訂單／報名本身，由呼叫端決定）。
 */
export async function startCheckout(input: {
  kind: PayKind;
  targetId: string;
  amount: number;
  detail: string;
  buyerEmail?: string | null;
  buyerName?: string | null;
}): Promise<CheckoutResult> {
  if (!paymentsEnabled()) return { ok: false, reason: "disabled" };
  // 正式環境沒設 NEXT_PUBLIC_SITE_URL → APN／導回網址不可靠，拒絕建單
  if (process.env.VERCEL_ENV === "production" && !process.env.NEXT_PUBLIC_SITE_URL?.trim()) {
    console.error("[pay] production 缺 NEXT_PUBLIC_SITE_URL，拒絕建單");
    return { ok: false, reason: "misconfigured" };
  }
  if (input.amount < MIN_GATEWAY_AMOUNT) return { ok: false, reason: "below_minimum" };
  if (input.amount > MAX_ORDER_AMOUNT) return { ok: false, reason: "over_maximum" };
  const base = siteUrl();
  const apnUrl = blackcatApnUrl(base);
  if (!apnUrl) {
    console.error("[pay] APN 網址組不出來（site url 非 https 或缺 BLACKCAT_WEBHOOK_SECRET），拒絕建單");
    return { ok: false, reason: "misconfigured" };
  }
  const sb = adminClient();
  if (!sb) return { ok: false, reason: "db_failed" };

  let gatewayOrderId = "";
  for (let i = 0; i < 3 && !gatewayOrderId; i++) {
    const id = newGatewayOrderId(new Date(), randomBytes(8));
    const { error } = await sb.from("payments").insert({
      gateway: "blackcat",
      gateway_order_id: id,
      order_id: input.kind === "order" ? input.targetId : null,
      registration_id: input.kind === "reg" ? input.targetId : null,
      amount: input.amount,
      pay_type: "CARD",
      buyer_email: input.buyerEmail || null,
      buyer_name: input.buyerName || null,
    });
    if (!error) gatewayOrderId = id;
    else if (error.code !== "23505") {
      console.error("[pay] 建立付款紀錄失敗:", error.message);
      return { ok: false, reason: "db_failed" };
    }
  }
  if (!gatewayOrderId) return { ok: false, reason: "db_failed" };

  const checkout = await createGatewayCheckout({
    orderId: gatewayOrderId,
    amount: input.amount,
    detail: input.detail,
    apnUrl,
    successUrl: `${base}/api/pay/return/${gatewayOrderId}`,
  });
  if (!checkout) {
    await sb.from("payments").update({ status: "failed" }).eq("gateway_order_id", gatewayOrderId).eq("status", "init");
    return { ok: false, reason: "gateway_failed" };
  }
  await sb.from("payments").update({ payment_url: checkout.paymentUrl }).eq("gateway_order_id", gatewayOrderId);
  return { ok: true, gatewayOrderId, paymentUrl: checkout.paymentUrl };
}

/** order_detail（必填、無 HTML）：訂單用品項，報名用活動名稱 */
export async function checkoutDetail(kind: PayKind, targetId: string): Promise<string> {
  const sb = adminClient();
  if (!sb) return kind === "order" ? "十二星球 星球寶寶訂單" : "十二星球 聚會報名費";
  if (kind === "order") {
    const { data } = await sb.from("order_items").select("name,qty").eq("order_id", targetId);
    const items = (data ?? []).map((it) => `${String(it.name)} x${Number(it.qty)}`).join("、");
    return items ? `十二星球 ${items}` : "十二星球 星球寶寶訂單";
  }
  const { data } = await sb.from("registrations").select("events(title)").eq("id", targetId).maybeSingle();
  const ev = (data as { events?: { title?: string } | { title?: string }[] } | null)?.events;
  const title = Array.isArray(ev) ? ev[0]?.title : ev?.title;
  return title ? `十二星球 聚會報名費：${title}` : "十二星球 聚會報名費";
}

export interface PaymentView {
  gatewayOrderId: string;
  kind: PayKind;
  targetId: string;
  paymentStatus: "init" | "paid" | "failed";
  targetStatus: string;
  amount: number;
  paymentUrl: string | null;
  title: string;
  /** 同一筆訂單／報名之後是否已有更新的付款嘗試（舊連結不再可用） */
  superseded: boolean;
  /** 最近一次回查的黑貓PAY process_code（字串） */
  gatewayStatus: string | null;
  needsAttention: string | null;
  /** 報名已逾時（保留期滿、已回查確認未付）→ 請重新報名 */
  regStale: boolean;
  buyerEmail: string | null;
  buyerName: string | null;
}

export async function getPaymentView(gatewayOrderId: string): Promise<PaymentView | null> {
  if (!GATEWAY_ORDER_RE.test(gatewayOrderId)) return null;
  const sb = adminClient();
  if (!sb) return null;
  const { data: p, error } = await sb
    .from("payments")
    .select("gateway_order_id,order_id,registration_id,status,amount,payment_url,created_at,gateway_status,needs_attention,buyer_email,buyer_name")
    .eq("gateway_order_id", gatewayOrderId)
    .maybeSingle();
  if (error || !p) return null;
  const kind: PayKind = p.order_id ? "order" : "reg";
  const targetId = (p.order_id ?? p.registration_id) as string;
  let targetStatus = "pending";
  let title = "十二星球";
  let regStale = false;
  if (kind === "order") {
    const { data: o } = await sb.from("orders").select("status").eq("id", targetId).maybeSingle();
    targetStatus = (o?.status as string) ?? "cancelled";
    title = "星球寶寶訂單";
  } else {
    const { data: r } = await sb.from("registrations").select("status,created_at,events(title)").eq("id", targetId).maybeSingle();
    targetStatus = (r?.status as string) ?? "cancelled";
    if (r && targetStatus === "pending") {
      const { data: st } = await sb.rpc("registration_is_stale", { p_reg_id: targetId, p_created_at: r.created_at });
      regStale = st === true;
    }
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
    paymentUrl: (p.payment_url as string) ?? null,
    title,
    superseded: (count ?? 0) > 0,
    gatewayStatus: (p.gateway_status as string) ?? null,
    needsAttention: (p.needs_attention as string) ?? null,
    regStale,
    buyerEmail: (p.buyer_email as string) ?? null,
    buyerName: (p.buyer_name as string) ?? null,
  };
}

export type RetryRejectReason = "not_allowed" | "superseded" | "attention" | "in_progress" | "expired" | "check_failed";

/**
 * 重新付款（開新的付款嘗試）。拒絕條件：
 *   - 目標不是 pending、這筆已付款、已被更新的嘗試取代、有 needs_attention
 *   - 同目標任何 init 嘗試即時回查為已授權／請款中／請款失敗（避免重複扣款）；回查失敗也拒絕
 *   - 報名已逾時（請重新報名）
 */
export async function retryCheckout(gatewayOrderId: string): Promise<CheckoutResult | { ok: false; reason: RetryRejectReason }> {
  const v = await getPaymentView(gatewayOrderId);
  if (!v || v.targetStatus !== "pending" || v.paymentStatus === "paid") return { ok: false, reason: "not_allowed" };
  if (v.superseded) return { ok: false, reason: "superseded" };
  if (v.needsAttention) return { ok: false, reason: "attention" };

  const sb = adminClient();
  if (!sb) return { ok: false, reason: "check_failed" };
  const col = v.kind === "order" ? "order_id" : "registration_id";
  const { data: inits, error } = await sb.from("payments").select("gateway_order_id").eq(col, v.targetId).eq("status", "init");
  if (error) return { ok: false, reason: "check_failed" };
  for (const row of inits ?? []) {
    const r = await reconcile(row.gateway_order_id as string, "retry_check", { throttle: false });
    if (r.http !== 200) return { ok: false, reason: "check_failed" };
  }
  const { data: all, error: e2 } = await sb.from("payments").select("status,gateway_status,needs_attention").eq(col, v.targetId);
  if (e2) return { ok: false, reason: "check_failed" };
  for (const p of all ?? []) {
    if (p.status === "paid" || p.needs_attention) return { ok: false, reason: "in_progress" };
    if (p.status === "init" && gatewayBlocksRetry(p.gateway_status as string | null)) return { ok: false, reason: "in_progress" };
  }
  const fresh = await getPaymentView(gatewayOrderId);
  if (!fresh || fresh.targetStatus !== "pending") return { ok: false, reason: "not_allowed" };
  if (fresh.regStale) return { ok: false, reason: "expired" };

  return startCheckout({
    kind: v.kind,
    targetId: v.targetId,
    amount: v.amount,
    detail: await checkoutDetail(v.kind, v.targetId),
    buyerEmail: v.buyerEmail,
    buyerName: v.buyerName,
  });
}

/** 定期對帳（pg_cron 每 10 分鐘觸發）——近 7 天所有 init 付款嘗試逐筆回查 */
export async function reconcileOpenPayments(limit = 100): Promise<Record<string, number>> {
  const since = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data, error } = await db()
    .from("payments")
    .select("gateway_order_id")
    .eq("status", "init")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  const counts: Record<string, number> = { checked: 0 };
  for (const row of data ?? []) {
    const r = await reconcile(row.gateway_order_id as string, "cron", { throttle: true });
    counts.checked += 1;
    counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  }
  return counts;
}
