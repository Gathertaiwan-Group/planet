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
export function RetryForm({ orderNo, payTypes }: { orderNo: string; payTypes: ("CARD" | "ATM")[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    if (busy) {
      e.preventDefault();
      return;
    }
    const sub = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    setBusy(sub?.value ?? "CARD");
  }
  return (
    <form method="post" action="/api/pay/retry" onSubmit={onSubmit} style={sx("display:flex;flex-wrap:wrap;gap:10px")}>
      <input type="hidden" name="o" value={orderNo} />
      {payTypes.map((t, i) => (
        <button
          key={t}
          type="submit"
          name="pay_type"
          value={t}
          disabled={!!busy}
          aria-busy={busy === t}
          className={i === 0 ? "h-bg-gold" : undefined}
          style={{ ...btn, background: i === 0 ? "#f0c96e" : "#2a3358", color: i === 0 ? "#10162e" : "#f6f0e1", opacity: busy && busy !== t ? 0.5 : 1 }}
        >
          {busy === t ? "前往付款頁…" : t === "CARD" ? "用信用卡重新付款" : "改用 ATM 轉帳"}
        </button>
      ))}
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
