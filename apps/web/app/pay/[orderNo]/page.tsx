import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GOLD_ORB, nt } from "@planet/shared";
import { AutoRefresh, GoPayLink, RetryForm } from "@/components/PayResultClient";
import { GATEWAY_ORDER_RE, gatewayBlocksRetry } from "@/lib/pay/reconcile";
import { getPaymentView, reconcile } from "@/lib/pay/service";
import { sx } from "@/lib/sx";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "付款結果 · 十二星球", robots: { index: false, follow: false } };

const ERR: Record<string, string> = {
  not_allowed: "這筆付款目前不能重新付款，請重新整理看看最新狀態。",
  superseded: "你已經開過新的付款頁，請使用最新的付款頁完成付款。",
  attention: "這筆付款需要我們人工確認，我們會盡快與你聯繫。",
  in_progress: "付款正在處理中或已完成，為避免重複扣款，暫時不能重新付款。請稍後重新整理。",
  expired: "這筆報名已超過保留時間，請重新報名。",
  check_failed: "暫時無法確認付款狀態，為避免重複扣款請稍後再試。",
  misconfigured: "付款服務設定中，請稍後再試。",
  gateway_failed: "付款頁暫時打不開，請稍後再試一次。",
  db_failed: "系統忙碌中，請稍後再試一次。",
  disabled: "線上付款暫時關閉，請稍後再試。",
  below_minimum: "金額低於線上付款下限，我們會與你聯繫付款。",
  over_maximum: "金額超過線上刷卡上限（NT$100,000），請分開下單或與我們聯繫。",
};

const card = sx("width:min(560px,100%);margin:0 auto;background:#151c38;border:1px solid #2a3358;border-radius:28px;padding:clamp(24px,5vw,40px);display:flex;flex-direction:column;gap:16px");
const muted = sx("font-size:16px;line-height:1.7;color:#cfcbe0");
const link = sx("color:#aeb0c6;font-size:15px;min-height:44px;display:inline-flex;align-items:center");

