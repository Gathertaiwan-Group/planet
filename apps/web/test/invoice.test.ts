import { afterEach, describe, expect, it, vi } from "vitest";
import {
  amegoRequest,
  amegoSign,
  amegoTransport,
  buildAmegoBody,
  buildIssuePayload,
  isPermanentAmegoError,
  parseAmegoResponse,
  type AmegoResult,
  type InvoiceLine,
  type IssuedInvoice,
} from "../lib/invoice/amego";
import { issueForPayment, MAX_INVOICE_RETRIES, type InvoiceClaim, type IssueDeps } from "../lib/invoice/issue-flow";

const LINES: InvoiceLine[] = [
  { description: "十二星球 水星寶寶（綠蘿 × 星球套組）", quantity: 1, unitPrice: 530, amount: 530 },
  { description: "十二星球 貼紙組", quantity: 1, unitPrice: 150, amount: 150 },
];

describe("Amego 協定", () => {
  it("sign = md5(data JSON + time + AppKey)，body 四欄位", () => {
    const body = buildAmegoBody({ ban: "12345678", dataJson: '{"a":1}', time: 1700000000, appKey: "k" });
    expect(body.get("invoice")).toBe("12345678");
    expect(body.get("data")).toBe('{"a":1}');
    expect(body.get("sign")).toBe(amegoSign('{"a":1}', 1700000000, "k"));
    expect(body.get("sign")).toMatch(/^[0-9a-f]{32}$/);
  });
  it("B2C 開立：稅額 0、總額 = 明細加總、買受人 0000000000、帶 email", () => {
    const p = buildIssuePayload({ orderId: "TP261027ABCD2345", buyerName: "王小明", buyerEmail: "a@b.co", lines: LINES });
    expect(p).toMatchObject({ OrderId: "TP261027ABCD2345", BuyerIdentifier: "0000000000", BuyerName: "王小明", SalesAmount: "680", TaxAmount: "0", TotalAmount: "680", BuyerEmailAddress: "a@b.co" });
    expect(buildIssuePayload({ orderId: "x", lines: LINES }).BuyerName).toBe("消費者");
  });
  it("🔴 transport 誤判：中繼回 JSON 但沒有 number code → transport（可重試），不是永久失敗", () => {
    const r = parseAmegoResponse(404, '{"error":"path_not_allowed"}');
    expect(r).toMatchObject({ ok: false, kind: "transport", code: null });
    expect((r as { msg: string }).msg).toContain("http=404");
    expect(isPermanentAmegoError(r.ok ? 0 : r.code)).toBe(false);
    expect(parseAmegoResponse(401, '{"error":"unauthorized"}')).toMatchObject({ kind: "transport" });
    expect(parseAmegoResponse(200, "<html>WAF</html>")).toMatchObject({ kind: "transport" });
    expect(parseAmegoResponse(200, '{"code":"0"}')).toMatchObject({ kind: "transport" });
  });
  it("業務錯誤碼：15 可重試，其餘永久；code 0 成功", () => {
    expect(parseAmegoResponse(200, '{"code":0,"msg":""}').ok).toBe(true);
    expect(parseAmegoResponse(200, '{"code":3040178,"msg":"x"}')).toMatchObject({ kind: "business", code: 3040178 });
    expect(isPermanentAmegoError(15)).toBe(false);
    expect(isPermanentAmegoError(16)).toBe(true);
    expect(isPermanentAmegoError(null)).toBe(false);
    expect(isPermanentAmegoError(undefined)).toBe(false);
  });
});

