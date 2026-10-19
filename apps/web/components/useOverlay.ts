"use client";

import { useEffect, type RefObject } from "react";

/** 開啟抽屜／對話框時：鎖背景捲動、Esc 關閉、焦點移入並在關閉後還原 */
export function useOverlay(open: boolean, onClose: () => void, ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = "hidden";
    const t = window.setTimeout(() => {
      // 觸控裝置不要自動聚焦輸入框（避免一打開就彈出鍵盤擋住底部彈窗）
      const coarse = window.matchMedia?.("(pointer: coarse)").matches;
      let el = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? null;
      if (coarse && el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) el = null;
      el ??= ref.current;
      el?.focus({ preventScroll: true });
    }, 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && ref.current) {
        const f = ref.current.querySelectorAll<HTMLElement>('button:not([disabled]),input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          last.focus();
          e.preventDefault();
        } else if (!e.shiftKey && document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      html.style.overflow = prevOverflow;
      prevFocus?.focus?.({ preventScroll: true });
    };
  }, [open, onClose, ref]);
}
