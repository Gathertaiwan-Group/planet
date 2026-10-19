import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient<any, "planet", "planet"> | null = null;

export function db() {
  if (!env.supabaseUrl || !env.serviceRoleKey) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 未設定");
  if (!client) {
    client = createClient<any, "planet", "planet">(env.supabaseUrl, env.serviceRoleKey, {
      db: { schema: "planet" },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export type PayKind = "order" | "reg";

export interface Payable {
  kind: PayKind;
  id: string;
  amount: number;
  status: string;
  title: string;
  method: string | null; // 訂單的付款方式；報名為 null
  contact: string | null;
}

export async function loadPayable(kind: PayKind, id: string): Promise<Payable | null> {
  if (kind === "order") {
    const { data, error } = await db().from("orders").select("id,total_twd,status,payment").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return { kind, id: data.id, amount: data.total_twd, status: data.status, title: "十二星球 星球寶寶訂單", method: data.payment, contact: null };
  }
  const { data, error } = await db()
    .from("registrations")
    .select("id,amount_twd,status,contact,events(title)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const ev = data.events as unknown as { title: string } | null;
  return { kind, id: data.id, amount: data.amount_twd, status: data.status, title: `聚會報名：${ev?.title ?? ""}`, method: null, contact: data.contact };
}

const table = (kind: PayKind) => (kind === "order" ? "orders" : "registrations");

export async function setPaymentRef(kind: PayKind, id: string, ref: string) {
  const { error } = await db().from(table(kind)).update({ payment_ref: ref }).eq("id", id).eq("status", "pending");
  if (error) throw error;
}

/** 依 payment_ref 找訂單或報名 */
export async function findByRef(ref: string): Promise<{ kind: PayKind; id: string; amount: number; status: string; contact: string | null } | null> {
  const o = await db().from("orders").select("id,total_twd,status").eq("payment_ref", ref).maybeSingle();
  if (o.error) throw o.error;
  if (o.data) return { kind: "order", id: o.data.id, amount: o.data.total_twd, status: o.data.status, contact: null };
  const r = await db().from("registrations").select("id,amount_twd,status,contact").eq("payment_ref", ref).maybeSingle();
  if (r.error) throw r.error;
  if (r.data) return { kind: "reg", id: r.data.id, amount: r.data.amount_twd, status: r.data.status, contact: r.data.contact };
  return null;
}

/** pending → paid（只更新仍為 pending 的列，避免遲到 callback 覆蓋） */
export async function markPaid(kind: PayKind, id: string): Promise<boolean> {
  const { data, error } = await db().from(table(kind)).update({ status: "paid" }).eq("id", id).eq("status", "pending").select("id");
  if (error) throw error;
  return (data?.length ?? 0) > 0;
}
