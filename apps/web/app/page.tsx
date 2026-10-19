import Link from "next/link";
import { HomeEventCard } from "@/components/Events";
import { HeroCarousel, HeroOrbit, HeroStorybook } from "@/components/Heroes";
import { getCatalog } from "@/lib/data";
import { sx } from "@/lib/sx";

export const revalidate = 60;

const STEPS = [
  ["01", "做測驗，找到星球", "8 題小問題，看看你的個性住在哪顆星。"],
  ["02", "領養星球寶寶", "挑一株喜歡的燈泡植栽，配上你星球專屬的造型。"],
  ["03", "帶著寶寶來聚會", "同星球的人互相打氣，不同星球的人幫你解卡關。"],
] as const;

export default async function HomePage() {
  const { planets, events } = await getCatalog();
  const hero = process.env.NEXT_PUBLIC_HERO;
  const names = planets.map((p) => ({ id: p.id, name: p.name }));
  return (
    <>
      {hero === "storybook" ? <HeroStorybook /> : hero === "carousel" ? <HeroCarousel planets={planets} /> : <HeroOrbit planets={planets} />}

      <section className="gutter" style={sx("max-width:1240px;margin:0 auto;padding:clamp(32px,5vw,64px) clamp(16px,4vw,40px)")}>
        <h2 className="wk" style={sx("margin:0 0 28px;font-size:clamp(28px,3.4vw,40px);font-weight:700")}>三步，加入星球派對</h2>
        <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px")}>
          {STEPS.map(([no, title, body]) => (
            <div key={no} style={sx("background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:28px;display:flex;flex-direction:column;gap:10px")}>
              <span style={sx("font-size:40px;font-weight:700;color:#f0c96e")}>{no}</span>
              <span style={sx("font-size:20px;font-weight:700")}>{title}</span>
              <span style={sx("font-size:16px;line-height:1.7;color:#cfcbe0")}>{body}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="gutter" style={sx("max-width:1240px;margin:0 auto;padding:clamp(16px,3vw,32px) clamp(16px,4vw,40px) clamp(48px,7vw,96px)")}>
        <div style={sx("display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px")}>
          <h2 className="wk" style={sx("margin:0;font-size:clamp(28px,3.4vw,40px);font-weight:700")}>近期聚會</h2>
          <Link href="/events" className="h-text-gold tap-inline" style={sx("background:none;border:0;color:#f0c96e;font-size:16px;font-weight:500;cursor:pointer;padding:6px 0;text-decoration:none")}>
            全部活動 →
          </Link>
        </div>
        <div style={sx("display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px")}>
          {events.slice(0, 3).map((e) => (
            <HomeEventCard key={e.slug} e={e} planets={names} />
          ))}
        </div>
      </section>
    </>
  );
}
