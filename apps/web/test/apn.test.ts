import { describe, expect, it, vi } from "vitest";
import { handleApn, TERMINAL_OUTCOMES, type ApnDeps, type ClaimResult } from "../lib/pay/apn";
import { apnChecksum } from "../lib/pay/blackcat-core";
import { reconcileOrder, type GatewayResult, type MarkPaidResult, type ReconcileDeps } from "../lib/pay/reconcile";

const OID = "TP261027ABCD2345";
const KEY = "s3cret-key";

function apnBody(over: Partial<{ status: string; amount: number | string; pay_amount: number | null; order_no: string; trans_id: string; nonce: string }> = {}, badChecksum = false) {
  const b = { api_id: "CC0000000001", trans_id: over.trans_id ?? "trans-1", order_no: over.order_no ?? OID, amount: over.amount ?? 680, status: over.status ?? "B", nonce: over.nonce ?? "n-1" };
  const checksum = badChecksum ? "0".repeat(32) : apnChecksum({ apiId: b.api_id, transId: b.trans_id, amount: b.amount, status: b.status, nonce: b.nonce });
  const detail = over.pay_amount === null ? {} : { payment_detail: { pay_amount: over.pay_amount ?? 680, auth_card_no: "411111******1111" } };
  return JSON.stringify({ ...b, checksum, ...detail });
}

/**
 * 以真的 reconcileOrder 串起來：payment_events（unique trans_id+status）＋ payments ＋ 目標，模擬整條 APN 路徑。
 * gateway = 黑貓PAY 伺服器上的真實 process_code。
 */
function world(opts: { processCode: number | null; amount?: number; queryFails?: boolean; failClaimDb?: boolean }) {
  // opts 可在測試中途修改（模擬回查恢復）
  const events = new Map<string, { outcome: string; pay_amount: number | null; trans_id: string }>();
  const st = { paymentStatus: "init", targetStatus: "pending", amount: opts.amount ?? 680, invoices: 0, alerts: [] as string[], attention: null as string | null, markPaidCalls: 0, queries: 0 };
  const rdeps: ReconcileDeps = {
    findPayment: async () => ({ status: st.paymentStatus, createdAt: new Date().toISOString() }),
    claimCheck: async () => true,
    recordCheck: async () => {},
    alertAttention: async (_o, r) => {
      st.alerts.push(r);
    },
    query: async (): Promise<GatewayResult | null> => {
      st.queries += 1;
      return opts.queryFails ? null : { processCode: opts.processCode, raw: { process_code: opts.processCode } };
    },
    storedApnAmount: async () => {
      for (const [k, v] of events) if (/:(B|O|E)$/.test(k)) return { amount: v.pay_amount, transId: v.trans_id };
      return null;
    },
    markPaid: async (_o, amount): Promise<MarkPaidResult> => {
      st.markPaidCalls += 1;
      if (st.paymentStatus === "paid") return { result: "already_paid", transitioned: false, kind: "order", target_id: "o1", payment_id: "p1" };
      if (amount !== st.amount) {
        const isNew = st.attention !== "amount_mismatch";
        st.attention = "amount_mismatch";
        return { result: "amount_mismatch", transitioned: false, attention_new: isNew, kind: "order", target_id: "o1", payment_id: "p1" };
      }
      st.paymentStatus = "paid";
      st.targetStatus = "paid";
      st.invoices += 1;
      return { result: "paid", transitioned: true, kind: "order", target_id: "o1", payment_id: "p1" };
    },
    markFailed: async () => {
      st.paymentStatus = "failed";
    },
    flagAttention: async (_o, r) => {
      const n = st.attention !== r;
      st.attention = r;
      return n;
    },
    onPaid: async () => {},
  };
  const deps: ApnDeps = {
    claimEvent: vi.fn(async (row): Promise<ClaimResult> => {
      if (opts.failClaimDb) return "db_error";
      const k = `${row.trans_id}:${row.status_code}`;
      const prev = events.get(k);
      if (!prev) {
        events.set(k, { outcome: "pending", pay_amount: row.pay_amount, trans_id: row.trans_id });
        return "new";
      }
      return TERMINAL_OUTCOMES.has(prev.outcome) ? "already_done" : "resume";
    }),
    finishEvent: async (t, s, outcome) => {
      const e = events.get(`${t}:${s}`);
      if (e) e.outcome = outcome;
    },
    reconcile: (o, src, ro) => reconcileOrder(o, src, rdeps, ro),
    paymentStatus: async () => st.paymentStatus,
    flagAttention: rdeps.flagAttention,
    alertAttention: rdeps.alertAttention,
  };
  return { st, deps, events, opts };
}

const call = (deps: ApnDeps, rawBody: string, key: string | null = KEY) => handleApn({ key, expectedKey: KEY, rawBody }, deps);

describe("handleApn — 閘門與驗簽", () => {
  it("密鑰不符 → 404，且不解析 body、不碰 DB", async () => {
    const { deps } = world({ processCode: 15 });
    const r = await call(deps, apnBody(), "wrong");
    expect(r.status).toBe(404);
    expect(deps.claimEvent).not.toHaveBeenCalled();
  });
  it("未設定密鑰 → 503", async () => {
    const { deps } = world({ processCode: 15 });
    expect((await handleApn({ key: KEY, expectedKey: "", rawBody: apnBody() }, deps)).status).toBe(503);
  });
  it("checksum 錯 → 400", async () => {
    const { deps } = world({ processCode: 15 });
    expect((await call(deps, apnBody({}, true))).status).toBe(400);
  });
  it("非本站單號（小時光 IB-）→ OK 但不處理", async () => {
    const { deps, st } = world({ processCode: 15 });
    const r = await call(deps, apnBody({ order_no: "IB-202600000001" }));
    expect(r).toMatchObject({ status: 200, body: "OK", outcome: "foreign_order" });
    expect(st.queries).toBe(0);
  });
});

