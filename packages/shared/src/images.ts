/** Supabase Storage public bucket（芯宸官網產品照） */
export const PRODUCT_IMAGE_BASE = "https://ozwftlkgqmewtadypsfi.supabase.co/storage/v1/object/public/planet-products/";

export const BRAND_IMAGES = {
  bagCharm: `${PRODUCT_IMAGE_BASE}brand/bag-charm-lifestyle.jpg`,
  handHeld: `${PRODUCT_IMAGE_BASE}brand/hand-held-bulb.jpg`,
  bear: `${PRODUCT_IMAGE_BASE}brand/bear-bulb.jpg`,
  heroButterfly: `${PRODUCT_IMAGE_BASE}brand/hero-butterfly-bulb.jpg`,
} as const;

export interface Framing {
  /** 燈泡主體中心（%），同時作為 object-position 與 transform-origin */
  x: number;
  y: number;
  /** 4:3 預覽卡的放大倍率 */
  zoom: number;
  /** 正方形縮圖（列表、購物車）的放大倍率 */
  thumbZoom: number;
}

/**
 * 每張原圖的取景（逐張看過）：原圖 1200×~1080，燈泡在畫面中偏小，
 * 放大到燈泡約佔預覽高度 6–7 成、縮圖 7–8 成，且整顆燈泡（含銅蓋與植物）不被切到。
 */
const FRAMING: Record<string, Framing> = {
  "plants/1.jpg": { x: 49, y: 53, zoom: 1.5, thumbZoom: 1.7 },
  "plants/2.jpg": { x: 50, y: 30, zoom: 1.0, thumbZoom: 1.0 },
  "plants/3.jpg": { x: 49, y: 53, zoom: 1.45, thumbZoom: 1.7 },
  "plants/4.jpg": { x: 50, y: 53, zoom: 1.45, thumbZoom: 1.7 },
  "plants/5.jpg": { x: 49, y: 52, zoom: 1.0, thumbZoom: 1.2 },
  "plants/6.jpg": { x: 50, y: 60, zoom: 1.15, thumbZoom: 1.4 },
  "plants/7.jpg": { x: 49, y: 48, zoom: 1.45, thumbZoom: 1.75 },
  // 水晶版（芯宸官網水晶系列，原圖 1349×1213，燈泡本身就佔畫面大半）
  "plants/1-crystal.jpg": { x: 50, y: 54, zoom: 1.1, thumbZoom: 1.25 },
  "plants/3-crystal.jpg": { x: 50, y: 52, zoom: 1.1, thumbZoom: 1.25 },
  "plants/5-crystal.jpg": { x: 56, y: 46, zoom: 1.15, thumbZoom: 1.35 },
  "products/x1.jpg": { x: 52, y: 52, zoom: 1.0, thumbZoom: 1.05 },
  "products/x2.jpg": { x: 45, y: 50, zoom: 1.0, thumbZoom: 1.0 },
  "products/x3.jpg": { x: 50, y: 50, zoom: 1.0, thumbZoom: 1.0 },
};

const DEFAULT_FRAMING: Framing = { x: 50, y: 50, zoom: 1, thumbZoom: 1 };

export function framingFor(url: string | null | undefined): Framing {
  if (!url) return DEFAULT_FRAMING;
  const key = url.split("/planet-products/")[1]?.split("?")[0];
  return (key && FRAMING[key]) || DEFAULT_FRAMING;
}
