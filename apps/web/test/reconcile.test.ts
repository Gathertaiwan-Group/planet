import { describe, expect, it, vi } from "vitest";
import {
  classifyGatewayStatus,
  extractAtmInfo,
  GATEWAY_ORDER_RE,
  newGatewayOrderId,
  parseGatewayDate,
  parseGatewayPayment,
  reconcileOrder,
  type GatewayResult,
  type MarkPaidResult,
  type ReconcileDeps,
} from "../lib/pay/reconcile";

const OID = "TP261027ABCD2345";

/** 模擬 DB：payments 一筆、目標（訂單／報名）一筆，markPaid 依 mark_payment_paid 的語意實作 */
function setup(opts: { gateway: GatewayResult | null; paymentStatus?: string; targetStatus?: string; amount?: number; found?: boolean }) {
  const db = {
    paymentStatus: opts.paymentStatus ?? "init",
    targetStatus: opts.targetStatus ?? "pending",
    amount: opts.amount ?? 680,
    attention: null as string | null,
    atm: null as null | { account: string },
  };
  const deps: ReconcileDeps = {
    findPayment: vi.fn(async () => (opts.found === false ? null : { status: db.paymentStatus })),
    query: vi.fn(async () => opts.gateway),
    markPaid: vi.fn(async (_id: string, amount: number): Promise<MarkPaidResult> => {
      if (db.paymentStatus === "paid") return { result: "already_paid", transitioned: false, kind: "order", target_id: "o1" };
      if (amount !== db.amount) {
        db.attention = "amount_mismatch";
        return { result: "amount_mismatch", transitioned: false, kind: "order", target_id: "o1" };
      }
      db.paymentStatus = "paid";
      if (db.targetStatus === "pending") {
        db.targetStatus = "paid";
        return { result: "paid", transitioned: true, kind: "order", target_id: "o1" };
      }
      db.attention = db.targetStatus === "cancelled" ? "paid_after_cancel" : "duplicate_payment";
      return { result: "needs_attention", reason: db.attention, transitioned: false, kind: "order", target_id: "o1" };
    }),
    recordAtm: vi.fn(async (_id, info) => {
      db.atm = { account: info.account };
    }),
    markFailed: vi.fn(async () => {
      if (db.paymentStatus === "init") db.paymentStatus = "failed";
    }),
    onPaid: vi.fn(async () => {}),
  };
  return { db, deps };
}

describe("classifyGatewayStatus", () => {
  it("S = paid（即使 status_code 是 null）", () => {
    expect(classifyGatewayStatus({ status: "S" })).toBe("paid");
    expect(classifyGatewayStatus({ status: " s " })).toBe("paid");
  });
  it("F = failed", () => expect(classifyGatewayStatus({ status: "F" })).toBe("failed"));
  it("P / W / 未知 = pending", () => {
    expect(classifyGatewayStatus({ status: "P" })).toBe("pending");
    expect(classifyGatewayStatus({ status: "W" })).toBe("pending");
    expect(classifyGatewayStatus({})).toBe("pending");
  });
  it("只有 status_code 看起來成功也不算 paid（以 status 為準）", () => {
    expect(classifyGatewayStatus({ status: "W", status_code: "00" })).toBe("pending");
  });
});

describe("parseGatewayPayment（sandbox 實際回應形狀）", () => {
  it("amount 為字串、status W、payment_info null", () => {
    const q = parseGatewayPayment({ order_id: OID, amount: "30", pay_type: "COMPLEX", status: "W", status_code: null, payment_info: null });
    expect(q).toMatchObject({ status: "W", amount: 30, pay_type: "COMPLEX", status_code: undefined, payment_info: undefined });
    expect(classifyGatewayStatus(q)).toBe("pending");
  });
  it("pay_type 陣列、amount 數字", () => {
    expect(parseGatewayPayment({ amount: 680, pay_type: ["CARD"], status: "s" })).toMatchObject({ amount: 680, pay_type: "CARD", status: "S" });
  });
  it("amount 空字串 → undefined", () => expect(parseGatewayPayment({ amount: "" }).amount).toBeUndefined());
});

describe("order id / ATM 解析", () => {
  it("TP + 台北日期 + 8 碼", () => {
    const id = newGatewayOrderId(new Date("2026-10-27T17:00:00Z"), new Uint8Array([0, 1, 2, 3, 4, 5, 6, 255]));
    expect(id).toMatch(GATEWAY_ORDER_RE);
    expect(id.startsWith("TP261028")).toBe(true); // UTC 17:00 = 台北隔天 01:00
    expect(id).toHaveLength(16);
  });
  it("ATM 帳號與期限", () => {
    const a = extractAtmInfo({ payment_info: { bank_code: "822", virtual_account: "9999123456789012", expire_date: "2026/10/30 23:59:59" } });
    expect(a?.account).toBe("9999123456789012");
    expect(a?.bankCode).toBe("822");
    expect(a?.expireAt?.toISOString()).toBe("2026-10-30T15:59:59.000Z");
    expect(extractAtmInfo({ payment_info: undefined })).toBeNull();
  });
  it("parseGatewayDate 各格式", () => {
    expect(parseGatewayDate("20261030235959")?.toISOString()).toBe("2026-10-30T15:59:59.000Z");
    expect(parseGatewayDate("2026-10-30")?.toISOString()).toBe("2026-10-30T15:59:59.000Z");
    expect(parseGatewayDate("garbage")).toBeNull();
  });
});

