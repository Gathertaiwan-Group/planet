import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlanetsBrowser } from "@/components/PlanetDetail";
import { getCatalog } from "@/lib/data";

export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  const { planets } = await getCatalog();
  return planets.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const { planets } = await getCatalog();
  const p = planets.find((x) => x.slug === slug);
  return p ? { title: `${p.name} · 十二星球`, description: `${p.tagline}。${p.description}` } : {};
}

export default async function PlanetPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { planets } = await getCatalog();
  if (!planets.some((p) => p.slug === slug)) notFound();
  return <PlanetsBrowser key={slug} planets={planets} initialSlug={slug} />;
}
