"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { LOGO_ORB } from "@planet/shared";
import { cartCount, useStore } from "@/lib/store";
import { sx } from "@/lib/sx";

const isActive = (path: string, href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));

export function Header() {
  const path = usePathname() || "/";
  const result = useStore((s) => s.result);
  const count = useStore((s) => (s.hydrated ? cartCount(s.cart) : 0));
  const openCart = useStore((s) => s.openCart);
  const navRef = useRef<HTMLElement>(null);

  const nav: [string, string][] = [
    ["/", "首頁"],
    ["/quiz", "心理測驗"],
    ...(result !== null ? ([["/me", "我的星球"]] as [string, string][]) : []),
    ["/planets", "12 星球"],
    ["/events", "聚會"],
    ["/shop", "星球寶寶"],
  ];

  // 手機上導覽可水平捲動：把目前頁籤捲進可視範圍
  useEffect(() => {
    const el = navRef.current;
    const active = el?.querySelector<HTMLElement>("[aria-current='page']");
    if (!el || !active || el.scrollWidth <= el.clientWidth) return;
    const left = active.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + active.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollTo({ left: Math.max(0, left - 16), behavior: "smooth" });
    }
  }, [path, result]);

  return (
    <header className="hdr" style={sx("position:sticky;top:0;z-index:20;background:rgba(16,22,46,.86);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-bottom:1px solid #2a3358")}>
      <div className="hdr-in gutter" style={sx("max-width:1240px;margin:0 auto;padding:12px clamp(16px,4vw,40px);display:flex;align-items:center;gap:16px;flex-wrap:wrap")}>
        <Link href="/" aria-label="十二星球 首頁" className="tap" style={sx("display:flex;align-items:center;gap:10px;background:none;border:0;padding:4px 0;cursor:pointer;color:#f6f0e1;text-decoration:none")}>
          <span style={sx("width:26px;height:26px;border-radius:50%;box-shadow:0 0 18px rgba(240,201,110,.5);display:block", { background: LOGO_ORB })} />
          <span className="wk" style={sx("font-weight:700;font-size:21px")}>十二星球</span>
        </Link>
        <nav
          ref={navRef}
          data-nav="1"
          aria-label="主要導覽"
          className="nav no-scrollbar"
          style={sx("order:1;flex:1 1 0;min-width:0;justify-content:flex-start;display:flex;gap:2px;overflow-x:auto;align-items:center;max-width:100%;white-space:nowrap;scrollbar-width:none")}
        >
          {nav.map(([href, label], i) => {
            const on = isActive(path, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={on ? "page" : undefined}
                className="h-text-gold tap"
                style={sx("border:0;border-radius:999px;padding:8px 14px;font-size:15px;font-weight:500;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;flex:0 0 auto", {
                  background: on ? "#222b4f" : "transparent",
                  color: on ? "#f0c96e" : "#f6f0e1",
                  // 有空間時整組靠右（取代 justify-content:flex-end，溢出時仍可從頭捲動）
                  marginLeft: i === 0 ? "auto" : undefined,
                })}
              >
                {label}
              </Link>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={openCart}
          data-cart="1"
          aria-label={`購物車，${count} 件商品`}
          className="h-bg-gold tap"
          style={sx("order:2;margin-left:12px;flex:0 0 auto;display:flex;align-items:center;gap:8px;background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:9px 16px;font-size:15px;font-weight:600;cursor:pointer")}
        >
          購物車
          <span style={sx("min-width:22px;height:22px;border-radius:999px;background:#10162e;color:#f0c96e;font-size:13px;display:flex;align-items:center;justify-content:center;padding:0 6px")}>{count}</span>
        </button>
      </div>
    </header>
  );
}
