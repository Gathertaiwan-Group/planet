"use client";

import Image from "next/image";
import { useEffect, useState, type CSSProperties } from "react";
import { framingFor } from "@planet/shared";
import { sx } from "@/lib/sx";

export const STRIPES = "repeating-linear-gradient(135deg,#1d2649 0 12px,#222b4f 12px 24px)";

interface Props {
  src: string | null | undefined;
  alt: string;
  /** next/image sizes；傳函式時會帶入該圖的放大倍率，讓下載解析度跟著放大 */
  sizes: string | ((zoom: number) => string);
  variant?: "card" | "thumb";
  eager?: boolean;
  style?: CSSProperties;
  onLoad?: () => void;
}

/** 產品照：依 framing 放大燈泡主體；沒圖時 fallback 回斜紋佔位 */
export function FramedImage({ src, alt, sizes, variant = "card", eager, style, onLoad }: Props) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <span aria-hidden="true" style={{ position: "absolute", inset: 0, background: STRIPES, ...style }} />;
  const f = framingFor(src);
  const zoom = variant === "thumb" ? f.thumbZoom : f.zoom;
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={typeof sizes === "function" ? sizes(zoom) : sizes}
      loading={eager ? "eager" : "lazy"}
      onLoad={onLoad}
      onError={() => setFailed(true)}
      style={{
        objectFit: "cover",
        objectPosition: `${f.x}% ${f.y}%`,
        transform: zoom !== 1 ? `scale(${zoom})` : undefined,
        transformOrigin: `${f.x}% ${f.y}%`,
        ...style,
      }}
    />
  );
}

/**
 * 切換植栽時淡入淡出：看過的圖保留在疊層中（最多就是植栽數量），
 * 目前選中的那層 opacity 1，其餘 0，用 transition 交叉淡化；沒看過的圖不會下載。
 */
export function CrossfadeImage({ src, alt, sizes }: { src: string | null | undefined; alt: string; sizes: string | ((zoom: number) => string) }) {
  const key = src ?? "";
  const [visited, setVisited] = useState<string[]>([key]);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  // 目前顯示的層：新圖載入完成才切過去，舊圖在下面撐著，不會閃空白
  const [display, setDisplay] = useState(key);
  useEffect(() => {
    setVisited((v) => (v.includes(key) ? v : [...v, key]));
    if (!key || loaded[key]) setDisplay(key);
  }, [key, loaded]);
  return (
    <>
      {visited.map((v) => {
        const on = v === display;
        return (
          <span key={v} aria-hidden={!on} style={sx("position:absolute;inset:0;transition:opacity .4s ease", { opacity: on ? 1 : 0, zIndex: on ? 1 : 0 })}>
            <FramedImage
              src={v || null}
              alt={on ? alt : ""}
              sizes={sizes}
              eager={v === key || on}
              onLoad={() => setLoaded((l) => (l[v] ? l : { ...l, [v]: true }))}
            />
          </span>
        );
      })}
    </>
  );
}
