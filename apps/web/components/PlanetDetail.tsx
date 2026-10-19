"use client";

import Link from "next/link";
import { useState } from "react";
import { glow, orb, pad, type Planet } from "@planet/shared";
import { useStore } from "@/lib/store";
import { sx } from "@/lib/sx";

export function MyPlanet({ planets }: { planets: Planet[] }) {
  const hydrated = useStore((s) => s.hydrated);
  const result = useStore((s) => s.result);
  const idx = planets.findIndex((p) => p.id === result);

  if (!hydrated) return <section style={sx("min-height:60vh")} aria-busy="true" />;

  if (idx < 0) {
    return (
      <section className="gutter" style={sx("max-width:640px;margin:0 auto;padding:96px clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:20px;align-items:flex-start")}>
        <h2 className="wk" style={sx("margin:0;font-size:40px")}>你還沒有星球喔</h2>
        <p style={sx("margin:0;font-size:18px;color:#cfcbe0")}>先做個 2 分鐘的測驗吧。</p>
        <Link href="/quiz" className="h-bg-gold" style={sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px 28px;font-size:18px;font-weight:600;cursor:pointer;text-decoration:none")}>
          開始測驗 →
        </Link>
      </section>
    );
  }

  const p = planets[idx];
  const helpers = p.helper_planet_ids.map((id) => planets.find((x) => x.id === id)).filter((x): x is Planet => !!x);
  const card = sx("background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:26px;display:flex;flex-direction:column;gap:14px");

  return (
    <section data-screen-label="Result" className="gutter" style={sx("max-width:1240px;margin:0 auto;padding:clamp(32px,6vw,80px) clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:40px")}>
      <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:40px;align-items:center")}>
        <div style={sx("display:flex;justify-content:center")}>
          <div aria-hidden="true" style={sx("width:min(80vw,380px);aspect-ratio:1;border-radius:50%;animation:floaty 5s ease-in-out infinite", { background: orb(p.hue), boxShadow: `0 0 90px ${glow(p.hue)}` })} />
        </div>
        <div style={sx("display:flex;flex-direction:column;gap:18px")}>
          <span style={sx("font-size:15px;font-weight:600;color:#f0c96e")}>測驗結果 · 你來自 {pad(idx + 1)} 號星球</span>
          <h1 className="wk" style={sx("margin:0;font-size:clamp(56px,8vw,104px);line-height:1.05;font-weight:700")}>{p.name}</h1>
          <span style={sx("font-size:22px;font-weight:600")}>
            {p.en} · {p.tagline}
          </span>
          <p style={sx("margin:0;font-size:18px;line-height:1.8;color:#cfcbe0;max-width:32em")}>{p.description}</p>
          <div style={sx("display:flex;gap:12px;flex-wrap:wrap;margin-top:6px")}>
            <Link href={`/shop?planet=${p.slug}`} className="h-bg-gold" style={sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:15px 26px;font-size:17px;font-weight:600;cursor:pointer;text-decoration:none")}>
              領養我的星球寶寶 →
            </Link>
            <Link href="/quiz" className="h-border-gold" style={sx("background:transparent;color:#f6f0e1;border:1.5px solid #4c5684;border-radius:999px;padding:14px 22px;font-size:17px;cursor:pointer;text-decoration:none")}>
              再測一次
            </Link>
          </div>
        </div>
      </div>
      <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px")}>
        <div style={card}>
          <span style={sx("font-size:15px;font-weight:600;color:#f0c96e")}>你的超能力</span>
          {p.strengths.map((t) => (
            <span key={t} style={sx("font-size:18px;font-weight:600")}>
              ✦ {t}
            </span>
          ))}
        </div>
        <div style={card}>
          <span style={sx("font-size:15px;font-weight:600;color:#f2a99a")}>你的小卡關</span>
          <span style={sx("font-size:18px;line-height:1.7")}>{p.weakness}</span>
        </div>
        <div style={card}>
          <span style={sx("font-size:15px;font-weight:600;color:#9fd8c4")}>聚會時，你最會</span>
          <span style={sx("font-size:18px;line-height:1.7")}>{p.meetup_role}</span>
        </div>
      </div>
      <div style={sx("background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:clamp(22px,3vw,32px);display:flex;flex-direction:column;gap:18px")}>
        <span style={sx("font-size:20px;font-weight:700")}>卡關時，可以找這兩顆星球聊聊</span>
        <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px")}>
          {helpers.map((h) => (
            <Link key={h.id} href={`/planets/${h.slug}`} className="h-bg-line" style={sx("display:flex;align-items:center;gap:16px;background:#222b4f;border:0;border-radius:18px;padding:16px;cursor:pointer;color:#f6f0e1;text-align:left;text-decoration:none")}>
              <span aria-hidden="true" style={sx("flex:0 0 52px;height:52px;border-radius:50%", { background: orb(h.hue) })} />
              <span style={sx("display:flex;flex-direction:column;gap:4px")}>
                <span style={sx("font-size:18px;font-weight:700")}>{h.name}</span>
                <span style={sx("font-size:14px;color:#cfcbe0")}>{h.tagline}</span>
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export function PlanetsBrowser({ planets, initialSlug }: { planets: Planet[]; initialSlug: string | null }) {
  const result = useStore((s) => s.result);
  const hydrated = useStore((s) => s.hydrated);
  const initialIdx = initialSlug ? Math.max(0, planets.findIndex((p) => p.slug === initialSlug)) : -1;
  const [picked, setPicked] = useState(initialIdx);
  // /planets（無 slug）：預設選中我的星球，否則第一顆
  const sel = picked >= 0 ? picked : hydrated && result !== null ? Math.max(0, planets.findIndex((p) => p.id === result)) : 0;
  const cur = planets[sel];

  function select(i: number) {
    setPicked(i);
    window.history.replaceState(window.history.state, "", `/planets/${planets[i].slug}`);
    // 手機單欄時詳細卡在上方，選完捲回去
    const card = document.getElementById("planet-detail");
    if (card && card.getBoundingClientRect().top < 0) card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section data-screen-label="Planets" className="gutter" style={sx("max-width:1240px;margin:0 auto;padding:clamp(32px,6vw,72px) clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:32px")}>
      <h1 className="wk" style={sx("margin:0;font-size:clamp(36px,5vw,60px);font-weight:700")}>12 顆星球</h1>
      <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));gap:28px;align-items:start")}>
        <div id="planet-detail" aria-live="polite" style={sx("background:#19213f;border:1px solid #2a3358;border-radius:28px;padding:clamp(24px,3vw,36px);display:flex;flex-direction:column;gap:16px;scroll-margin-top:120px")}>
          <div style={sx("display:flex;align-items:center;gap:20px")}>
            <span aria-hidden="true" style={sx("flex:0 0 112px;height:112px;border-radius:50%", { background: orb(cur.hue), boxShadow: `0 0 40px ${glow(cur.hue)}` })} />
            <div style={sx("display:flex;flex-direction:column;gap:6px;min-width:0")}>
              <span style={sx("font-size:14px;color:#aeb0c6")}>
                {pad(sel + 1)} · {cur.en}
              </span>
              <span className="wk" style={sx("font-size:38px;font-weight:700")}>{cur.name}</span>
              <span style={sx("font-size:17px;font-weight:600;color:#f0c96e")}>{cur.tagline}</span>
            </div>
          </div>
          <p style={sx("margin:0;font-size:17px;line-height:1.8;color:#cfcbe0")}>{cur.description}</p>
          <div style={sx("display:flex;gap:8px;flex-wrap:wrap")}>
            {cur.strengths.map((t) => (
              <span key={t} style={sx("font-size:14px;font-weight:600;background:#2a3358;border-radius:999px;padding:6px 12px")}>
                {t}
              </span>
            ))}
          </div>
          <span style={sx("font-size:16px;line-height:1.7")}>
            <span style={sx("color:#f2a99a;font-weight:600")}>小卡關：</span>
            {cur.weakness}
          </span>
          <span style={sx("font-size:16px;line-height:1.7")}>
            <span style={sx("color:#9fd8c4;font-weight:600")}>專屬造型：</span>
            {cur.kit_name}
          </span>
          <Link href={`/shop?planet=${cur.slug}`} className="h-bg-gold" style={sx("align-self:flex-start;background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:13px 22px;font-size:16px;font-weight:600;cursor:pointer;text-decoration:none")}>
            領養{cur.name}寶寶 →
          </Link>
        </div>
        <div style={sx("display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px")}>
          {planets.map((p, i) => {
            const on = sel === i;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => select(i)}
                aria-pressed={on}
                className="h-border-gold"
                style={sx("border-radius:20px;padding:18px 12px;display:flex;flex-direction:column;align-items:center;gap:10px;cursor:pointer;color:#f6f0e1", {
                  background: on ? "#222b4f" : "#19213f",
                  border: `1.5px solid ${on ? "#f0c96e" : "#2a3358"}`,
                })}
              >
                <span aria-hidden="true" style={sx("width:60px;height:60px;border-radius:50%;display:block", { background: orb(p.hue) })} />
                <span style={sx("font-size:16px;font-weight:700")}>{p.name}</span>
                <span style={sx("font-size:12px;color:#f0c96e;min-height:14px")}>{hydrated && result === p.id ? "你的星球" : ""}</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

