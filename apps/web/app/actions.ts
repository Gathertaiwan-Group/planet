"use server";

import { revalidatePath } from "next/cache";
import { isLetter, PAYMENT_OPTIONS, scorePlanet, SHIPPING_OPTIONS, type OrderItemInput } from "@planet/shared";
import { getCatalog } from "@/lib/data";
import { checkoutDetail, startCheckout } from "@/lib/pay/service";
import { adminClient } from "@/lib/supabase";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const anon = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);

/** 存測驗結果（server 端用 DB 題目重新計分） */
export async function saveQuizResult(input: { answers: string[]; anonId: string | null }): Promise<{ ok: boolean; planetId?: number }> {
  const answers = Array.isArray(input?.answers) ? input.answers : [];
  if (!answers.every(isLetter)) return { ok: false };
  const catalog = await getCatalog();
  if (answers.length !== catalog.questions.length) return { ok: false };
  const planetId = scorePlanet(answers, catalog.questions, catalog.planets.map((p) => p.id));
  const sb = adminClient();
  if (!sb) return { ok: true, planetId };
  const { error } = await sb.from("quiz_results").insert({ anon_id: anon(input.anonId), answers, planet_id: planetId });
  if (error) console.error("[quiz] insert failed", error.message);
  return { ok: !error, planetId };
}

/** manualPay：需付款但無法線上付（金流未設定）→ 人工聯繫收費 */
export type RegisterResult =
  | { ok: true; seatsLeft: number; amount: number; redirectUrl: string | null; manualPay: boolean }
  | { ok: false; error: string; seatsLeft?: number };

const REG_ERRORS: Record<string, string> = {
  sold_out: "這場已經額滿了，看看其他場次吧。",
  duplicate: "這個 Email 已經報名過這場囉。",
  event_closed: "這場活動已截止報名。",
  event_not_found: "找不到這場活動。",
};