describe("handleApn — 入帳", () => {
  it("正常 B：回查 15＋實收相符 → 純文字 OK、入帳、建發票", async () => {
    const { deps, st } = world({ processCode: 15 });
    const r = await call(deps, apnBody());
    expect(r).toEqual({ status: 200, body: "OK", outcome: "paid" });
    expect(st.paymentStatus).toBe("paid");
    expect(st.invoices).toBe(1);
  });

  it("🔴 偽造：checksum 正確但回查 process_code 非授權 → OK、不入帳、不終局（重送會再查）", async () => {
    const { deps, st, events } = world({ processCode: 13 });
    const r = await call(deps, apnBody());
    expect(r).toMatchObject({ status: 200, body: "OK", outcome: "not_authorized" });
    expect(st.paymentStatus).toBe("init");
    expect(st.markPaidCalls).toBe(0);
    expect(events.get("trans-1:B")?.outcome).toBe("not_authorized");
    // 同一則重送 → resume（重跑）而不是 already_done
    await call(deps, apnBody({ nonce: "n-2" }));
    expect(st.queries).toBe(2);
    expect(st.paymentStatus).toBe("init");
  });

  it("🔴 偽造：回查查無此單（null process_code）→ 不入帳", async () => {
    const { deps, st } = world({ processCode: null });
    await call(deps, apnBody());
    expect(st.paymentStatus).toBe("init");
  });

  it("🔴 金額不符：pay_amount 1 ≠ 680 → OK、不入帳、通知一次、終局", async () => {
    const { deps, st, events } = world({ processCode: 15 });
    const r = await call(deps, apnBody({ pay_amount: 1 }));
    expect(r.outcome).toBe("amount_mismatch");
    expect(st.paymentStatus).toBe("init");
    expect(st.alerts).toEqual(["amount_mismatch"]);
    expect(events.get("trans-1:B")?.outcome).toBe("amount_mismatch");
  });

  it("🔴 金額不符：amount 欄位竄改成 1（checksum 照算）但 pay_amount 正確 → 以 pay_amount 為準", async () => {
    const { deps, st } = world({ processCode: 15 });
    const r = await call(deps, apnBody({ amount: 1, pay_amount: 680 }));
    expect(r.outcome).toBe("paid");
    expect(st.paymentStatus).toBe("paid");
  });

  it("🔴 缺 pay_amount → 不入帳（不拿 amount 充數）", async () => {
    const { deps, st } = world({ processCode: 15 });
    const r = await call(deps, apnBody({ pay_amount: null }));
    expect(r.outcome).toBe("amount_mismatch");
    expect(st.paymentStatus).toBe("init");
  });

  it("重送冪等：同 trans_id+status（nonce 不同）→ duplicate、不再回查、發票只建一次", async () => {
    const { deps, st } = world({ processCode: 15 });
    await call(deps, apnBody({ nonce: "n-1" }));
    const r2 = await call(deps, apnBody({ nonce: "n-2" }));
    const r3 = await call(deps, apnBody({ nonce: "n-3" }));
    expect(r2.outcome).toBe("duplicate");
    expect(r3.outcome).toBe("duplicate");
    expect(st.queries).toBe(1);
    expect(st.invoices).toBe(1);
  });

  it("B 之後的 O/E 是新事件，但入帳冪等（already_paid），發票不重建", async () => {
    const { deps, st } = world({ processCode: 21 });
    await call(deps, apnBody({ status: "B" }));
    const o = await call(deps, apnBody({ status: "O" }));
    expect(o.outcome).toBe("already_paid");
    expect(st.invoices).toBe(1);
  });

  it("回查失敗 → 500，事件不終局；恢復後重送可入帳", async () => {
    const w = world({ processCode: 15, queryFails: true });
    const r = await call(w.deps, apnBody());
    expect(r.status).toBe(500);
    expect(w.events.get("trans-1:B")?.outcome).toBe("verify_failed");
    // 修好後同一則重送（nonce 不同）→ resume 重跑 → 入帳
    w.opts.queryFails = false;
    const r2 = await call(w.deps, apnBody({ nonce: "n-2" }));
    expect(r2.outcome).toBe("paid");
    expect(w.st.paymentStatus).toBe("paid");
  });

  it("DB 寫入失敗 → 500 讓閘道重送", async () => {
    const { deps } = world({ processCode: 15, failClaimDb: true });
    expect((await call(deps, apnBody())).status).toBe(500);
  });

  it("沖銷 Q（取消授權）且本站已付款 → 通知人工、不自動改狀態", async () => {
    const { deps, st } = world({ processCode: 15 });
    await call(deps, apnBody({ status: "B" }));
    const r = await call(deps, apnBody({ status: "Q" }));
    expect(r.outcome).toBe("reversal_notice");
    expect(st.paymentStatus).toBe("paid");
    expect(st.alerts).toEqual(["reversal_Q"]);
  });

  it("F（授權失敗）→ 回查確認 16 才標失敗", async () => {
    const { deps, st } = world({ processCode: 16 });
    const r = await call(deps, apnBody({ status: "F" }));
    expect(r.outcome).toBe("failed");
    expect(st.paymentStatus).toBe("failed");
  });

  it("偽造 F（回查其實 15）→ 不會標失敗", async () => {
    const { deps, st } = world({ processCode: 15 });
    await call(deps, apnBody({ status: "F" }));
    expect(st.paymentStatus).toBe("init");
  });
});
