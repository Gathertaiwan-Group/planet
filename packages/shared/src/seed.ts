import raw from "./seed.json";
import { PRODUCT_IMAGE_BASE } from "./images";
import type { Catalog, EventType, Letter, Planet, PlanetEvent, Plant, Product, QuizQuestion } from "./types";

interface RawSeed {
  planets: Planet[];
  quiz: { id: number; text: string; options: { letter: string; text: string; primary_planet_id: number; secondary_planet_id: number }[] }[];
  plants: { id: number; name: string; note: string; price_twd: number }[];
  kit_price_twd: number;
  extras: { sku: string; name: string; price_twd: number }[];
  events: {
    slug: string;
    date: string;
    weekday: string;
    time: string;
    city: string;
    type: string;
    planet_id: number | null;
    title: string;
    description: string;
    price_twd: number;
    seats_left: number;
  }[];
}

export const seedRaw = raw as RawSeed;

export const seedPlanets: Planet[] = seedRaw.planets;
export const seedQuestions: QuizQuestion[] = seedRaw.quiz.map((q) => ({
  id: q.id,
  text: q.text,
  options: q.options.map((o) => ({ ...o, letter: o.letter as Letter })),
}));
export const seedPlants: Plant[] = seedRaw.plants.map((p) => ({ ...p, image_url: `${PRODUCT_IMAGE_BASE}plants/${p.id}.jpg` }));
export const seedProducts: Product[] = seedRaw.extras.map((x) => ({ ...x, image_url: `${PRODUCT_IMAGE_BASE}products/${x.sku}.jpg` }));
export const seedKitPrice = seedRaw.kit_price_twd;

/** seed 的日期＋時間視為台北時間（+08:00） */
export const seedEventStartsAt = (date: string, time: string) => `${date}T${time}:00+08:00`;

export const seedEvents: PlanetEvent[] = seedRaw.events.map((e) => ({
  id: null,
  slug: e.slug,
  starts_at: seedEventStartsAt(e.date, e.time),
  city: e.city,
  venue: null,
  type: e.type as EventType,
  planet_id: e.planet_id,
  title: e.title,
  description: e.description,
  price_twd: e.price_twd,
  capacity: e.seats_left,
  seats_left: e.seats_left,
}));

export function seedCatalog(): Catalog {
  return {
    planets: seedPlanets,
    questions: seedQuestions,
    plants: seedPlants,
    products: seedProducts,
    events: seedEvents,
    kitPrice: seedKitPrice,
    source: "seed",
  };
}
