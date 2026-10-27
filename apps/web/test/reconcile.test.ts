import { describe, expect, it, vi } from "vitest";
import {
  AWAITING_APN_ALERT_MS,
  gatewayBlocksRetry,
  GATEWAY_ORDER_RE,
  newGatewayOrderId,
  reconcileOrder,
  redactBody,
  sanitizeRaw,
  type GatewayResult,
  type MarkPaidResult,
  type ReconcileDeps,
} from "../lib/pay/reconcile";
import { apnChecksum, apnChecksumMatches, apnPaidAmount, classifyProcessCode, isBlackcatPayUrl, sanitizeOrderDetail, taipeiTimestamp, toInt } from "../lib/pay/blackcat-core";

const OID = "TP261027ABCD2345";

/** 模擬 DB：payments 一筆、目標一筆；markPaid 依 mark_blackcat_paid 的語意實作 */
function setup(opts: {
  gateway: GatewayResult | null;
  paymentStatus?: string;
  targetStatus?: string;
  amount?: number;
  found?: boolean;
  claim?: boolean;
  stored?: { amount: number | null; transId: string } | null;
  createdAt?: string;
}) {
  const db = {
    paymentStatus: opts.paymentStatus ?? "init",
    targetStatus: opts.targetStatus ?? "pending",
    amount: opts.amount ?? 680,
    attention: null as string | null,
    checked: null as string | null,
    alerts: [] as string[],
    invoices: 0,
  };
  const deps: ReconcileDeps = {
    findPayment: vi.fn(async () => (opts.found === false ? null : { status: db.paymentStatus, createdAt: opts.createdAt ?? new Date().toISOString() })),
    claimCheck: vi.fn(async () => opts.claim !== false),
    recordCheck: vi.fn(async (_id: string, st: string | null) => {
      db.checked = st;
    }),
    alertAttention: vi.fn(async (_id: string, reason: string) => {
      db.alerts.push(reason);
    }),
    query: vi.fn(async () => opts.gateway),
    storedApnAmount: vi.fn(async () => opts.stored ?? null),
    markPaid: vi.fn(async (_id: string, amount: number | null): Promise<MarkPaidResult> => {
      if (db.paymentStatus === "paid") return { result: "already_paid", transitioned: false, kind: "order", target_id: "o1", payment_id: "p1" };
      if (amount === null || amount !== db.amount) {
        const isNew = db.attention !== "amount_mismatch";
        db.attention = "amount_mismatch";
        return { result: "amount_mismatch", transitioned: false, attention_new: isNew, kind: "order", target_id: "o1", payment_id: "p1" };
      }
      db.paymentStatus = "paid";
      if (db.targetStatus === "pending") {
        db.targetStatus = "paid";
        db.invoices += 1;
        return { result: "paid", transitioned: true, kind: "order", target_id: "o1", payment_id: "p1" };
      }
      db.attention = db.targetStatus === "cancelled" ? "paid_after_cancel" : "duplicate_payment";
      return { result: "needs_attention", reason: db.attention, transitioned: false, attention_new: true, kind: "order", target_id: "o1", payment_id: "p1" };
    }),
    markFailed: vi.fn(async () => {
      if (db.paymentStatus === "init") db.paymentStatus = "failed";
    }),
    flagAttention: vi.fn(async (_id: string, reason: string) => {
      const isNew = db.attention !== reason;
      db.attention = reason;
      return isNew;
    }),
    onPaid: vi.fn(async () => {}),
  };
  return { db, deps };
}

const q = (processCode: number | null): GatewayResult => ({ processCode, raw: { cust_order_no: OID, process_code: processCode, order_amount: 680, grant_amount: 665 } });

describe("classifyProcessCode", () => {
  it("15/20/21/22 = 已授權", () => {
    for (const c of [15, 20, 21, 22]) expect(classifyProcessCode(c)).toBe("paid");
  });
  it("13/14（刷卡頁、繳款人確認）不是付款成功", () => {
    expect(classifyProcessCode(13)).toBe("pending");
    expect(classifyProcessCode(14)).toBe("pending");
  });
  it("5/6/16/17/27 = 失敗；23 = 請款失敗需人工；null = pending", () => {
    for (const c of [5, 6, 16, 17, 27]) expect(classifyProcessCode(c)).toBe("failed");
    expect(classifyProcessCode(23)).toBe("attention");
    expect(classifyProcessCode(null)).toBe("pending");
  });
});