export default async function PayResultPage({ params, searchParams }: { params: Promise<{ orderNo: string }>; searchParams: Promise<{ e?: string }> }) {
  const { orderNo } = await params;
  const { e } = await searchParams;
  if (!GATEWAY_ORDER_RE.test(orderNo)) notFound();

  let v = await getPaymentView(orderNo);
  if (!v) notFound();
  // 每次進頁都向閘道回查一次（notify 可能還沒到；回查結果才是權威）
  if (v.paymentStatus === "init") {
    await reconcile(orderNo, "return_page");
    v = (await getPaymentView(orderNo)) ?? v;
  }

  const isOrder = v.kind === "order";
  const paid = v.paymentStatus === "paid" && v.targetStatus !== "cancelled";
  const paidButCancelled = v.paymentStatus === "paid" && v.targetStatus === "cancelled";
  const targetPaidElsewhere = v.paymentStatus !== "paid" && (v.targetStatus === "paid" || v.targetStatus === "shipped");
  const attention = !!v.needsAttention && v.paymentStatus !== "paid";
  const processing = !attention && v.paymentStatus === "init" && v.targetStatus === "pending" && gatewayBlocksRetry(v.gatewayStatus);
  const expired = !attention && v.targetStatus === "pending" && v.regStale;
  const waiting = !attention && !processing && !expired && v.paymentStatus === "init" && v.targetStatus === "pending";
  const failed = !attention && !expired && v.paymentStatus === "failed" && v.targetStatus === "pending";
  const cancelled = v.targetStatus === "cancelled" && v.paymentStatus !== "paid";
  const backHref = isOrder ? "/shop" : "/events";
  const backText = isOrder ? "← 回商店" : "← 看其他聚會";

  return (
    <section style={sx("padding:clamp(32px,6vw,72px) 16px")}>
      <div style={card} aria-live="polite">
        <span style={sx("font-size:13px;color:#8e90a8;letter-spacing:.04em")}>
          {v.title} · 付款編號 {v.gatewayOrderId}
        </span>

        {(paid || targetPaidElsewhere) && (
          <>
            <span aria-hidden="true" style={sx("width:72px;height:72px;border-radius:50%;box-shadow:0 0 40px rgba(240,201,110,.5)", { background: GOLD_ORB })} />
            <span className="wk" style={sx("font-size:30px;font-weight:700")}>{isOrder ? "寶寶出發囉！" : "報名成功，到時候見！"}</span>
            <span style={muted}>
              {isOrder
                ? `已收到 ${nt(v.amount)}，訂單成立。出貨通知會傳到你的手機，電子發票會寄到你填的 Email。`
                : `已收到報名費 ${nt(v.amount)}。行前通知會在活動前 3 天寄出，別忘了帶你的星球寶寶。`}
            </span>
            <Link href={isOrder ? "/events" : "/"} className="h-bg-gold" style={sx("align-self:flex-start;background:#f0c96e;color:#10162e;border-radius:999px;padding:14px 24px;font-size:16px;font-weight:600;text-decoration:none")}>
              {isOrder ? "看近期聚會 →" : "回首頁"}
            </Link>
          </>
        )}

        {paidButCancelled && (
          <>
            <span className="wk" style={sx("font-size:26px;font-weight:700")}>已收到款項</span>
            <span style={muted}>這筆{isOrder ? "訂單" : "報名"}在付款完成前已經取消，我們會盡快與你聯繫退款或保留名額。</span>
          </>
        )}

        {attention && (
          <>
            <span className="wk" style={sx("font-size:26px;font-weight:700")}>需要人工確認</span>
            <span style={muted}>這筆付款的狀態需要我們人工確認，我們會盡快與你聯繫，請不要重複付款。</span>
          </>
        )}

        {processing && (
          <>
            <AutoRefresh />
            <span className="wk" style={sx("font-size:26px;font-weight:700")}>付款處理中…</span>
            <span style={muted}>刷卡已授權，正在確認款項，完成後這頁會自動更新。為避免重複扣款，請不要重新付款。</span>
          </>
        )}

        {expired && (
          <>
            <span className="wk" style={sx("font-size:26px;font-weight:700")}>報名已逾時</span>
            <span style={muted}>這筆報名超過保留時間沒有完成付款，名額已釋出。還有座位的話可以重新報名。</span>
          </>
        )}

        {waiting && (
          <>
            <AutoRefresh />
            <span className="wk" style={sx("font-size:26px;font-weight:700")}>正在確認付款…</span>
            <span style={muted}>如果你已經刷卡，請稍等幾秒，這頁會自動更新。還沒付款（或刷卡沒有成功）的話，可以回到付款頁繼續。</span>
            {!v.superseded && v.paymentUrl && <GoPayLink orderNo={v.gatewayOrderId} />}
            {!v.superseded && <RetryForm orderNo={v.gatewayOrderId} />}
            {!v.superseded && <span style={sx("font-size:13px;line-height:1.6;color:#8e90a8")}>刷卡頁打不開或已失效時，請改按「重新付款」開新的付款頁。付款由黑貓PAY（統一金流）處理。</span>}
            {!isOrder && <span style={sx("font-size:13px;line-height:1.6;color:#8e90a8")}>報名未付款的名額會保留 2 小時。</span>}
            {v.superseded && <span style={sx("font-size:13px;line-height:1.6;color:#8e90a8")}>這是較早的付款連結，你已經開過新的付款頁；請使用最新的付款頁完成付款。</span>}
          </>
        )}

        {failed && (
          <>
            <span className="wk" style={sx("font-size:26px;font-weight:700")}>付款沒有完成</span>
            <span style={muted}>{isOrder ? "訂單還保留著" : "報名還保留著"}，可以再試一次，或換一張卡。</span>
            {!v.superseded && <RetryForm orderNo={v.gatewayOrderId} />}
          </>
        )}

        {cancelled && (
          <>
            <span className="wk" style={sx("font-size:26px;font-weight:700")}>{isOrder ? "訂單已取消" : "報名已逾時取消"}</span>
            <span style={muted}>{isOrder ? "這筆訂單已經取消。想再領養寶寶，可以回商店重新下單。" : "這筆報名超過保留時間沒有完成付款，名額已釋出。還有座位的話可以重新報名。"}</span>
          </>
        )}

        {e && ERR[e] && (
          <span role="alert" style={sx("font-size:14px;color:#f2a99a;line-height:1.6")}>
            {ERR[e]}
          </span>
        )}
        {!paid && !targetPaidElsewhere && (
          <Link href={backHref} className="h-text-gold" style={link}>
            {backText}
          </Link>
        )}
      </div>
    </section>
  );
}
