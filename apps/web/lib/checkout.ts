import type { OrderItemInput } from "@planet/shared";
import type { CartItem } from "./store";

export type CheckoutField = "email" | "phone" | "name";
export type CheckoutValues = Record<CheckoutField, string>;

/**
 * 結帳頁就地驗證：規則與 app/actions.ts createOrder 的伺服器端檢查一致
 * （伺服器仍會再驗一次，這裡只是讓錯誤早點、就地顯示）。
 */
export function validateCheckoutField(field: CheckoutField, raw: string): string | null {
  const v = raw.trim();
  if (field === "name") return v ? null : "請填寫收件人姓名";
  if (field === "phone") {
    if (!v) return "請填寫手機號碼";
    return /^\+?\d{8,15}$/.test(v.replace(/[\s-]/g, "")) ? null : "手機號碼格式不正確，例如 0912345678";
  }
  if (!v) return "請填寫 Email（電子發票會寄到這裡）";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : "Email 格式不正確，例如 name@example.com";
}

export function validateCheckout(values: CheckoutValues): Partial<Record<CheckoutField, string>> {
  const out: Partial<Record<CheckoutField, string>> = {};
  for (const f of ["email", "phone", "name"] as const) {
    const err = validateCheckoutField(f, values[f]);
    if (err) out[f] = err;
  }
  return out;
}

export function toOrderItems(cart: CartItem[]): OrderItemInput[] {
  return cart.map((c) =>
    c.kind === "baby" ? { kind: "baby", planet_id: c.planetId!, plant_id: c.plantId!, qty: c.qty } : { kind: "extra", sku: c.sku!, qty: c.qty },
  );
}