describe("blackcat-core 純函式", () => {
  it("APN checksum = MD5(api_id:trans_id:amount:status:nonce)，用原樣字串、大小寫不敏感", () => {
    const f = { apiId: "CC0000000001", transId: "550e8400-e29b", amount: 680, status: "B", nonce: "1234567890" };
    const sum = apnChecksum(f);
    expect(sum).toMatch(/^[0-9a-f]{32}$/);
    expect(apnChecksumMatches({ ...f, checksum: sum })).toBe(true);
    expect(apnChecksumMatches({ ...f, checksum: sum.toUpperCase() })).toBe(true);
    expect(apnChecksumMatches({ ...f, amount: "680.0", checksum: sum })).toBe(false);
    expect(apnChecksumMatches({ ...f, checksum: "x" })).toBe(false);
  });
  it("實收金額只認 payment_detail.pay_amount，不 fallback 到 amount", () => {
    expect(apnPaidAmount({ amount: 680, payment_detail: { pay_amount: 680 } })).toBe(680);
    expect(apnPaidAmount({ amount: 680, payment_detail: { pay_amount: "500" } })).toBe(500);
    expect(apnPaidAmount({ amount: 680 })).toBeNull();
    expect(apnPaidAmount({ amount: 680, payment_detail: { grant_amount: 665 } })).toBeNull();
  });
  it("toInt：空字串是 null 不是 0", () => {
    expect(toInt("")).toBeNull();
    expect(toInt(" 12 ")).toBe(12);
    expect(toInt(0)).toBe(0);
  });
  it("order_detail 去 HTML、必填", () => {
    expect(sanitizeOrderDetail("<b>寶寶</b> x1")).toBe("寶寶 x1");
    expect(sanitizeOrderDetail("<>")).toBe("十二星球訂單");
    expect(sanitizeOrderDetail("a".repeat(600)).length).toBe(500);
  });
  it("刷卡頁網址只接受 4128888card.com.tw 的 https", () => {
    expect(isBlackcatPayUrl("https://cocs.4128888card.com.tw/Pay/abc")).toBe(true);
    expect(isBlackcatPayUrl("http://cocs.4128888card.com.tw/x")).toBe(false);
    expect(isBlackcatPayUrl("https://evil4128888card.com.tw/x")).toBe(false);
    expect(isBlackcatPayUrl("https://4128888card.com.tw.evil.com/x")).toBe(false);
  });
  it("send_time 是台北時間", () => {
    expect(taipeiTimestamp(new Date("2026-10-27T16:30:05Z"))).toBe("2026-10-28 00:30:05");
  });
});

describe("order id", () => {
  it("TP + yyMMdd(台北) + 8 碼，符合 regex", () => {
    const id = newGatewayOrderId(new Date("2026-10-27T17:00:00Z"), new Uint8Array([0, 1, 2, 3, 4, 5, 6, 33]));
    expect(id).toBe("TP2610280123456Z");
    expect(GATEWAY_ORDER_RE.test(id)).toBe(true);
    expect(GATEWAY_ORDER_RE.test("IB-202600000001")).toBe(false);
  });
  it("redactBody 去 email 與長數字", () => {
    expect(redactBody('{"email":"a@b.co","card":"4111111111111111"}')).toBe('{"email":"[email]","card":"[num]"}');
  });
  it("sanitizeRaw 只留白名單", () => {
    expect(sanitizeRaw({ process_code: 15, card_no: "4111", order_amount: 680 })).toEqual({ process_code: 15, order_amount: 680 });
  });
});

