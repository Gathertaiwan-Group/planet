export type EventType = "same" | "cross" | "open";
export type Letter = "A" | "B" | "C" | "D";

export interface Planet {
  id: number;
  slug: string;
  name: string;
  en: string;
  hue: number;
  tagline: string;
  description: string;
  strengths: string[];
  weakness: string;
  meetup_role: string;
  kit_name: string;
  helper_planet_ids: number[];
}

export interface QuizOption {
  letter: Letter;
  text: string;
  primary_planet_id: number;
  secondary_planet_id: number;
}

export interface QuizQuestion {
  id: number;
  text: string;
  options: QuizOption[];
}

export interface Plant {
  id: number;
  name: string;
  note: string | null;
  price_twd: number;
  image_url?: string | null;
}

export interface Product {
  sku: string;
  name: string;
  price_twd: number;
  image_url?: string | null;
}

export interface PlanetEvent {
  /** DB uuid；seed fallback 時為 null（無法報名） */
  id: string | null;
  slug: string;
  starts_at: string;
  city: string;
  venue: string | null;
  type: EventType;
  planet_id: number | null;
  title: string;
  description: string | null;
  price_twd: number;
  capacity: number;
  seats_left: number;
}

export interface Catalog {
  planets: Planet[];
  questions: QuizQuestion[];
  plants: Plant[];
  products: Product[];
  events: PlanetEvent[];
  kitPrice: number;
  source: "db" | "seed";
}

export const SHIPPING_OPTIONS = ["超商取貨", "宅配到府", "聚會現場取貨"] as const;
export const PAYMENT_OPTIONS = ["信用卡", "LINE Pay", "ATM 轉帳"] as const;
export type Shipping = (typeof SHIPPING_OPTIONS)[number];
export type PaymentMethod = (typeof PAYMENT_OPTIONS)[number];

/** 送到 server 的購物車品項（只帶 id 與數量，價格一律由 server 用 DB 重算） */
export type OrderItemInput =
  | { kind: "baby"; planet_id: number; plant_id: number; qty: number }
  | { kind: "extra"; sku: string; qty: number };
