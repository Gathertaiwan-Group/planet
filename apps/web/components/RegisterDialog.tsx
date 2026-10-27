"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { eventDateParts, nt } from "@planet/shared";
import { registerEvent } from "@/app/actions";
import { useStore } from "@/lib/store";
import { sx } from "@/lib/sx";
import { useOverlay } from "./useOverlay";

const label = sx("display:flex;flex-direction:column;gap:6px;font-size:14px;color:#cfcbe0");

export function RegisterDialog({ planets }: { planets: { id: number; name: string }[] }) {
  const ev = useStore((s) => s.regEvent);
  const result = useStore((s) => s.result);
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const [pendingPay, setPendingPay] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => useStore.getState().closeReg(), []);
  // 從付款頁按「上一頁」回來（bfcache 還原）時，解除導轉中的 loading
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  useOverlay(!!ev, close, ref);
  useEffect(() => {
    setDone(false);
    setError(null);
    setPendingPay(false);
  }, [ev]);

  if (!ev) return null;
  const d = eventDateParts(ev.starts_at);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || !ev) return;
    if (!ev.id) {
      setError("目前無法報名，請稍後再試。");
      return;
    }
    const fd = new FormData(e.currentTarget);
    const pid = Number(fd.get("planet"));
    setBusy(true);
    setError(null);
    let leaving = false;
    try {
      const st = useStore.getState();
      const r = await registerEvent({
        eventId: ev.id,
        nickname: String(fd.get("name") ?? ""),
        contact: String(fd.get("contact") ?? ""),
        planetId: pid > 0 ? pid : null,
        issue: String(fd.get("issue") ?? ""),
        anonId: st.ensureAnonId(),
      });
      if (!r.ok) {
        setError(r.error);
        if (r.seatsLeft !== undefined) useStore.setState((s) => ({ seats: { ...s.seats, [ev.slug]: r.seatsLeft! } }));
        return;
      }
      st.markRegistered(ev.slug, r.seatsLeft);
      if (r.redirectUrl) {
        leaving = true; // 導轉期間維持 loading，防重複送出
        window.location.assign(r.redirectUrl);
        return;
      }
      setPendingPay(r.manualPay);
      setDone(true);
    } catch {
      setError("網路好像不太穩，請再試一次。");
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  return (
    <div className="dialog-wrap" style={sx("position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:16px")}>
      <div onClick={close} aria-hidden="true" style={sx("position:absolute;inset:0;background:rgba(5,8,20,.65)")} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reg-title"
        tabIndex={-1}
        className="dialog"
        style={sx("position:relative;width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#151c38;border:1px solid #2a3358;border-radius:28px;padding:clamp(22px,4vw,32px);display:flex;flex-direction:column;gap:18px;outline:none")}
      >
        <div style={sx("display:flex;justify-content:space-between;gap:12px;align-items:flex-start")}>
          <div style={sx("display:flex;flex-direction:column;gap:6px")}>
            <span style={sx("font-size:14px;color:#f0c96e;font-weight:600")}>
              {d.dateText} · {ev.city}
            </span>
            <span id="reg-title" style={sx("font-size:22px;font-weight:700;line-height:1.35")}>
              {ev.title}
            </span>
          </div>
          <button type="button" onClick={close} aria-label="關閉" className="tap-sq" style={sx("flex:0 0 40px;background:#222b4f;color:#f6f0e1;border:0;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer")}>
            ✕
          </button>
        </div>

        {!done ? (
          <form onSubmit={submit} style={sx("display:flex;flex-direction:column;gap:14px")}>
            <label style={label}>
              <span>暱稱<span aria-hidden="true" style={sx("color:#f2a99a;margin-left:2px")}>*</span></span>
              <input required name="name" maxLength={40} autoComplete="nickname" className="field" data-autofocus />
            </label>
            <label style={label}>
              <span>Email 或手機<span aria-hidden="true" style={sx("color:#f2a99a;margin-left:2px")}>*</span></span>
              <input required name="contact" maxLength={100} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} className="field" />
            </label>
            <label style={label}>
              我的星球
              <select name="planet" defaultValue={result ?? 0} key={result ?? 0} className="field">
                <option value={0}>還沒測驗</option>
                {planets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={label}>
              最近卡關的事（選填，只有主持人看得到）
              <textarea name="issue" rows={3} maxLength={1000} placeholder="例：工作上不知道怎麼拒絕主管…" className="field" style={sx("resize:vertical")} />
            </label>
            <div style={sx("display:flex;justify-content:space-between;align-items:center;font-size:16px;padding-top:4px")}>
              <span style={sx("color:#cfcbe0")}>報名費</span>
              <span style={sx("font-size:20px;font-weight:700")}>{nt(ev.price_twd)}</span>
            </div>
            {error && (
              <span role="alert" style={sx("font-size:14px;color:#f2a99a;line-height:1.6")}>
                {error}
              </span>
            )}
            <button type="submit" disabled={busy} className="h-bg-gold" style={sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px;font-size:17px;font-weight:600;cursor:pointer", { opacity: busy ? 0.7 : 1 })}>
              {busy ? (ev.price_twd > 0 ? "前往付款頁…" : "處理中…") : ev.price_twd > 0 ? "確認報名並付款" : "確認報名"}
            </button>
          </form>
        ) : (
          <div style={sx("display:flex;flex-direction:column;gap:14px")} aria-live="polite">
            <span className="wk" style={sx("font-size:28px;font-weight:700")}>報名成功，到時候見！</span>
            <span style={sx("font-size:16px;line-height:1.7;color:#cfcbe0")}>行前通知會在活動前 3 天寄出。別忘了帶你的星球寶寶。</span>
            {pendingPay && <span style={sx("font-size:13px;line-height:1.6;color:#8e90a8")}>報名費的付款方式，我們會盡快與你聯繫。</span>}
            <button type="button" onClick={close} data-autofocus className="h-bg-gold tap" style={sx("align-self:flex-start;background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:13px 24px;font-size:16px;font-weight:600;cursor:pointer")}>
              好
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
