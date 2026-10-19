import Link from "next/link";
import { sx } from "@/lib/sx";

export default function NotFound() {
  return (
    <section className="gutter" style={sx("max-width:640px;margin:0 auto;padding:96px clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:20px;align-items:flex-start")}>
      <h1 className="wk" style={sx("margin:0;font-size:40px")}>這顆星球還沒被發現</h1>
      <p style={sx("margin:0;font-size:18px;color:#cfcbe0")}>你要找的頁面不存在，回首頁看看吧。</p>
      <Link href="/" className="h-bg-gold" style={sx("background:#f0c96e;color:#10162e;border-radius:999px;padding:16px 28px;font-size:18px;font-weight:600;text-decoration:none")}>
        回首頁 →
      </Link>
    </section>
  );
}
