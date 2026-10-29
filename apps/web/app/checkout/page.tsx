import type { Metadata } from "next";
import { Checkout } from "@/components/Checkout";

export const metadata: Metadata = { title: "結帳 · 十二星球", robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return <Checkout />;
}
