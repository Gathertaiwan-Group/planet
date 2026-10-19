import { createHash } from "node:crypto";

/** 綠界 .NET 風格 URL encode（小寫） */
export function ecpayUrlEncode(s: string): string {
  return encodeURIComponent(s)
    .replace(/%20/g, "+")
    .replace(/~/g, "%7e")
    .replace(/'/g, "%27")
    .toLowerCase();
}

/** 綠界 CheckMacValue（SHA256, EncryptType=1） */
export function ecpayCheckMacValue(params: Record<string, string | number>, hashKey: string, hashIV: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "CheckMacValue")
    .sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));
  const raw = `HashKey=${hashKey}&${keys.map((k) => `${k}=${params[k]}`).join("&")}&HashIV=${hashIV}`;
  return createHash("sha256").update(ecpayUrlEncode(raw)).digest("hex").toUpperCase();
}
