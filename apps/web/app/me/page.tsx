import type { Metadata } from "next";
import { MyPlanet } from "@/components/PlanetDetail";
import { getCatalog } from "@/lib/data";

export const revalidate = 60;
export const metadata: Metadata = { title: "我的星球 · 十二星球" };

export default async function MePage() {
  const { planets } = await getCatalog();
  return <MyPlanet planets={planets} />;
}
