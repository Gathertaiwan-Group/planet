import { describe, expect, it } from "vitest";
import { toOrderItems, validateCheckout, validateCheckoutField } from "../lib/checkout";
import type { CartItem } from "../lib/store";

describe("結帳頁就地驗證（與 createOrder 伺服器規則一致）", () => {
  it("必填三欄空白時全部擋下", () => {
    expect(Object.keys(validateCheckout({ email: "", phone: "", name: "  " })).sort()).toEqual(["email", "name", "phone"]);
  });
  it("手機允許空白與連字號、可帶 +", () => {
    expect(validateCheckoutField("phone", "0912-345 678")).toBeNull();
    expect(validateCheckoutField("phone", "+886912345678")).toBeNull();
    expect(validateCheckoutField("phone", "12345")).not.toBeNull();
    expect(validateCheckoutField("phone", "09123abc78")).not.toBeNull();
  });
  it("Email 格式", () => {
    expect(validateCheckoutField("email", "a@b.co")).toBeNull();
    expect(validateCheckoutField("email", "a@b")).not.toBeNull();
    expect(validateCheckoutField("email", "a b@c.d")).not.toBeNull();
  });
  it("全部正確時沒有錯誤", () => {
    expect(validateCheckout({ email: "test@example.com", phone: "0912345678", name: "王小明" })).toEqual({});
  });
});

describe("購物車 → 下單品項", () => {
  it("寶寶與周邊轉成 OrderItemInput", () => {
    const cart: CartItem[] = [
      { id: "b-1-3", kind: "baby", planetId: 1, plantId: 3, name: "x", sub: "", price: 680, hue: 0, qty: 2 },
      { id: "s", kind: "extra", sku: "sticker-x3", name: "y", sub: "", price: 120, hue: 0, qty: 1 },
    ];
    expect(toOrderItems(cart)).toEqual([
      { kind: "baby", planet_id: 1, plant_id: 3, qty: 2 },
      { kind: "extra", sku: "sticker-x3", qty: 1 },
    ]);
  });
});