describe("reconcileOrder（notify 處理）", () => {
  it("回查 S 且金額相符 → paid、只觸發一次副作用", async () => {
    const { db, deps } = setup({ gateway: { status: "S", amount: 680, raw: {} } });
    const r = await reconcileOrder(OID, "order_confirm", deps);
    expect(r).toEqual({ http: 200, outcome: "paid" });
    expect(db.targetStatus).toBe("paid");
    expect(deps.onPaid).toHaveBeenCalledTimes(1);
  });

  it("重複 notify → already_paid、不再觸發副作用", async () => {
    const { deps } = setup({ gateway: { status: "S", amount: 680 } });
    await reconcileOrder(OID, "order_confirm", deps);
    const r2 = await reconcileOrder(OID, "order_confirm", deps);
    expect(r2).toEqual({ http: 200, outcome: "already_paid" });
    expect(deps.onPaid).toHaveBeenCalledTimes(1);
  });

  it("金額不符 → 不標記 paid", async () => {
    const { db, deps } = setup({ gateway: { status: "S", amount: 30 } });
    const r = await reconcileOrder(OID, "order_confirm", deps);
    expect(r.outcome).toBe("amount_mismatch");
    expect(db.targetStatus).toBe("pending");
    expect(db.paymentStatus).toBe("init");
    expect(db.attention).toBe("amount_mismatch");
    expect(deps.onPaid).not.toHaveBeenCalled();
  });

  it("偽造 notify（payload 說已付，但回查是 W）→ 不標記 paid", async () => {
    const { db, deps } = setup({ gateway: { status: "W", amount: 680 } });
    const r = await reconcileOrder(OID, "order_confirm", deps);
    expect(r).toEqual({ http: 200, outcome: "pending" });
    expect(deps.markPaid).not.toHaveBeenCalled();
    expect(db.targetStatus).toBe("pending");
  });

  it("回查 P → pending", async () => {
    const { deps } = setup({ gateway: { status: "P", amount: 680 } });
    expect((await reconcileOrder(OID, null, deps)).outcome).toBe("pending");
  });

  it("回查 F → 付款嘗試標 failed（訂單不動）", async () => {
    const { db, deps } = setup({ gateway: { status: "F" } });
    const r = await reconcileOrder(OID, "order_failed", deps);
    expect(r.outcome).toBe("failed");
    expect(db.paymentStatus).toBe("failed");
    expect(db.targetStatus).toBe("pending");
  });

  it("已付款後遲到的 F 不會覆蓋 paid", async () => {
    const { db, deps } = setup({ gateway: { status: "F" }, paymentStatus: "paid", targetStatus: "paid" });
    const r = await reconcileOrder(OID, "order_failed", deps);
    expect(r.outcome).toBe("already_paid");
    expect(deps.markFailed).not.toHaveBeenCalled();
    expect(db.paymentStatus).toBe("paid");
  });

  it("目標已 cancelled → needs_attention，不改回 paid、不觸發副作用", async () => {
    const { db, deps } = setup({ gateway: { status: "S", amount: 680 }, targetStatus: "cancelled" });
    const r = await reconcileOrder(OID, "order_confirm", deps);
    expect(r.outcome).toBe("needs_attention");
    expect(db.targetStatus).toBe("cancelled");
    expect(db.attention).toBe("paid_after_cancel");
    expect(deps.onPaid).not.toHaveBeenCalled();
  });

  it("回查失敗 → 500 讓閘道重送", async () => {
    const { deps } = setup({ gateway: null });
    expect(await reconcileOrder(OID, null, deps)).toEqual({ http: 500, outcome: "query_failed" });
  });

  it("回查 S 但缺金額 → 500", async () => {
    const { deps } = setup({ gateway: { status: "S" } });
    expect((await reconcileOrder(OID, null, deps)).http).toBe(500);
  });

  it("DB 寫入失敗 → 500", async () => {
    const { deps } = setup({ gateway: { status: "S", amount: 680 } });
    deps.markPaid = vi.fn(async () => null);
    expect(await reconcileOrder(OID, null, deps)).toEqual({ http: 500, outcome: "db_failed" });
  });

  it("未知單號／非 TP 單號 → 200 unknown_order，不回查", async () => {
    const a = setup({ gateway: { status: "S", amount: 680 }, found: false });
    expect(await reconcileOrder(OID, null, a.deps)).toEqual({ http: 200, outcome: "unknown_order" });
    expect(a.deps.query).not.toHaveBeenCalled();
    const b = setup({ gateway: { status: "S", amount: 680 } });
    expect((await reconcileOrder("DD2610270000AA", null, b.deps)).outcome).toBe("unknown_order");
    expect(b.deps.findPayment).not.toHaveBeenCalled();
  });

  it("ATM 取號（W + payment_info）→ 記錄虛擬帳號", async () => {
    const { db, deps } = setup({ gateway: { status: "W", amount: 680, payment_info: { virtual_account: "9999000011112222", expire_date: "2026/10/30 23:59:59" } } });
    expect((await reconcileOrder(OID, null, deps)).outcome).toBe("atm_issued");
    expect(db.atm?.account).toBe("9999000011112222");
  });
});
