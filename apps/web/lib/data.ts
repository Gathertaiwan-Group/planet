import "server-only";
import { cache } from "react";
import { seedCatalog, type Catalog, type Letter, type PlanetEvent } from "@planet/shared";
import { readClient } from "./supabase";

async function loadFromDb(): Promise<Catalog | null> {
  const sb = readClient();
  if (!sb) return null;
  const nowIso = new Date().toISOString();
  const [planets, questions, options, plants, products, settings, events, seats] = await Promise.all([
    sb.from("planets").select("*").order("id"),
    sb.from("quiz_questions").select("*").order("id"),
    sb.from("quiz_options").select("question_id,letter,text,primary_planet_id,secondary_planet_id").order("question_id").order("letter"),
    sb.from("plants").select("id,name,note,price_twd,image_url").order("sort_order").order("id"),
    sb.from("products").select("sku,name,price_twd,image_url").order("sort_order").order("sku"),
    sb.from("settings").select("key,value").eq("key", "kit_price_twd"),
    sb.from("events").select("id,slug,starts_at,city,venue,type,planet_id,title,description,price_twd,capacity").gte("starts_at", nowIso).order("starts_at"),
    sb.from("event_seats").select("id,seats_left"),
  ]);
  const err = [planets, questions, options, plants, products, settings, events, seats].find((r) => r.error);
  if (err) throw err.error;
  if (!planets.data?.length || !questions.data?.length) return null;

  const seatMap = new Map((seats.data ?? []).map((s: any) => [s.id as string, s.seats_left as number]));
  const kit = Number(settings.data?.[0]?.value);
  return {
    planets: planets.data as any,
    questions: (questions.data as any[]).map((q) => ({
      id: q.id,
      text: q.text,
      options: (options.data as any[])
        .filter((o) => o.question_id === q.id)
        .map((o) => ({ letter: String(o.letter).trim() as Letter, text: o.text, primary_planet_id: o.primary_planet_id, secondary_planet_id: o.secondary_planet_id })),
    })),
    plants: plants.data as any,
    products: products.data as any,
    events: (events.data as any[]).map((e): PlanetEvent => ({ ...e, seats_left: seatMap.get(e.id) ?? e.capacity })),
    kitPrice: Number.isFinite(kit) && kit > 0 ? kit : seedCatalog().kitPrice,
    source: "db",
  };
}

/** 讀取全部目錄資料；Supabase 未設定或讀取失敗時 fallback 到 seed（build 時沒 env 也能成功） */
export const getCatalog = cache(async (): Promise<Catalog> => {
  try {
    const c = await loadFromDb();
    if (c) return c;
  } catch (e) {
    console.error("[data] Supabase 讀取失敗，改用 seed 資料：", (e as Error)?.message ?? e);
  }
  const seed = seedCatalog();
  return { ...seed, events: seed.events.filter((e) => new Date(e.starts_at).getTime() >= Date.now()) };
});