describe("Amego 中繼傳輸", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("設了中繼 → 打中繼並帶 x-relay-secret；sign 在本地算、AppKey 不出現在送出的 header", async () => {
    vi.stubEnv("AMEGO_INVOICE_BAN", "53912857");
    vi.stubEnv("AMEGO_APP_KEY", "APPKEY-xyz");
    vi.stubEnv("AMEGO_RELAY_URL", "https://relay.example.com/");
    vi.stubEnv("AMEGO_RELAY_SECRET", "relay-secret");
    const fetchMock = vi.fn(async () => new Response('{"code":71,"msg":"查無資料"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await amegoRequest("/json/invoice_query", { type: "order", order_id: "TP000000PROBE000" });
    expect(r).toMatchObject({ ok: false, kind: "business", code: 71 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://relay.example.com/json/invoice_query");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-relay-secret"]).toBe("relay-secret");
    expect(JSON.stringify(headers)).not.toContain("APPKEY-xyz");
    expect(String(init.body)).not.toContain("APPKEY-xyz");
  });
  it("中繼網址非 https → 退回直連", () => {
    vi.stubEnv("AMEGO_RELAY_URL", "http://localhost:3000");
    vi.stubEnv("AMEGO_RELAY_SECRET", "s");
    expect(amegoTransport()).toMatchObject({ relay: false, base: "https://invoice-api.amego.tw" });
  });
  it("fetch 失敗 → transport（可重試）", async () => {
    vi.stubEnv("AMEGO_INVOICE_BAN", "53912857");
    vi.stubEnv("AMEGO_APP_KEY", "k");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) }))));
    const r = await amegoRequest("/json/f0401", {});
    expect(r).toMatchObject({ ok: false, kind: "transport", code: null });
    expect((r as { msg: string }).msg).toContain("ECONNREFUSED");
  });
});

/** 模擬 planet.invoices 一列＋claim/finish/fail 的 DB 語意 */
function invoiceWorld(issueResults: (AmegoResult & { invoice?: IssuedInvoice })[], opts: { paid?: number; findHit?: string | null; lines?: InvoiceLine[] | null } = {}) {
  const row = { status: "pending", retry: 0, number: null as string | null, lockedAt: 0 };
  const alerts: string[] = [];
  const issued: string[] = [];
  const deps: IssueDeps = {
    configured: () => true,
    async claim(): Promise<InvoiceClaim> {
      if (row.status === "issued") return { claimed: false, reason: "already_issued", invoiceNumber: row.number };
      if (row.status === "failed" && row.retry >= MAX_INVOICE_RETRIES) return { claimed: false, reason: "retries_exhausted" };
      if (row.status === "issuing") return { claimed: false, reason: "locked" };
      row.status = "issuing";
      return { claimed: true, attempt: row.retry, orderRef: "TP261027ABCD2345", amount: opts.paid ?? 680, buyerEmail: "a@b.co", buyerName: null };
    },
    async finish(_p, inv) {
      if (row.status === "issued" && row.number !== inv.invoiceNumber) throw new Error("DOUBLE_ISSUE");
      row.status = "issued";
      row.number = inv.invoiceNumber;
      return true;
    },
    async fail(_p, _e, permanent) {
      row.status = "failed";
      row.retry = permanent ? Math.max(row.retry + 1, MAX_INVOICE_RETRIES) : row.retry + 1;
      return row.retry;
    },
    loadLines: async () => (opts.lines === undefined ? LINES : opts.lines),
    issue: vi.fn(async () => {
      const r = issueResults.shift();
      if (!r) throw new Error("unexpected issue call");
      if (r.ok && r.invoice) issued.push(r.invoice.invoiceNumber);
      return r;
    }),
    find: vi.fn(async () => ({ ok: true as const, hit: opts.findHit ? { invoiceNumber: opts.findHit, randomNumber: "1234" } : null })),
    alert: async (_o, m) => {
      alerts.push(m);
    },
  };
  return { row, deps, alerts, issued };
}

const okIssue = (n: string): AmegoResult & { invoice: IssuedInvoice } => ({ ok: true, http: 200, data: { code: 0, msg: "" }, invoice: { invoiceNumber: n, randomNumber: "5678", invoiceTime: 1761000000 } });
const transportFail: AmegoResult = { ok: false, kind: "transport", code: null, msg: 'unexpected_response http=404 body={"error":"path_not_allowed"}', http: 404 };