describe("reconcileOrder", () => {
  it("APN 帶實收金額＋回查已授權 → paid、建發票、onPaid 一次", async () => {
    const { db, deps } = setup({ gateway: q(15) });
    const r = await reconcileOrder(OID, "apn_B", deps, { apn: { amount: 680, transId: "t1" } });
    expect(r).toEqual({ http: 200, outcome: "paid", processCode: 15 });
    expect(db.targetStatus).toBe("paid");
    expect(db.invoices).toBe(1);
    expect(db.checked).toBe("15");
    expect(deps.onPaid).toHaveBeenCalledTimes(1);
    expect(deps.onPaid).toHaveBeenCalledWith("order", "o1", "p1");
  });

  it("🔴 偽造：checksum 正確但回查非授權（13）→ 不標記付款", async () => {
    const { db, deps } = setup({ gateway: q(13) });
    const r = await reconcileOrder(OID, "apn_B", deps, { apn: { amount: 680, transId: "t1" } });
    expect(r.outcome).toBe("pending");
    expect(deps.markPaid).not.toHaveBeenCalled();
    expect(db.paymentStatus).toBe("init");
  });

  it("🔴 金額不符（實收 500 ≠ 應收 680）→ 不標記、只通知一次", async () => {
    const { db, deps } = setup({ gateway: q(15) });
    const r1 = await reconcileOrder(OID, "apn_B", deps, { apn: { amount: 500, transId: "t1" } });
    expect(r1.outcome).toBe("amount_mismatch");
    expect(db.targetStatus).toBe("pending");
    expect(db.invoices).toBe(0);
    await reconcileOrder(OID, "apn_O", deps, { apn: { amount: 500, transId: "t1" } });
    expect(db.alerts).toEqual(["amount_mismatch"]);
    expect(deps.onPaid).not.toHaveBeenCalled();
  });

  it("🔴 APN 缺 pay_amount → 視為金額不符，不拿 order_amount 充數", async () => {
    const { db, deps } = setup({ gateway: q(15) });
    const r = await reconcileOrder(OID, "apn_B", deps, { apn: { amount: null, transId: "t1" } });
    expect(r.outcome).toBe("amount_mismatch");
    expect(db.paymentStatus).toBe("init");
  });

  it("排程：已授權但還沒收到 APN → 不標記（awaiting_apn），30 分鐘後才通知且只通知一次", async () => {
    const fresh = setup({ gateway: q(15) });
    expect((await reconcileOrder(OID, "cron", fresh.deps)).outcome).toBe("awaiting_apn");
    expect(fresh.deps.markPaid).not.toHaveBeenCalled();
    expect(fresh.db.alerts).toEqual([]);

    const old = setup({ gateway: q(15), createdAt: new Date(Date.now() - AWAITING_APN_ALERT_MS - 1000).toISOString() });
    await reconcileOrder(OID, "cron", old.deps);
    await reconcileOrder(OID, "cron", old.deps);
    expect(old.db.alerts).toEqual(["authorized_without_apn"]);
    expect(old.db.paymentStatus).toBe("init");
  });

  it("排程：已授權且先前已存 APN 實收金額 → 補入帳", async () => {
    const { db, deps } = setup({ gateway: q(21), stored: { amount: 680, transId: "t1" } });
    const r = await reconcileOrder(OID, "cron", deps);
    expect(r.outcome).toBe("paid");
    expect(db.invoices).toBe(1);
  });

  it("重送冪等：第二次只回 already_paid、onPaid 不再呼叫、發票不重建", async () => {
    const { db, deps } = setup({ gateway: q(15) });
    await reconcileOrder(OID, "apn_B", deps, { apn: { amount: 680, transId: "t1" } });
    const r2 = await reconcileOrder(OID, "apn_E", deps, { apn: { amount: 680, transId: "t1" } });
    expect(r2.outcome).toBe("already_paid");
    expect(deps.onPaid).toHaveBeenCalledTimes(1);
    expect(db.invoices).toBe(1);
  });

  it("訂單已取消後才付款 → needs_attention 並通知、不開發票", async () => {
    const { db, deps } = setup({ gateway: q(15), targetStatus: "cancelled" });
    const r = await reconcileOrder(OID, "apn_B", deps, { apn: { amount: 680, transId: "t1" } });
    expect(r.outcome).toBe("needs_attention");
    expect(db.alerts).toEqual(["paid_after_cancel"]);
    expect(db.invoices).toBe(0);
  });

  it("回查失敗 → 500（APN 重送）", async () => {
    const { deps } = setup({ gateway: null });
    expect(await reconcileOrder(OID, "apn_B", deps, { apn: { amount: 680, transId: "t1" } })).toEqual({ http: 500, outcome: "query_failed" });
  });

  it("回查 16（授權失敗）→ failed；23（請款失敗）→ 需人工", async () => {
    const a = setup({ gateway: q(16) });
    expect((await reconcileOrder(OID, "cron", a.deps)).outcome).toBe("failed");
    expect(a.db.paymentStatus).toBe("failed");
    const b = setup({ gateway: q(23) });
    expect((await reconcileOrder(OID, "cron", b.deps)).outcome).toBe("needs_attention");
    expect(b.db.alerts).toEqual(["capture_failed"]);
  });

  it("非本站單號／查無付款 → unknown_order（200）", async () => {
    const { deps } = setup({ gateway: q(15) });
    expect((await reconcileOrder("IB-202600000001", "apn", deps)).outcome).toBe("unknown_order");
    const n = setup({ gateway: q(15), found: false });
    expect((await reconcileOrder(OID, "apn", n.deps)).outcome).toBe("unknown_order");
  });

  it("節流：被節流時回 500 throttled、不回查", async () => {
    const { deps } = setup({ gateway: q(15), claim: false });
    expect(await reconcileOrder(OID, "cron", deps, { throttle: true })).toEqual({ http: 500, outcome: "throttled" });
    expect(deps.query).not.toHaveBeenCalled();
  });
});

describe("gatewayBlocksRetry（避免重複扣款）", () => {
  it("已授權／請款中／請款失敗 → 拒絕重新付款", () => {
    for (const s of ["15", "20", "21", "22", "23", "P", "S"]) expect(gatewayBlocksRetry(s)).toBe(true);
  });
  it("未付款／失敗 → 可重新付款", () => {
    for (const s of [null, "", "13", "14", "16", "6"]) expect(gatewayBlocksRetry(s)).toBe(false);
  });
});
