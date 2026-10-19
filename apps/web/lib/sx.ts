import type { CSSProperties } from "react";

const cache = new Map<string, CSSProperties>();

/**
 * 把原型的 inline CSS 字串（例如 "display:flex;gap:12px"）轉成 React style 物件，
 * 讓數值能從 design/Twelve Planets.dc.html 原封不動照抄。
 */
export function sx(css: string, extra?: CSSProperties): CSSProperties {
  let base = cache.get(css);
  if (!base) {
    base = {};
    for (const decl of css.split(";")) {
      const i = decl.indexOf(":");
      if (i < 0) continue;
      const prop = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      if (!prop || !value) continue;
      const key = prop.startsWith("--")
        ? prop
        : prop.replace(/^-(webkit|moz|ms)-/, (_, v: string) => v[0].toUpperCase() + v.slice(1) + "-").replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
      (base as Record<string, string>)[key] = value;
    }
    cache.set(css, base);
  }
  return extra ? { ...base, ...extra } : base;
}