describe("issueForPayment（發票開立流程）", () => {
  it("正常開立 → issued、只打一次 Amego", async () => {
    const w = invoiceWorld([okIssue("AB12345678")]);
    expect(await issueForPayment("p1", w.deps)).toEqual({ ok: true, invoiceNumber: "AB12345678", adopted: false });
    expect(w.row.status).toBe("issued");
    expect(w.deps.issue).toHaveBeenCalledTimes(1);
  });

  it("🔴 發票失敗重試：中繼 404（transport）→ failed 但可重試；下一輪先查 Amego 沒開過才重開，成功", async () => {
    const w = invoiceWorld([transportFail, okIssue("AB12345679")]);
    const r1 = await issueForPayment("p1", w.deps);
    expect(r1).toMatchObject({ ok: false, permanent: false });
    expect(w.row).toMatchObject({ status: "failed", retry: 1 });
    expect(w.alerts).toEqual([]);
    const r2 = await issueForPayment("p1", w.deps);
    expect(r2).toMatchObject({ ok: true, invoiceNumber: "AB12345679" });
    expect(w.deps.find).toHaveBeenCalledTimes(1);
  });

  it("🔴 重試時 Amego 其實已經開過 → 認回來，不開第二張", async () => {
    const w = invoiceWorld([transportFail], { findHit: "AB00000001" });
    await issueForPayment("p1", w.deps);
    const r2 = await issueForPayment("p1", w.deps);
    expect(r2).toEqual({ ok: true, invoiceNumber: "AB00000001", adopted: true });
    expect(w.deps.issue).toHaveBeenCalledTimes(1);
    expect(w.issued).toEqual([]);
  });

  it("OrderId 重複（3040171）→ 查回來認領", async () => {
    const dup: AmegoResult = { ok: false, kind: "business", code: 3040171, msg: "OrderId 重複", data: { code: 3040171, msg: "" }, http: 200 };
    const w = invoiceWorld([dup], { findHit: "AB00000002" });
    expect(await issueForPayment("p1", w.deps)).toEqual({ ok: true, invoiceNumber: "AB00000002", adopted: true });
  });

  it("永久錯誤（簽章 16）→ 推到上限、通知人工、不再重試", async () => {
    const bad: AmegoResult = { ok: false, kind: "business", code: 16, msg: "sign 驗證錯誤", data: { code: 16, msg: "" }, http: 200 };
    const w = invoiceWorld([bad]);
    expect(await issueForPayment("p1", w.deps)).toMatchObject({ ok: false, permanent: true });
    expect(w.row.retry).toBe(MAX_INVOICE_RETRIES);
    expect(w.alerts.length).toBe(1);
    expect(await issueForPayment("p1", w.deps)).toMatchObject({ ok: false, reason: "retries_exhausted" });
    expect(w.deps.issue).toHaveBeenCalledTimes(1);
  });

  it("transport 連續失敗到上限才通知（不會第一次就判永久）", async () => {
    const w = invoiceWorld(Array.from({ length: MAX_INVOICE_RETRIES }, () => transportFail));
    for (let i = 0; i < MAX_INVOICE_RETRIES; i++) await issueForPayment("p1", w.deps);
    expect(w.row.retry).toBe(MAX_INVOICE_RETRIES);
    expect(w.alerts.length).toBe(1);
  });

  it("明細加總 ≠ 實收 → 拒絕開立（稅務憑證金額必須一致）", async () => {
    const w = invoiceWorld([], { paid: 999 });
    expect(await issueForPayment("p1", w.deps)).toMatchObject({ ok: false, permanent: true });
    expect(w.deps.issue).not.toHaveBeenCalled();
  });

  it("已開過 → 直接回既有號碼，不打 Amego", async () => {
    const w = invoiceWorld([okIssue("AB12345678")]);
    await issueForPayment("p1", w.deps);
    expect(await issueForPayment("p1", w.deps)).toEqual({ ok: true, invoiceNumber: "AB12345678", adopted: true });
    expect(w.deps.issue).toHaveBeenCalledTimes(1);
  });

  it("開成功但寫回 DB 失敗 → 不標 failed（避免重開），通知人工", async () => {
    const w = invoiceWorld([okIssue("AB12345678")]);
    w.deps.finish = async () => {
      throw new Error("db down");
    };
    expect(await issueForPayment("p1", w.deps)).toMatchObject({ ok: false, reason: "issued_but_not_recorded" });
    expect(w.row.status).toBe("issuing");
    expect(w.alerts[0]).toContain("AB12345678");
  });

  it("未設定 Amego → 不 claim、不燒 retry", async () => {
    const w = invoiceWorld([]);
    w.deps.configured = () => false;
    expect(await issueForPayment("p1", w.deps)).toMatchObject({ ok: false, reason: "amego_not_configured" });
    expect(w.row).toMatchObject({ status: "pending", retry: 0 });
  });
});
