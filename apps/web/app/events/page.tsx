import type { Metadata } from "next";
import { EventsList } from "@/components/Events";
import { getCatalog } from "@/lib/data";
import { sx } from "@/lib/sx";

export const revalidate = 60;
export const metadata: Metadata = { title: "線下聚會 · 十二星球" };

export default async function EventsPage() {
  const { events, planets } = await getCatalog();
  return (
    <section data-screen-label="Events" className="gutter" style={sx("max-width:1100px;margin:0 auto;padding:clamp(32px,6vw,72px) clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:28px")}>
      <div style={sx("display:flex;flex-direction:column;gap:12px")}>
        <h1 className="wk" style={sx("margin:0;font-size:clamp(36px,5vw,60px);font-weight:700")}>線下聚會</h1>
        <p style={sx("margin:0;font-size:17px;line-height:1.75;color:#cfcbe0;max-width:36em")}>同星球場：跟懂你的人互相打氣。跨星球場：每桌混搭不同星球，帶著你的卡關來，現場換個腦袋幫你想。記得帶星球寶寶！</p>
      </div>
      <EventsList events={events} planets={planets.map((p) => ({ id: p.id, name: p.name }))} />
    </section>
  );
}
