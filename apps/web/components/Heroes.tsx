import Link from "next/link";
import { GOLD_ORB, glow, orb, pad, type Planet } from "@planet/shared";
import { sx } from "@/lib/sx";

const btnPrimary = "background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px 28px;font-size:18px;font-weight:600;cursor:pointer;box-shadow:0 8px 30px rgba(240,201,110,.3);text-decoration:none;display:inline-flex;align-items:center";
const btnSecondary = "background:transparent;color:#f6f0e1;border:1.5px solid #4c5684;border-radius:999px;padding:15px 24px;font-size:18px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center";

export function HeroOrbit({ planets }: { planets: Planet[] }) {
  return (
    <section
      data-screen-label="Home · 星軌"
      className="gutter"
      style={sx("max-width:1240px;margin:0 auto;padding:clamp(40px,7vw,96px) clamp(16px,4vw,40px);display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:48px;align-items:center")}
    >
      <div style={sx("display:flex;flex-direction:column;gap:24px")}>
        <span style={sx("align-self:flex-start;font-size:14px;font-weight:500;color:#f0c96e;border:1px solid #4a4a5e;border-radius:999px;padding:6px 14px")}>✦ 2 分鐘測驗 · 每月線下聚會</span>
        <h1 className="wk" style={sx("margin:0;font-weight:700;font-size:clamp(42px,6vw,76px);line-height:1.18")}>
          每個人，
          <br />
          都是從一顆<span style={sx("color:#f0c96e;white-space:nowrap")}>小星球</span>
          <br />
          來的。
        </h1>
        <p style={sx("margin:0;font-size:18px;line-height:1.75;color:#cfcbe0;max-width:30em")}>測測看你是哪顆星的人，領養專屬你的星球寶寶，然後帶著它出來玩。生活卡關？聚會現場，換別的星球幫你想。</p>
        <div style={sx("display:flex;gap:12px;flex-wrap:wrap")}>
          <Link href="/quiz" className="h-bg-gold" style={sx(btnPrimary)}>
            開始測驗 →
          </Link>
          <Link href="/events" className="h-border-text-gold" style={sx(btnSecondary)}>
            近期聚會
          </Link>
        </div>
      </div>
      <div style={sx("position:relative;width:100%;max-width:560px;justify-self:center;aspect-ratio:1")}>
        <div style={sx("position:absolute;inset:8%;border-radius:50%;border:1px dashed #3d4672")} />
        <div style={sx("position:absolute;inset:26%;border-radius:50%;border:1px dashed #2f375e")} />
        <div
          style={sx("position:absolute;left:34%;top:34%;width:32%;height:32%;border-radius:50%;box-shadow:0 0 60px rgba(240,201,110,.45);display:flex;align-items:center;justify-content:center;flex-direction:column;color:#3a2a0a", { background: GOLD_ORB })}
        >
          <span className="wk" style={sx("font-size:clamp(12px,2.2vw,22px);font-weight:700")}>你的星球</span>
          <span style={sx("font-size:clamp(16px,3.2vw,34px);font-weight:700")}>？</span>
        </div>
        {planets.map((p, i) => {
          const a = ((i * 30 - 90) * Math.PI) / 180;
          const size = i % 3 === 0 ? 13 : i % 3 === 1 ? 10 : 11.5;
          return (
            <Link
              key={p.id}
              href={`/planets/${p.slug}`}
              title={p.name}
              className="h-text-gold orbit-hit"
              style={sx("position:absolute;transform:translate(-50%,-50%);background:none;border:0;padding:0;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:6px;color:#f6f0e1;text-decoration:none", {
                left: `${(50 + 42 * Math.cos(a)).toFixed(4)}%`,
                top: `${(50 + 42 * Math.sin(a)).toFixed(4)}%`,
                width: `${size}%`,
              })}
            >
              <span style={sx("display:block;width:100%;aspect-ratio:1;border-radius:50%", { background: orb(p.hue), boxShadow: `0 0 22px ${glow(p.hue)}` })} />
              <span style={sx("font-size:13px;font-weight:500;white-space:nowrap")}>{p.name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export function HeroStorybook() {
  return (
    <section data-screen-label="Home · 繪本" className="gutter" style={sx("max-width:1240px;margin:0 auto;padding:clamp(32px,6vw,80px) clamp(16px,4vw,40px)")}>
      <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));background:#f6f0e1;color:#1f2340;border-radius:28px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.45)")}>
        <div className="book-illo" style={sx("min-height:420px;background:repeating-linear-gradient(135deg,#ece3cc 0 12px,#e5dbc1 12px 24px);display:flex;align-items:flex-end;padding:24px;border-right:2px solid #e0d4b6")}>
          <span style={sx("font-family:ui-monospace,Menlo,monospace;font-size:13px;color:#7a6c48;background:#f6f0e1;border-radius:8px;padding:6px 10px")}>插畫：星球寶寶坐在小星球上看夕陽</span>
        </div>
        <div style={sx("padding:clamp(28px,5vw,64px);display:flex;flex-direction:column;gap:22px")}>
          <span style={sx("font-size:14px;font-weight:600;color:#a0731f;letter-spacing:.08em")}>第一章 · CHAPTER ONE</span>
          <h1 className="wk" style={sx("margin:0;font-weight:700;font-size:clamp(36px,4.6vw,60px);line-height:1.22")}>
            從前從前，
            <br />
            宇宙裡有 12 顆小星球。
          </h1>
          <p style={sx("margin:0;font-size:18px;line-height:1.85;color:#454a6b")}>每顆星球住著不同個性的人：有的很會聽、有的很會衝、有的腦洞超大。你也是其中一顆星來的——要不要翻到下一頁，看看是哪一顆？</p>
          <div style={sx("display:flex;gap:12px;flex-wrap:wrap;margin-top:8px")}>
            <Link href="/quiz" className="h-book-dark" style={sx("background:#1f2340;color:#f0c96e;border:0;border-radius:999px;padding:16px 28px;font-size:18px;font-weight:600;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center")}>
              翻到下一頁：開始測驗 →
            </Link>
            <Link href="/planets" className="h-book-light" style={sx("background:transparent;color:#1f2340;border:1.5px solid #1f2340;border-radius:999px;padding:15px 22px;font-size:17px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center")}>
              先看 12 顆星球
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export function HeroCarousel({ planets }: { planets: Planet[] }) {
  return (
    <section data-screen-label="Home · 星球列車" style={sx("padding:clamp(48px,8vw,104px) 0 clamp(32px,5vw,64px)")}>
      <div className="gutter" style={sx("max-width:1240px;margin:0 auto;padding:0 clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:22px;align-items:center;text-align:center")}>
        <h1 className="wk" style={sx("margin:0;font-weight:700;font-size:clamp(42px,6.4vw,84px);line-height:1.16")}>
          嘿，你是<span style={sx("color:#f0c96e")}>哪顆星</span>的？
        </h1>
        <p style={sx("margin:0;font-size:18px;line-height:1.75;color:#cfcbe0;max-width:32em")}>8 題測驗，把你分配到 12 顆星球之一。每顆星都有自己的超能力，也有自己的小卡關——所以我們才要聚在一起。</p>
        <Link href="/quiz" className="h-bg-gold" style={sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px 30px;font-size:18px;font-weight:600;cursor:pointer;box-shadow:0 8px 30px rgba(240,201,110,.3);text-decoration:none;display:inline-flex;align-items:center")}>
          測出我的星球 →
        </Link>
      </div>
      <div
        className="gutter no-scrollbar"
        style={sx("margin-top:48px;display:flex;gap:16px;overflow-x:auto;padding:12px clamp(16px,4vw,40px) 24px;scroll-snap-type:x mandatory;scroll-padding-inline:clamp(16px,4vw,40px)")}
      >
        {planets.map((p, i) => (
          <Link
            key={p.id}
            href={`/planets/${p.slug}`}
            className="h-border-gold"
            style={sx("flex:0 0 200px;scroll-snap-align:start;background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:22px 18px;display:flex;flex-direction:column;gap:12px;align-items:flex-start;cursor:pointer;color:#f6f0e1;text-align:left;text-decoration:none")}
          >
            <span style={sx("font-size:13px;color:#aeb0c6")}>
              {pad(i + 1)} · {p.en}
            </span>
            <span style={sx("display:block;width:96px;height:96px;border-radius:50%;align-self:center;margin:6px 0", { background: orb(p.hue), boxShadow: `0 0 26px ${glow(p.hue)}` })} />
            <span className="wk" style={sx("font-size:22px;font-weight:700")}>{p.name}</span>
            <span style={sx("font-size:14px;color:#cfcbe0")}>{p.tagline}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
