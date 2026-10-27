"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { sx } from "@/lib/sx";

/** 付款確認中：每 4 秒重新整理一次（最多 8 次），等 notify／回查把狀態更新 */
export function AutoRefresh({ tries = 8 }: { tries?: number }) {
  const router = useRouter();
  useEffect(() => {
    let n = 0;
    const t = setInterval(() => {
      n += 1;
      if (n > tries) return clearInterval(t);
      router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [router, tries]);
  return null;
}

const btn = sx("border:0;border-radius:999px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;min-height:48px");

/** 重新付款表單：送出後按鈕 loading，防重複送出 */
export function RetryForm({ orderNo }: { orderNo: string }) {
  const [busy, setBusy] = useState(false);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (busy) {
      e.preventDefault();
      return;
    }
    setBusy(true);
  }
  return (
    <form method="post" action="/api/pay/retry" onSubmit={onSubmit} style={sx("display:flex;flex-wrap:wrap;gap:10px")}>
      <input type="hidden" name="o" value={orderNo} />
      <button
        type="submit"
        disabled={busy}
        aria-busy={busy}
        className="h-bg-gold"
        style={{ ...btn, background: "#f0c96e", color: "#10162e", opacity: busy ? 0.7 : 1 }}
      >
        {busy ? "前往付款頁…" : "重新付款（信用卡）"}
      </button>
    </form>
  );
}

export function GoPayLink({ orderNo }: { orderNo: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <a
      href={`/api/pay/go/${orderNo}`}
      onClick={(e) => {
        if (busy) e.preventDefault();
        setBusy(true);
      }}
      className="h-bg-gold"
      style={{ ...btn, display: "inline-flex", alignItems: "center", textDecoration: "none", background: "#f0c96e", color: "#10162e", opacity: busy ? 0.7 : 1 }}
    >
      {busy ? "前往付款頁…" : "繼續付款 →"}
    </a>
  );
}