export async function registerEvent(input: {
  eventId: string;
  nickname: string;
  /** Email（必填；電子發票與行前通知寄這裡） */
  contact: string;
  /** 手機（選填） */
  phone?: string;
  planetId: number | null;
  issue: string;
  anonId: string | null;
}): Promise<RegisterResult> {
  const nickname = str(input?.nickname, 40);
  const contact = str(input?.contact, 100);
  const issue = str(input?.issue, 1000);
  const eventId = str(input?.eventId, 40);
  const planetId = Number.isInteger(input?.planetId) && input.planetId! >= 1 && input.planetId! <= 12 ? input.planetId : null;
  if (!nickname) return { ok: false, error: "請填寫暱稱。" };
  // M3：Email 必填（B2C 電子發票沒有載具時要寄到 Email），手機選填
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return { ok: false, error: "請填寫正確的 Email（電子發票與行前通知會寄到這裡）。" };
  const email = contact.toLowerCase();
  const phoneRaw = str(input?.phone, 20).replace(/[\s-]/g, "");
  if (phoneRaw && !/^\+?\d{8,15}$/.test(phoneRaw)) return { ok: false, error: "手機號碼格式不正確（可留空）。" };
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return { ok: false, error: "目前無法報名，請稍後再試。" };

  const sb = adminClient();
  if (!sb) return { ok: false, error: "目前無法報名，請稍後再試。" };
  const { data, error } = await sb.rpc("register_for_event", {
    p_event_id: eventId,
    p_nickname: nickname,
    p_contact: email,
    p_planet_id: planetId,
    p_issue: issue,
    p_anon_id: anon(input.anonId),
  });
  if (error) {
    const code = Object.keys(REG_ERRORS).find((k) => error.message?.includes(k)) ?? (error.code === "23505" ? "duplicate" : "");
    if (!code) console.error("[register] rpc failed", error.message);
    let seatsLeft: number | undefined;
    if (code === "sold_out") seatsLeft = 0;
    return { ok: false, error: REG_ERRORS[code] ?? "報名沒有成功，請稍後再試。", seatsLeft };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { registration_id: string; amount_twd: number; seats_left: number };
  if (phoneRaw) {
    const { error: pe } = await sb.from("registrations").update({ phone: phoneRaw }).eq("id", row.registration_id);
    if (pe) console.error("[register] 手機寫入失敗", pe.message);
  }
  revalidatePath("/events");
  revalidatePath("/");
  if (row.amount_twd <= 0) return { ok: true, seatsLeft: row.seats_left, amount: 0, redirectUrl: null, manualPay: false };

  const co = await startCheckout({
    kind: "reg",
    targetId: row.registration_id,
    amount: row.amount_twd,
    detail: await checkoutDetail("reg", row.registration_id),
    buyerEmail: email,
  });
  if (co.ok) return { ok: true, seatsLeft: row.seats_left, amount: row.amount_twd, redirectUrl: `/api/pay/go/${co.gatewayOrderId}`, manualPay: false };
  if (co.reason === "disabled" || co.reason === "below_minimum") {
    return { ok: true, seatsLeft: row.seats_left, amount: row.amount_twd, redirectUrl: null, manualPay: true };
  }
  // 付款頁開不起來 → 取消這筆報名（釋出座位、可立刻重報），請使用者稍後再試
  await sb.from("registrations").update({ status: "cancelled" }).eq("id", row.registration_id).eq("status", "pending");
  revalidatePath("/events");
  revalidatePath("/");
  return { ok: false, error: "付款頁暫時打不開，報名沒有成立，請稍後再試一次。", seatsLeft: row.seats_left + 1 };
}

export type OrderResult =
  | { ok: true; orderId: string; total: number; redirectUrl: string | null; manualPay: boolean }
  | { ok: false; error: string };

const ORDER_ERRORS: Record<string, string> = {
  empty_cart: "購物車是空的。",
  invalid_item: "購物車裡有商品已下架，請重新挑選。",
  invalid_qty: "數量不正確。",
  too_many_items: "品項太多了，請分開下單。",
};

export async function createOrder(input: {
  recipient: string;
  phone: string;
  email: string;
  shipping: string;
  payment: string;
  items: OrderItemInput[];
  anonId: string | null;
}): Promise<OrderResult> {
  const recipient = str(input?.recipient, 40);
  const phone = str(input?.phone, 20).replace(/[\s-]/g, "");
  if (!recipient) return { ok: false, error: "請填寫收件人。" };
  if (!/^\+?\d{8,15}$/.test(phone)) return { ok: false, error: "請填寫正確的手機號碼。" };
  const email = str(input?.email, 100).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "請填寫正確的 Email（電子發票會寄到這裡）。" };
  if (!(SHIPPING_OPTIONS as readonly string[]).includes(input?.shipping)) return { ok: false, error: "請選擇取貨方式。" };
  if (!(PAYMENT_OPTIONS as readonly string[]).includes(input?.payment)) return { ok: false, error: "請選擇付款方式。" };
  const raw = Array.isArray(input?.items) ? input.items.slice(0, 50) : [];
  const items: OrderItemInput[] = [];
  for (const it of raw) {
    const qty = Number(it?.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return { ok: false, error: ORDER_ERRORS.invalid_qty };
    if (it?.kind === "baby" && Number.isInteger(it.planet_id) && Number.isInteger(it.plant_id)) {
      items.push({ kind: "baby", planet_id: it.planet_id, plant_id: it.plant_id, qty });
    } else if (it?.kind === "extra" && typeof it.sku === "string" && it.sku.length <= 40) {
      items.push({ kind: "extra", sku: it.sku, qty });
    } else return { ok: false, error: ORDER_ERRORS.invalid_item };
  }
  if (!items.length) return { ok: false, error: ORDER_ERRORS.empty_cart };

  const sb = adminClient();
  if (!sb) return { ok: false, error: "目前無法下單，請稍後再試。" };
  const { data, error } = await sb.rpc("create_order", {
    p_recipient: recipient,
    p_phone: phone,
    p_shipping: input.shipping,
    p_payment: input.payment,
    p_items: items,
    p_anon_id: anon(input.anonId),
  });
  if (error) {
    const code = Object.keys(ORDER_ERRORS).find((k) => error.message?.includes(k));
    if (!code) console.error("[order] rpc failed", error.message);
    return { ok: false, error: code ? ORDER_ERRORS[code] : "下單沒有成功，請稍後再試。" };
  }
  const row = (Array.isArray(data) ? data[0] : data) as { order_id: string; total_twd: number };
  if (row.total_twd <= 0) return { ok: true, orderId: row.order_id, total: 0, redirectUrl: null, manualPay: false };

  const co = await startCheckout({
    kind: "order",
    targetId: row.order_id,
    amount: row.total_twd,
    detail: await checkoutDetail("order", row.order_id),
    buyerEmail: email,
    buyerName: recipient,
  });
  if (co.ok) return { ok: true, orderId: row.order_id, total: row.total_twd, redirectUrl: `/api/pay/go/${co.gatewayOrderId}`, manualPay: false };
  if (co.reason === "over_maximum") {
    await sb.from("orders").update({ status: "cancelled" }).eq("id", row.order_id).eq("status", "pending");
    return { ok: false, error: "單筆金額超過線上刷卡上限 NT$100,000，請分開下單。" };
  }
  if (co.reason === "disabled" || co.reason === "below_minimum") {
    return { ok: true, orderId: row.order_id, total: row.total_twd, redirectUrl: null, manualPay: true };
  }
  // 付款頁開不起來 → 取消這張訂單（購物車保留），請使用者再試一次
  await sb.from("orders").update({ status: "cancelled" }).eq("id", row.order_id).eq("status", "pending");
  return { ok: false, error: "付款頁暫時打不開，訂單沒有成立，請稍後再試一次（購物車還在）。" };
}
