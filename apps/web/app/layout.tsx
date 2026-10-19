import type { Metadata, Viewport } from "next";
import { CartDrawer } from "@/components/CartDrawer";
import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { Hydrator } from "@/components/Hydrator";
import { RegisterDialog } from "@/components/RegisterDialog";
import { getCatalog } from "@/lib/data";
import "./globals.css";

export const metadata: Metadata = {
  title: "十二星球 · 星球寶寶",
  description: "做 8 題心理測驗找到你的星球，領養專屬的星球寶寶，帶著它來參加線下聚會。",
  metadataBase: process.env.NEXT_PUBLIC_SITE_URL ? new URL(process.env.NEXT_PUBLIC_SITE_URL) : undefined,
  openGraph: { title: "十二星球 · 星球寶寶", description: "每個人，都是從一顆小星球來的。", locale: "zh_TW", type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#10162e",
  colorScheme: "dark",
};

export const revalidate = 60;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { planets } = await getCatalog();
  return (
    <html lang="zh-Hant-TW">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=LXGW+WenKai+TC:wght@400;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <div className="sky">
          <Header />
          <main style={{ flex: 1 }}>{children}</main>
          <Footer />
          <CartDrawer />
          <RegisterDialog planets={planets.map((p) => ({ id: p.id, name: p.name }))} />
        </div>
        <Hydrator />
      </body>
    </html>
  );
}
