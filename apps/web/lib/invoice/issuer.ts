import "server-only";
import { sendAdminAlert } from "@/lib/mail";
import { adminClient } from "@/lib/supabase";
import { amegoConfigured, findInvoiceByOrderId, issueInvoice, type InvoiceLine } from "./amego";
import { issueForPayment, MAX_INVOICE_RETRIES, type IssueDeps, type IssueOutcome } from "./issue-flow";

// 付款成功後自動開立電子發票（B2C，賣方 好日子股份有限公司 AMEGO_INVOICE_BAN）。
// 觸發點：mark_blackcat_paid() 轉 paid 時在同一交易建立 invoices(pending) → onPaid() 立即嘗試；失敗由 reconcile-cron 每 10 分補開。

function db() {
  const sb = adminClient();
  if (!sb) throw new Error("db_unavailable");
  return sb;
}

async function loadLines(paymentId: string): Promise<InvoiceLine[] | null> {
  const sb = db();
  const { data: p, error } = await sb.from("payments").select("order_id,registration_id").eq("id", paymentId).maybeSingle();
  if (error || !p) return null;
  if (p.order_id) {
    const { data: items, error: e2 } = await sb.from("order_items").select("name,sub,unit_price_twd,qty").eq("order_id", p.order_id).order("id");
    if (e2 || !items) return null;
    return items.map((it) => ({
      description: `十二星球 ${String(it.name)}${it.sub ? `（${String(it.sub)}）` : ""}`,
      quantity: Number(it.qty),
      unitPrice: Number(it.unit_price_twd),
      amount: Number(it.qty) * Number(it.unit_price_twd),
    }));
  }
  const { data: r, error: e3 } = await sb.from("registrations").select("amount_twd,events(title)").eq("id", p.registration_id).maybeSingle();
  if (e3 || !r) return null;
  const ev = (r as { events?: { title?: string } | { title?: string }[] }).events;
  const title = Array.isArray(ev) ? ev[0]?.title : ev?.title;
  const amt = Number(r.amount_twd);
  return [{ description: `十二星球聚會報名費${title ? `：${title}` : ""}`, quantity: 1, unitPrice: amt, amount: amt }];
}

export const liveIssueDeps: IssueDeps = {
  configured: amegoConfigured,
  async claim(paymentId) {
    const { data, error } = await db().rpc("claim_invoice_issue", { p_payment_id: paymentId, p_max_retries: MAX_INVOICE_RETRIES });
    if (error) throw new Error(`claim_invoice_issue 失敗：${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as {
      claimed: boolean;
      reason: string;
      attempt: number;
      order_ref: string;
      amount: number;
      buyer_email: string | null;
      buyer_name: string | null;
      invoice_number: string | null;
    };
    if (!row) return { claimed: false, reason: "not_found" };
    return row.claimed
      ? { claimed: true, attempt: row.attempt, orderRef: row.order_ref, amount: row.amount, buyerEmail: row.buyer_email, buyerName: row.buyer_name }
      : { claimed: false, reason: row.reason, invoiceNumber: row.invoice_number };
  },
  async finish(paymentId, inv) {
    const { data, error } = await db().rpc("finish_invoice_issue", {
      p_payment_id: paymentId,
      p_invoice_number: inv.invoiceNumber,
      p_random_number: inv.randomNumber,
      p_issued_at: inv.issuedAt,
    });
    if (error) throw new Error(`finish_invoice_issue 失敗：${error.message}`);
    return data === true;
  },
  async fail(paymentId, err, permanent) {
    const { data, error } = await db().rpc("fail_invoice_issue", { p_payment_id: paymentId, p_error: err, p_permanent: permanent, p_max_retries: MAX_INVOICE_RETRIES });
    if (error) {
      console.error("[invoice] fail_invoice_issue 失敗:", error.message);
      return null;
    }
    console.error(`[invoice] 開立失敗 payment=${paymentId} permanent=${permanent} ${err}`);
    return typeof data === "number" ? data : null;
  },
  loadLines,
  issue: issueInvoice,
  find: findInvoiceByOrderId,
  async alert(orderRef, message) {
    await sendAdminAlert(`【十二星球】電子發票需人工處理：${orderRef}`, [`付款編號：${orderRef}`, message, "", "請到 Supabase planet.invoices 查 order_ref，必要時到光貿 Amego 後台處理。"].join("\n"));
  },
};

/** 開一筆付款的發票。永不 throw（失敗都記在 invoices） */
export async function issueInvoiceForPayment(paymentId: string): Promise<IssueOutcome> {
  try {
    return await issueForPayment(paymentId, liveIssueDeps);
  } catch (err) {
    console.error("[invoice] 開立流程例外:", err);
    return { ok: false, reason: "unexpected_error", permanent: false };
  }
}

/** 付款後立即觸發，限時（逾時交給排程補開，不拖垮 APN 回應） */
export async function triggerInvoiceAfterPayment(paymentId: string, timeoutMs = 8_000): Promise<IssueOutcome> {
  const timeout = new Promise<IssueOutcome>((resolve) => setTimeout(() => resolve({ ok: false, reason: "invoice_timeout", permanent: false }), timeoutMs));
  return Promise.race([issueInvoiceForPayment(paymentId), timeout]);
}

/** 補開待開清單（排程每 10 分鐘） */
export async function runInvoiceBacklog(limit = 10): Promise<Record<string, number>> {
  const out: Record<string, number> = { invoice_scanned: 0, invoice_issued: 0, invoice_failed: 0 };
  if (!amegoConfigured()) return out;
  const { data, error } = await db().rpc("invoice_backlog", { p_limit: limit, p_max_retries: MAX_INVOICE_RETRIES });
  if (error) throw new Error(`invoice_backlog 失敗：${error.message}`);
  for (const row of (data ?? []) as { payment_id: string }[]) {
    out.invoice_scanned += 1;
    const r = await issueInvoiceForPayment(row.payment_id);
    if (r.ok) out.invoice_issued += 1;
    else out.invoice_failed += 1;
  }
  return out;
}
