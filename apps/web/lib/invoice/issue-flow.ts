// 開發票的編排：claim → 打 Amego → finish / fail。純邏輯＋注入依賴（可單元測試，不可 import server-only）。
//
// 🔴 發票開出去撤不回來（財政部那邊多一張就是多一張），所以：
//   1. 先在 DB 原子 claim（planet.claim_invoice_issue），拿到才可以打 Amego
//   2. 重試（attempt > 0）前先用 OrderId 反查 Amego，上次其實開成功就「認回來」不重開
//   3. Amego OrderId 唯一（= TP 付款編號）：就算重開也會回 3040171，查回來認領，絕不開第二張
//   4. 開成功但寫回 DB 失敗 → 不標 failed（否則會被重開），回報人工
//   5. 發票失敗絕不影響「已付款」狀態；失敗留在 invoices 等排程補開
import { AMEGO_CODE_DUPLICATE_ORDER, isPermanentAmegoError, type AmegoResult, type InvoiceLine, type IssuedInvoice, type IssueInvoiceInput } from "./amego";

export type InvoiceClaim =
  | { claimed: true; attempt: number; orderRef: string; amount: number; buyerEmail: string | null; buyerName: string | null }
  | { claimed: false; reason: string; invoiceNumber?: string | null };

export interface IssueDeps {
  configured(): boolean;
  claim(paymentId: string): Promise<InvoiceClaim>;
  finish(paymentId: string, inv: { invoiceNumber: string; randomNumber: string | null; issuedAt: string | null }): Promise<boolean>;
  /** 回傳新的 retry_count */
  fail(paymentId: string, error: string, permanent: boolean): Promise<number | null>;
  loadLines(paymentId: string): Promise<InvoiceLine[] | null>;
  issue(input: IssueInvoiceInput): Promise<AmegoResult & { invoice?: IssuedInvoice }>;
  find(orderRef: string): Promise<{ ok: true; hit: { invoiceNumber: string; randomNumber: string; totalAmount: number } | null } | { ok: false; msg: string }>;
  alert(orderRef: string, message: string): Promise<void>;
}

export type IssueOutcome = { ok: true; invoiceNumber: string; adopted: boolean } | { ok: false; reason: string; permanent: boolean };

export const MAX_INVOICE_RETRIES = 10;

export async function issueForPayment(paymentId: string, deps: IssueDeps): Promise<IssueOutcome> {
  // 沒設定不是這筆的問題 → 不 claim（不燒 retry_count），留在 backlog 等設定到位
  if (!deps.configured()) return { ok: false, reason: "amego_not_configured", permanent: false };

  const c = await deps.claim(paymentId);
  if (!c.claimed) {
    if (c.reason === "already_issued") return { ok: true, invoiceNumber: c.invoiceNumber ?? "", adopted: true };
    return { ok: false, reason: c.reason, permanent: c.reason === "retries_exhausted" || c.reason === "voided" };
  }

  const failWith = async (error: string, permanent: boolean): Promise<IssueOutcome> => {
    const n = await deps.fail(paymentId, error, permanent);
    if (permanent || (n != null && n >= MAX_INVOICE_RETRIES)) {
      await deps.alert(c.orderRef, `電子發票開立失敗且不再自動重試：${error}`);
    }
    return { ok: false, reason: error, permanent };
  };

  // 認領 Amego 上既有的發票：總額必須等於實收，否則不認、轉人工（L5）
  const adopt = async (hit: { invoiceNumber: string; randomNumber: string; totalAmount: number }): Promise<IssueOutcome> => {
    if (hit.totalAmount !== c.amount) {
      return await failWith(`existing_invoice_amount_mismatch invoice=${hit.invoiceNumber} total=${hit.totalAmount} paid=${c.amount}`, true);
    }
    await deps.finish(paymentId, { invoiceNumber: hit.invoiceNumber, randomNumber: hit.randomNumber || null, issuedAt: null });
    return { ok: true, invoiceNumber: hit.invoiceNumber, adopted: true };
  };

  try {
    // 重試前先問 Amego 是不是其實已經開過
    if (c.attempt > 0) {
      const found = await deps.find(c.orderRef);
      if (found.ok && found.hit?.invoiceNumber) return await adopt(found.hit);
    }

    const lines = await deps.loadLines(paymentId);
    if (!lines || lines.length === 0) return await failWith("no_invoice_lines", true);
    const sum = lines.reduce((a, l) => a + l.amount, 0);
    if (sum !== c.amount || lines.some((l) => l.quantity * l.unitPrice !== l.amount)) {
      // 稅務憑證金額必須與實收一致，對不起來就不開，等人查
      return await failWith(`amount_mismatch lines=${sum} paid=${c.amount}`, true);
    }

    const result = await deps.issue({ orderId: c.orderRef, buyerName: c.buyerName, buyerEmail: c.buyerEmail, lines });

    if (result.ok && result.invoice?.invoiceNumber) {
      try {
        await deps.finish(paymentId, {
          invoiceNumber: result.invoice.invoiceNumber,
          randomNumber: result.invoice.randomNumber || null,
          issuedAt: result.invoice.invoiceTime ? new Date(result.invoice.invoiceTime * 1000).toISOString() : null,
        });
      } catch (err) {
        // 發票真的開出去了，只是沒記到 → 絕不可標 failed 讓它被重開
        await deps.alert(c.orderRef, `發票已開立（${result.invoice.invoiceNumber}）但寫回資料庫失敗，請人工補記：${String((err as Error)?.message ?? err).slice(0, 200)}`);
        return { ok: false, reason: "issued_but_not_recorded", permanent: true };
      }
      return { ok: true, invoiceNumber: result.invoice.invoiceNumber, adopted: false };
    }
    if (result.ok) return await failWith("ok_without_invoice_number", false);

    // OrderId 重複 = 已開過 → 查回來認領
    if (result.kind === "business" && result.code === AMEGO_CODE_DUPLICATE_ORDER) {
      const found = await deps.find(c.orderRef);
      if (found.ok && found.hit?.invoiceNumber) return await adopt(found.hit);
      return await failWith("duplicate_order_id_but_query_failed", false);
    }

    const code = result.kind === "business" ? result.code : null;
    return await failWith(`amego code=${code ?? "transport"} msg=${result.msg}`.slice(0, 400), isPermanentAmegoError(code));
  } catch (err) {
    return await failWith(`unexpected: ${String((err as Error)?.message ?? err).slice(0, 200)}`, false);
  }
}
