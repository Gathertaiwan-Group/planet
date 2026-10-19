import type { Metadata } from "next";
import { PlanetsBrowser } from "@/components/PlanetDetail";
import { getCatalog } from "@/lib/data";

export const revalidate = 60;
export const metadata: Metadata = { title: "12 顆星球 · 十二星球" };

export default async function PlanetsPage() {
  const { planets } = await getCatalog();
  return <PlanetsBrowser planets={planets} initialSlug={null} />;
}
