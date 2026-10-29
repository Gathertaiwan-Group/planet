"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import { nt, orb } from "@planet/shared";
import { cartCount, cartTotal, useStore } from "@/lib/store";
import { sx } from "@/lib/sx";
import { FramedImage } from "./ProductImage";
import { useOverlay } from "./useOverlay";

const primary = sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px;font-size:17px;font-weight:600;cursor:pointer");

/** 迷你購物車：只負責看商品、改數量；填寫資料與付款在 /checkout 專屬頁 */
export function CartDrawer() {
  const router = useRouter();
  const path = usePathname() || "/";
  const open = useStore((s) => s.cartOpen);
  const cart = useStore((s) => s.cart);
  const { closeCart, setQty } = useStore.getState();
  const ref = useRef<HTMLElement>(null);

  const close = useCallback(() => useStore.getState().closeCart(), []);
  useOverlay(open, close, ref);

  if (!open) return null;
  const total = cartTotal(cart);
  const count = cartCount(cart);
  const title = "購物車";

  function goCheckout() {
    if (!cart.length) return;
    closeCart();
    if (path !== "/checkout") router.push("/checkout");
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
          <span style={sx("font-size:20px;font-weight:700")}>
            {title}
            {count > 0 && <span style={sx("font-size:15px;font-weight:500;color:#aeb0c6;margin-left:8px")}>{count} 件</span>}
          </span>
          <button type="button" onClick={closeCart} aria-label="關閉" className="tap-sq" style={sx("background:#222b4f;color:#f6f0e1;border:0;border-radius:50%;width:40px;height:40px;font-size:18px;cursor:pointer")}>
            ✕
          </button>
        </div>

            <div className="drawer-scroll" style={sx("flex:1;overflow:auto;padding:16px 24px;display:flex;flex-direction:column;gap:12px")}>
              {cart.length === 0 && (
                <div style={sx("display:flex;flex-direction:column;gap:16px;align-items:flex-start;padding:24px 0")}>
                  <span style={sx("color:#aeb0c6;font-size:16px")}>購物車空空的，去領養一隻寶寶吧。</span>
                  {path !== "/shop" && (
                    <button
                      type="button"
                      data-autofocus
                      onClick={() => {
                        closeCart();
                        router.push("/shop");
                      }}
                      className="h-border-text-gold tap"
                      style={sx("background:none;border:1.5px solid #3d4672;color:#f6f0e1;border-radius:999px;padding:10px 20px;font-size:15px;cursor:pointer")}
                    >
                      去逛星球寶寶 →
                    </button>
                  )}
                </div>
              )}
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
        {cart.length > 0 && (
          <div className="drawer-foot" style={sx("padding:20px 24px;border-top:1px solid #2a3358;display:flex;flex-direction:column;gap:12px")}>
            <div style={sx("display:flex;justify-content:space-between;align-items:baseline;font-size:20px;font-weight:700")}>
              <span>小計</span>
              <span>{nt(total)}</span>
            </div>
            <span style={sx("font-size:13px;color:#8e90a8;line-height:1.5")}>下一步填寫聯絡與取貨資料，再前往信用卡安全付款頁。</span>
            <button type="button" data-autofocus onClick={goCheckout} className="h-bg-gold" style={primary}>
              前往結帳 →
            </button>
            <button type="button" onClick={closeCart} className="h-text-gold tap" style={sx("background:none;border:0;color:#aeb0c6;font-size:15px;cursor:pointer;min-height:44px")}>
              繼續逛逛
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}
