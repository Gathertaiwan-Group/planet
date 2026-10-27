"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { GOLD_ORB, nt, orb, PAYMENT_OPTIONS, SHIPPING_OPTIONS, type OrderItemInput } from "@planet/shared";
import { createOrder } from "@/app/actions";
import { cartTotal, useStore } from "@/lib/store";
import { sx } from "@/lib/sx";
import { FramedImage } from "./ProductImage";
import { useOverlay } from "./useOverlay";

const label = sx("display:flex;flex-direction:column;gap:6px;font-size:14px;color:#cfcbe0");
const primary = sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px;font-size:17px;font-weight:600;cursor:pointer");

export function CartDrawer() {
  const router = useRouter();
  const open = useStore((s) => s.cartOpen);
  const step = useStore((s) => s.step);
  const cart = useStore((s) => s.cart);
  const { closeCart, setStep, setQty, clearCart, ensureAnonId } = useStore.getState();
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingPay, setPendingPay] = useState(false);

  const close = useCallback(() => useStore.getState().closeCart(), []);
  // 從付款頁按「上一頁」回來（bfcache 還原）時，解除導轉中的 loading
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  useOverlay(open, close, ref);

  if (!open) return null;
  const total = cartTotal(cart);
  const title = step === "form" ? "結帳" : step === "done" ? "完成" : "購物車";

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const items: OrderItemInput[] = cart.map((c) =>
      c.kind === "baby" ? { kind: "baby", planet_id: c.planetId!, plant_id: c.plantId!, qty: c.qty } : { kind: "extra", sku: c.sku!, qty: c.qty },
    );
    setBusy(true);
    setError(null);
    let leaving = false;
    try {
      const r = await createOrder({
        recipient: String(fd.get("name") ?? ""),
        phone: String(fd.get("phone") ?? ""),
        email: String(fd.get("email") ?? ""),
        shipping: String(fd.get("ship") ?? ""),
        payment: String(fd.get("pay") ?? ""),
        items,
        anonId: ensureAnonId(),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // 訂單已成立（付款頁建好）才清空購物車；之後付款失敗可在付款結果頁重新付款，不需要購物車
      clearCart();
      if (r.redirectUrl) {
        leaving = true; // 導轉期間維持 loading，防重複送出
        window.location.assign(r.redirectUrl);
        return;
      }
      setPendingPay(r.manualPay);
      setStep("done");
    } catch {
      setError("網路好像不太穩，請再試一次。");
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  return (
    <div style={sx("position:fixed;inset:0;z-index:50;display:flex;justify-content:flex-end")}>
      <div onClick={closeCart} aria-hidden="true" style={sx("position:absolute;inset:0;background:rgba(5,8,20,.6)")} />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="drawer"
        style={sx("position:relative;width:min(440px,100%);height:100%;background:#151c38;border-left:1px solid #2a3358;display:flex;flex-direction:column;outline:none")}
      >
        <div style={sx("display:flex;justify-content:space-between;align-items:center;padding:20px 24px;border-bottom:1px solid #2a3358")}>
          <span style={sx("font-size:20px;font-weight:700")}>{title}</span>
          <button type="button" onClick={closeCart} aria-label="關閉" className="tap-sq" style={sx("background:#222b4f;color:#f6f0e1;border:0;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer")}>
            ✕
          </button>
        </div>

        {step === "cart" && (
          <>
            <div className="drawer-scroll" style={sx("flex:1;overflow:auto;padding:16px 24px;display:flex;flex-direction:column;gap:12px")}>
              {cart.length === 0 && <span style={sx("color:#aeb0c6;font-size:16px;padding:24px 0")}>購物車空空的，去領養一隻寶寶吧。</span>}
              {cart.map((c) => (
                <div key={c.id} style={sx("display:flex;gap:14px;align-items:center;background:#19213f;border-radius:18px;padding:14px")}>
                  {c.image ? (
                    <span aria-hidden="true" style={sx("position:relative;flex:0 0 44px;width:44px;height:44px")}>
                      <span style={sx("position:absolute;inset:0;border-radius:50%;overflow:hidden;background:#e9e9ee")}>
                        <FramedImage src={c.image} alt="" sizes={(z) => `${Math.round(44 * z)}px`} variant="thumb" />
                      </span>
                      {c.kind === "baby" && (
                        <span style={sx("position:absolute;right:-4px;bottom:-4px;width:20px;height:20px;border-radius:50%;border:2px solid #19213f", { background: orb(c.hue) })} />
                      )}
                    </span>
                  ) : (
                    <span aria-hidden="true" style={sx("flex:0 0 44px;height:44px;border-radius:50%", { background: orb(c.hue) })} />
                  )}
                  <div style={sx("flex:1;display:flex;flex-direction:column;gap:3px;min-width:0")}>
                    <span style={sx("font-size:15px;font-weight:600")}>{c.name}</span>
                    <span style={sx("font-size:13px;color:#aeb0c6")}>{c.sub}</span>
                    <span style={sx("font-size:14px;color:#f0c96e;font-weight:600")}>{nt(c.price * c.qty)}</span>
                  </div>
                  <div style={sx("display:flex;align-items:center;gap:6px")}>
                    <button type="button" onClick={() => setQty(c.id, -1)} aria-label={`減少 ${c.name}`} className="tap-sq" style={sx("width:32px;height:32px;border-radius:50%;border:0;background:#2a3358;color:#f6f0e1;cursor:pointer;font-size:16px")}>
                      −
                    </button>
                    <span aria-live="polite" style={sx("min-width:20px;text-align:center;font-weight:600")}>{c.qty}</span>
                    <button type="button" onClick={() => setQty(c.id, 1)} aria-label={`增加 ${c.name}`} className="tap-sq" style={sx("width:32px;height:32px;border-radius:50%;border:0;background:#2a3358;color:#f6f0e1;cursor:pointer;font-size:16px")}>
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="drawer-foot" style={sx("padding:20px 24px;border-top:1px solid #2a3358;display:flex;flex-direction:column;gap:14px")}>
              <div style={sx("display:flex;justify-content:space-between;font-size:20px;font-weight:700")}>
                <span>合計</span>
                <span>{nt(total)}</span>
              </div>
              <button
                type="button"
                disabled={cart.length === 0}
                onClick={() => cart.length && setStep("form")}
                className={cart.length ? "h-bg-gold" : undefined}
                style={{ ...primary, opacity: cart.length ? 1 : 0.45 }}
              >
                前往結帳 →
              </button>
            </div>
          </>
        )}

        {step === "form" && (
          <form onSubmit={submit} className="drawer-scroll drawer-foot" style={sx("flex:1;overflow:auto;padding:20px 24px;display:flex;flex-direction:column;gap:16px")}>
            <label style={label}>
              <span>收件人<span aria-hidden="true" style={sx("color:#f2a99a;margin-left:2px")}>*</span></span>
              <input required name="name" autoComplete="name" maxLength={40} className="field" data-autofocus />
            </label>
            <label style={label}>
              <span>手機<span aria-hidden="true" style={sx("color:#f2a99a;margin-left:2px")}>*</span></span>
              <input required name="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength={20} pattern="[+0-9\s\-]{8,20}" className="field" />
            </label>
            <label style={label}>
              <span>Email<span aria-hidden="true" style={sx("color:#f2a99a;margin-left:2px")}>*</span></span>
              <input required name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={100} className="field" aria-describedby="email-note" />
              <span id="email-note" style={sx("font-size:12px;color:#8e90a8;line-height:1.5")}>付款完成後，電子發票會寄到這個信箱</span>
            </label>
            <label style={label}>
              取貨方式
              <select name="ship" className="field">
                {SHIPPING_OPTIONS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label style={label}>
              付款方式
              <select name="pay" className="field" aria-describedby="pay-note">
                {PAYMENT_OPTIONS.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <span id="pay-note" style={sx("font-size:12px;color:#8e90a8;line-height:1.5")}>下單後會前往黑貓PAY（統一金流）信用卡安全付款頁</span>
            </label>
            <div style={sx("display:flex;justify-content:space-between;font-size:20px;font-weight:700;margin-top:auto;padding-top:12px")}>
              <span>合計</span>
              <span>{nt(total)}</span>
            </div>
            {error && (
              <span role="alert" style={sx("font-size:14px;color:#f2a99a;line-height:1.6")}>
                {error}
              </span>
            )}
            <button type="submit" disabled={busy} className="h-bg-gold" style={{ ...primary, opacity: busy ? 0.7 : 1 }}>
              {busy ? "前往付款頁…" : "確認下單並付款"}
            </button>
            <button type="button" onClick={() => setStep("cart")} className="h-text-gold tap" style={sx("background:none;border:0;color:#aeb0c6;font-size:15px;cursor:pointer;min-height:44px")}>
              ← 回購物車
            </button>
          </form>
        )}

        {step === "done" && (
          <div className="drawer-foot" style={sx("flex:1;padding:40px 24px;display:flex;flex-direction:column;gap:16px;align-items:flex-start")}>
            <span aria-hidden="true" style={sx("width:72px;height:72px;border-radius:50%;box-shadow:0 0 40px rgba(240,201,110,.5)", { background: GOLD_ORB })} />
            <span className="wk" style={sx("font-size:30px;font-weight:700")}>寶寶出發囉！</span>
            <span style={sx("font-size:16px;line-height:1.7;color:#cfcbe0")}>訂單已成立，出貨通知會傳到你的手機。現在去報名一場聚會，帶它出門見見朋友吧。</span>
            {pendingPay && <span style={sx("font-size:13px;line-height:1.6;color:#8e90a8")}>付款方式我們會盡快與你聯繫確認。</span>}
            <button
              type="button"
              data-autofocus
              onClick={() => {
                closeCart();
                router.push("/events");
              }}
              className="h-bg-gold"
              style={sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer")}
            >
              看近期聚會 →
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
