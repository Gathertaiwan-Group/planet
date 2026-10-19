import type { Metadata } from "next";
import { Shop } from "@/components/Shop";
import { getCatalog } from "@/lib/data";

export const revalidate = 60;
export const metadata: Metadata = { title: "領養星球寶寶 · 十二星球" };

export default async function ShopPage() {
  const { planets, plants, products, kitPrice } = await getCatalog();
  return <Shop planets={planets} plants={plants} products={products} kitPrice={kitPrice} />;
}
