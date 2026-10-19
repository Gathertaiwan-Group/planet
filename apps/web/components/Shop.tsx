"use client";

import { useEffect, useRef, useState } from "react";
import { glow, nt, orb, type Planet, type Plant, type Product } from "@planet/shared";
import { useStore } from "@/lib/store";
import { sx } from "@/lib/sx";

const stripes = "repeating-linear-gradient(135deg,#1d2649 0 12px,#222b4f 12px 24px)";

export function Shop({ planets, plants, products, kitPrice }: { planets: Planet[]; plants: Plant[]; products: Product[]; kitPrice: number }) {
  const hydrated = useStore((s) => s.hydrated);
  const result = useStore((s) => s.result);
  const addItem = useStore((s) => s.addItem);
  const [kitIdx, setKitIdx] = useState<number | null>(null);
  const [plantIdx, setPlantIdx] = useState(0);
  const [added, setAdded] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  const previewRef = useRef<HTMLDivElement>(null);

  // 預設造型：URL ?planet= ＞ 測驗結果 ＞ 第 1 顆
  useEffect(() => {
    if (!hydrated || kitIdx !== null) return;
    const slug = new URLSearchParams(window.location.search).get("planet");
    const fromUrl = slug ? planets.findIndex((p) => p.slug === slug) : -1;
    const fromResult = result !== null ? planets.findIndex((p) => p.id === result) : -1;
    setKitIdx(fromUrl >= 0 ? fromUrl : fromResult >= 0 ? fromResult : 0);
  }, [hydrated, result, planets, kitIdx]);

  // 手機：預覽卡不在畫面上時顯示底部「加入購物車」列
  useEffect(() => {
    const el = previewRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([en]) => setPreviewVisible(en.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const ki = kitIdx ?? 0;
  const bp = planets[ki];
  const pl = plants[plantIdx] ?? plants[0];

  const flash = () => {
    setAdded(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAdded(false), 1400);
  };

  const addBuild = () => {
    addItem({ id: `b-${bp.id}-${pl.id}`, kind: "baby", planetId: bp.id, plantId: pl.id, name: `${bp.name}寶寶`, sub: `${pl.name} × ${bp.kit_name}`, price: pl.price_twd + kitPrice, hue: bp.hue });
    flash();
  };

  const choosePlanet = (i: number) => {
    setKitIdx(i);
    const url = new URL(window.location.href);
    url.searchParams.set("planet", planets[i].slug);
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  };

  const addLabel = added ? "已加入購物車 ✓" : "加入購物車";

  return (
    <section data-screen-label="Shop" className="gutter has-shop-bar" style={sx("max-width:1240px;margin:0 auto;padding:clamp(32px,6vw,72px) clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:32px")}>
      <div style={sx("display:flex;flex-direction:column;gap:12px")}>
        <h1 className="wk" style={sx("margin:0;font-size:clamp(36px,5vw,60px);font-weight:700")}>領養星球寶寶</h1>
        <p style={sx("margin:0;font-size:17px;color:#cfcbe0")}>植栽你挑，造型由星球決定。</p>
      </div>
      <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,400px),1fr));gap:28px;align-items:start")}>
        <div style={sx("display:flex;flex-direction:column;gap:28px")}>
          <div style={sx("display:flex;flex-direction:column;gap:14px")}>
            <span id="kit-label" style={sx("font-size:18px;font-weight:700")}>
              <span style={sx("color:#f0c96e")}>1</span> 選星球造型
            </span>
            <div role="group" aria-labelledby="kit-label" style={sx("display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px")}>
              {planets.map((p, i) => {
                const on = ki === i;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => choosePlanet(i)}
                    style={sx("border-radius:18px;padding:12px 6px;display:flex;flex-direction:column;align-items:center;gap:8px;cursor:pointer;color:#f6f0e1", {
                      background: on ? "#222b4f" : "#19213f",
                      border: `1.5px solid ${on ? "#f0c96e" : "#2a3358"}`,
                    })}
                  >
                    <span aria-hidden="true" style={sx("width:40px;height:40px;border-radius:50%;display:block", { background: orb(p.hue) })} />
                    <span style={sx("font-size:14px;font-weight:600")}>{p.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div style={sx("display:flex;flex-direction:column;gap:14px")}>
            <span id="plant-label" style={sx("font-size:18px;font-weight:700")}>
              <span style={sx("color:#f0c96e")}>2</span> 選你的植栽
            </span>
            <div role="group" aria-labelledby="plant-label" style={sx("display:flex;flex-direction:column;gap:8px")}>
              {plants.map((o, i) => {
                const on = plantIdx === i;
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setPlantIdx(i)}
                    style={sx("display:flex;justify-content:space-between;align-items:center;gap:12px;border-radius:16px;padding:14px 18px;cursor:pointer;color:#f6f0e1;text-align:left", {
                      background: on ? "#222b4f" : "#19213f",
                      border: `1.5px solid ${on ? "#f0c96e" : "#2a3358"}`,
                    })}
                  >
                    <span style={sx("display:flex;flex-direction:column;gap:3px")}>
                      <span style={sx("font-size:16px;font-weight:600")}>{o.name}</span>
                      <span style={sx("font-size:13px;color:#aeb0c6")}>{o.note}</span>
                    </span>
                    <span style={sx("font-size:15px;font-weight:600;color:#f0c96e;white-space:nowrap")}>{nt(o.price_twd)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div ref={previewRef} style={sx("position:sticky;top:88px;background:#19213f;border:1px solid #2a3358;border-radius:28px;padding:20px;display:flex;flex-direction:column;gap:18px")}>
          <div style={sx("position:relative;aspect-ratio:4/3;border-radius:20px;display:flex;align-items:flex-end;padding:16px", { background: stripes })}>
            <span aria-hidden="true" style={sx("position:absolute;top:18px;right:18px;width:64px;height:64px;border-radius:50%", { background: orb(bp.hue), boxShadow: `0 0 30px ${glow(bp.hue)}` })} />
            <span style={sx("font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#cfcbe0;background:#10162e;border-radius:8px;padding:6px 10px")}>
              產品照：{pl.name} ＋ {bp.kit_name}
            </span>
          </div>
          <div style={sx("display:flex;flex-direction:column;gap:6px")}>
            <span style={sx("font-size:14px;color:#f0c96e;font-weight:600")}>{bp.name}寶寶</span>
            <span style={sx("font-size:24px;font-weight:700")}>
              {pl.name} × {bp.kit_name}
            </span>
          </div>
          <div style={sx("display:flex;flex-direction:column;gap:6px;font-size:15px;color:#cfcbe0;border-top:1px solid #2a3358;padding-top:14px")}>
            <div style={sx("display:flex;justify-content:space-between")}>
              <span>{pl.name}</span>
              <span>{nt(pl.price_twd)}</span>
            </div>
            <div style={sx("display:flex;justify-content:space-between")}>
              <span>{bp.kit_name}</span>
              <span>{nt(kitPrice)}</span>
            </div>
            <div style={sx("display:flex;justify-content:space-between;font-size:20px;font-weight:700;color:#f6f0e1;margin-top:6px")}>
              <span>合計</span>
              <span>{nt(pl.price_twd + kitPrice)}</span>
            </div>
          </div>
          <button type="button" onClick={addBuild} className="h-bg-gold" aria-live="polite" style={sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px;font-size:17px;font-weight:600;cursor:pointer")}>
            {addLabel}
          </button>
        </div>
      </div>
      <div style={sx("display:flex;flex-direction:column;gap:16px")}>
        <h2 className="wk" style={sx("margin:0;font-size:30px")}>寶寶周邊</h2>
        <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,240px),1fr));gap:16px")}>
          {products.map((x) => (
            <div key={x.sku} style={sx("background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:16px;display:flex;flex-direction:column;gap:12px")}>
              <div style={sx("aspect-ratio:4/3;border-radius:16px;display:flex;align-items:flex-end;padding:12px", { background: stripes })}>
                <span style={sx("font-family:ui-monospace,Menlo,monospace;font-size:12px;color:#cfcbe0;background:#10162e;border-radius:8px;padding:5px 9px")}>產品照：{x.name}</span>
              </div>
              <span style={sx("font-size:18px;font-weight:700")}>{x.name}</span>
              <div style={sx("display:flex;justify-content:space-between;align-items:center")}>
                <span style={sx("font-size:16px;font-weight:600;color:#f0c96e")}>{nt(x.price_twd)}</span>
                <button
                  type="button"
                  onClick={() => {
                    addItem({ id: x.sku, kind: "extra", sku: x.sku, name: x.name, sub: "周邊", price: x.price_twd, hue: 85 });
                    flash();
                  }}
                  aria-label={`加入 ${x.name}`}
                  className="h-add tap"
                  style={sx("background:#2a3358;color:#f6f0e1;border:0;border-radius:999px;padding:9px 16px;font-size:14px;font-weight:600;cursor:pointer")}
                >
                  加入
                </button>
              </div>
            </div>
          ))}
        </div>
        <span style={sx("font-size:13px;color:#8e90a8")}>＊價格為示意，請依實際定價調整。</span>
      </div>

      <div
        className="shop-bar"
        data-hidden={previewVisible ? "true" : "false"}
        aria-hidden={previewVisible}
        style={sx("position:fixed;left:0;right:0;bottom:0;z-index:30;align-items:center;gap:12px;background:rgba(21,28,56,.94);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid #2a3358;transition:transform .25s ease", {
          padding: "12px max(16px, env(safe-area-inset-right, 0px)) calc(12px + env(safe-area-inset-bottom, 0px)) max(16px, env(safe-area-inset-left, 0px))",
        })}
      >
        <span aria-hidden="true" style={sx("flex:0 0 40px;height:40px;border-radius:50%", { background: orb(bp.hue), boxShadow: `0 0 18px ${glow(bp.hue)}` })} />
        <span style={sx("display:flex;flex-direction:column;gap:2px;min-width:0;flex:1")}>
          <span style={sx("font-size:13px;color:#f0c96e;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis")}>
            {bp.name}寶寶 · {pl.name}
          </span>
          <span style={sx("font-size:18px;font-weight:700")}>{nt(pl.price_twd + kitPrice)}</span>
        </span>
        <button type="button" tabIndex={previewVisible ? -1 : 0} onClick={addBuild} style={sx("flex:0 0 auto;min-height:48px;background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:12px 20px;font-size:16px;font-weight:600;cursor:pointer")}>
          {addLabel}
        </button>
      </div>
    </section>
  );
}
