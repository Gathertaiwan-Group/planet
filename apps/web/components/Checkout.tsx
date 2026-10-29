"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type FormEvent, type ReactNode } from "react";
import { GOLD_ORB, nt, orb, PAYMENT_OPTIONS, SHIPPING_OPTIONS } from "@planet/shared";
import { createOrder } from "@/app/actions";
import { toOrderItems, validateCheckout, validateCheckoutField, type CheckoutField, type CheckoutValues } from "@/lib/checkout";
import { cartCount, cartTotal, useStore, type CartItem } from "@/lib/store";
import { sx } from "@/lib/sx";
import { FramedImage } from "./ProductImage";

const FIELD_ORDER: CheckoutField[] = ["email", "phone", "name"];
const card = sx("background:#19213f;border:1px solid #2a3358;border-radius:24px;padding:clamp(18px,3vw,24px);display:flex;flex-direction:column;gap:16px;margin:0;min-width:0");
const label = sx("display:flex;flex-direction:column;gap:6px;font-size:14px;color:#cfcbe0");
const errText = sx("font-size:13px;color:#f2a99a;line-height:1.5");
const note = sx("font-size:13px;color:#8e90a8;line-height:1.6");
const primary = sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:16px 20px;font-size:17px;font-weight:600;cursor:pointer;min-height:52px;display:inline-flex;align-items:center;justify-content:center;gap:10px");

function Req() {
  return (
    <span aria-hidden="true" style={sx("color:#f2a99a;margin-left:2px")}>
      *
    </span>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <fieldset style={card}>
      <legend style={sx("float:left;width:100%;padding:0;display:flex;align-items:center;gap:10px;font-size:18px;font-weight:700;color:#f6f0e1")}>
        <span aria-hidden="true" style={sx("width:28px;height:28px;border-radius:50%;background:#222b4f;color:#f0c96e;font-size:14px;display:inline-flex;align-items:center;justify-content:center;flex:0 0 auto")}>{n}</span>
        {title}
      </legend>
      {children}
    </fieldset>
  );
}

function Spinner() {
  return <span aria-hidden="true" className="co-spin" style={sx("width:18px;height:18px;border-radius:50%;border:2.5px solid rgba(16,22,46,.25);border-top-color:#10162e;display:inline-block")} />;
}

function Thumb({ c }: { c: CartItem }) {
  return (
    <span aria-hidden="true" style={sx("position:relative;flex:0 0 56px;width:56px;height:56px")}>
      {c.image ? (
        <span style={sx("position:absolute;inset:0;border-radius:16px;overflow:hidden;background:#e9e9ee")}>
          <FramedImage src={c.image} alt="" sizes={(z) => `${Math.round(56 * z)}px`} variant="thumb" />
        </span>
      ) : (
        <span style={sx("position:absolute;inset:6px;border-radius:50%", { background: orb(c.hue) })} />
      )}
      {c.kind === "baby" && c.image && (
        <span style={sx("position:absolute;left:-4px;bottom:-4px;width:18px;height:18px;border-radius:50%;border:2px solid #19213f", { background: orb(c.hue) })} />
      )}
      <span style={sx("position:absolute;top:-7px;right:-7px;min-width:22px;height:22px;padding:0 6px;border-radius:999px;background:#aeb0c6;color:#10162e;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center")}>{c.qty}</span>
    </span>
  );
}

/** 結帳專屬頁：桌機左表單＋右 sticky 摘要；手機摘要收合在頂部、底部固定合計與主按鈕 */
export function Checkout() {
  const router = useRouter();
  const hydrated = useStore((s) => s.hydrated);
  const cart = useStore((s) => s.cart);
  const { openCart, clearCart, ensureAnonId } = useStore.getState();

  const [values, setValues] = useState<CheckoutValues>({ email: "", phone: "", name: "" });
  const [errors, setErrors] = useState<Partial<Record<CheckoutField, string>>>({});
  const [shipping, setShipping] = useState<string>(SHIPPING_OPTIONS[0]);
  const [payment, setPayment] = useState<string>(PAYMENT_OPTIONS[0]);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [done, setDone] = useState<{ manualPay: boolean } | null>(null);
  // 摘要：桌機預設展開、手機預設收合（Shopify 手法）
  const [summaryOpen, setSummaryOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSummaryOpen(window.matchMedia?.("(min-width: 861px)").matches ?? true);
  }, []);

  // 從付款頁按「上一頁」回來（bfcache 還原）時，解除導轉中的 loading
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        setBusy(false);
        setRedirecting(false);
      }
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const showForm = hydrated && !done && !redirecting && cart.length > 0;

  // 手機底部固定合計列：讓頁尾預留空間
  useEffect(() => {
    if (!showForm) return;
    document.documentElement.setAttribute("data-co-bar", "");
    return () => document.documentElement.removeAttribute("data-co-bar");
  }, [showForm]);

  const total = cartTotal(cart);
  const count = cartCount(cart);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.name as CheckoutField;
    const v = e.target.value;
    setValues((s) => ({ ...s, [f]: v }));
    // 已顯示錯誤的欄位：邊改邊重驗，修好就讓錯誤消失
    if (errors[f]) setErrors((s) => ({ ...s, [f]: validateCheckoutField(f, v) ?? undefined }));
  }

  function onBlur(e: FocusEvent<HTMLInputElement>) {
    const f = e.target.name as CheckoutField;
    if (!e.target.value.trim() && !errors[f]) return; // 還沒填就跳過的欄位，先不罵
    setErrors((s) => ({ ...s, [f]: validateCheckoutField(f, e.target.value) ?? undefined }));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const errs = validateCheckout(values);
    setErrors(errs);
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (first) {
      const el = formRef.current?.elements.namedItem(first) as HTMLInputElement | null;
      el?.focus({ preventScroll: true });
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setBusy(true);
    setServerError(null);
    let leaving = false;
    try {
      const r = await createOrder({
        recipient: values.name,
        phone: values.phone,
        email: values.email,
        shipping,
        payment,
        items: toOrderItems(cart),
        anonId: ensureAnonId(),
      });
      if (!r.ok) {
        setServerError(r.error);
        window.setTimeout(() => errRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 0);
        return;
      }
      // 訂單已成立（付款頁建好）才清空購物車；之後付款失敗可在付款結果頁重新付款，不需要購物車
      if (r.redirectUrl) {
        leaving = true; // 導轉期間維持 loading，防重複送出
        setRedirecting(true);
        clearCart();
        window.location.assign(r.redirectUrl);
        return;
      }
      clearCart();
      setDone({ manualPay: r.manualPay });
      window.scrollTo({ top: 0 });
    } catch {
      setServerError("網路好像不太穩，請再試一次。");
    } finally {
      if (!leaving) setBusy(false);
    }
  }

  const wrap = sx("max-width:1120px;margin:0 auto;padding:clamp(20px,4vw,40px) clamp(16px,4vw,40px) clamp(40px,6vw,72px);display:flex;flex-direction:column;gap:24px");

  // ---------- 狀態頁 ----------
  if (!hydrated) {
    return (
      <section className="gutter" style={wrap} aria-busy="true">
        <span style={sx("color:#aeb0c6;font-size:16px;padding:48px 0")}>正在載入購物車…</span>
      </section>
    );
  }

  if (redirecting) {
    return (
      <section className="gutter" style={wrap} aria-live="polite">
        <div style={sx("display:flex;flex-direction:column;align-items:center;gap:16px;padding:72px 0;text-align:center")}>
          <span aria-hidden="true" className="co-spin" style={sx("width:40px;height:40px;border-radius:50%;border:3px solid #2a3358;border-top-color:#f0c96e;display:block")} />
          <span style={sx("font-size:18px;font-weight:600")}>訂單已成立，正在前往信用卡安全付款頁…</span>
          <span style={note}>請勿關閉視窗或重新整理。</span>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section className="gutter" style={wrap}>
        <div style={sx("max-width:560px;display:flex;flex-direction:column;gap:16px;align-items:flex-start;padding:24px 0")}>
          <span aria-hidden="true" style={sx("width:72px;height:72px;border-radius:50%;box-shadow:0 0 40px rgba(240,201,110,.5)", { background: GOLD_ORB })} />
          <h1 className="wk" style={sx("font-size:30px;font-weight:700;margin:0")}>寶寶出發囉！</h1>
          <p style={sx("font-size:16px;line-height:1.7;color:#cfcbe0;margin:0")}>訂單已成立，出貨通知會傳到你的手機。現在去報名一場聚會，帶它出門見見朋友吧。</p>
          {done.manualPay && <p style={sx("font-size:13px;line-height:1.6;color:#8e90a8;margin:0")}>付款方式我們會盡快與你聯繫確認。</p>}
          <button type="button" onClick={() => router.push("/events")} className="h-bg-gold" style={sx("background:#f0c96e;color:#10162e;border:0;border-radius:999px;padding:14px 24px;font-size:16px;font-weight:600;cursor:pointer;min-height:48px")}>
            看近期聚會 →
          </button>
        </div>
      </section>
    );
  }

  if (cart.length === 0) {
    return (
      <section className="gutter" style={wrap}>
        <div style={sx("display:flex;flex-direction:column;align-items:center;gap:16px;padding:64px 0;text-align:center")}>
          <span aria-hidden="true" style={sx("width:64px;height:64px;border-radius:50%;opacity:.5", { background: GOLD_ORB })} />
          <h1 style={sx("font-size:24px;font-weight:700;margin:0")}>購物車是空的</h1>
          <p style={sx("font-size:16px;color:#aeb0c6;margin:0;line-height:1.6")}>還沒有要結帳的商品，先去領養一隻星球寶寶吧。</p>
          <Link href="/shop" className="h-bg-gold" style={sx("background:#f0c96e;color:#10162e;border-radius:999px;padding:14px 28px;font-size:16px;font-weight:600;text-decoration:none;min-height:48px;display:inline-flex;align-items:center")}>
            去逛星球寶寶 →
          </Link>
        </div>
      </section>
    );
  }

  // ---------- 結帳表單 ----------
  const fieldProps = (f: CheckoutField) => ({
    name: f,
    value: values[f],
    onChange,
    onBlur,
    className: "field",
    "aria-invalid": errors[f] ? true : undefined,
    "aria-describedby": [errors[f] ? `${f}-err` : null, f === "email" ? "email-note" : null].filter(Boolean).join(" ") || undefined,
    "aria-required": true,
    style: errors[f] ? { borderColor: "#f2a99a" } : undefined,
  });
  const fieldErr = (f: CheckoutField) =>
    errors[f] ? (
      <span id={`${f}-err`} style={errText}>
        {errors[f]}
      </span>
    ) : null;

  const steps: { label: string; state: "done" | "current" | "todo" }[] = [
    { label: "購物車", state: "done" },
    { label: "填寫資料", state: "current" },
    { label: "付款", state: "todo" },
  ];

  return (
    <section className="gutter" style={wrap}>
      <nav aria-label="結帳步驟">
        <ol style={sx("list-style:none;margin:0;padding:0;display:flex;align-items:center;flex-wrap:wrap;gap:6px;font-size:14px")}>
          {steps.map((s, i) => (
            <li key={s.label} style={sx("display:flex;align-items:center;gap:6px")}>
              {i > 0 && (
                <span aria-hidden="true" style={sx("color:#4c5684")}>
                  ›
                </span>
              )}
              {s.state === "done" ? (
                <button type="button" onClick={openCart} className="h-text-gold tap" style={sx("background:none;border:0;padding:4px 2px;color:#aeb0c6;font-size:14px;cursor:pointer;text-decoration:underline;text-underline-offset:3px")}>
                  {s.label}
                </button>
              ) : (
                <span aria-current={s.state === "current" ? "step" : undefined} style={sx("padding:4px 2px", { color: s.state === "current" ? "#f0c96e" : "#8e90a8", fontWeight: s.state === "current" ? 600 : 400 })}>
                  {s.label}
                </span>
              )}
            </li>
          ))}
        </ol>
      </nav>
      <h1 className="wk" style={sx("font-size:clamp(26px,4vw,34px);font-weight:700;margin:0")}>結帳</h1>

      <div className="co-grid">
        {/* ---------- 訂單摘要 ---------- */}
        <aside className="co-summary" aria-label="訂單摘要" style={sx("background:#151c38;border:1px solid #2a3358;border-radius:24px;overflow:hidden")}>
          <button
            type="button"
            onClick={() => setSummaryOpen((o) => !o)}
            aria-expanded={summaryOpen}
            aria-controls="co-summary-body"
            className="h-text-gold"
            style={sx("width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;background:none;border:0;padding:16px 20px;min-height:56px;color:#f0c96e;font-size:15px;font-weight:500;cursor:pointer;text-align:left")}
          >
            <span style={sx("display:inline-flex;align-items:center;gap:8px")}>
              {summaryOpen ? "隱藏訂單摘要" : "顯示訂單摘要"}
              <span style={sx("color:#aeb0c6;font-size:13px")}>（{count} 件）</span>
              <svg aria-hidden="true" width="12" height="8" viewBox="0 0 12 8" style={{ transform: summaryOpen ? "rotate(180deg)" : undefined, transition: "transform .2s" }}>
                <path d="M1 1.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span style={sx("font-size:18px;font-weight:700;color:#f6f0e1")}>{nt(total)}</span>
          </button>
          <div id="co-summary-body" hidden={!summaryOpen} style={sx("border-top:1px solid #2a3358;padding:18px 20px 20px;flex-direction:column;gap:16px", { display: summaryOpen ? "flex" : "none" })}>
            <ul style={sx("list-style:none;margin:0;padding:6px 0 0;display:flex;flex-direction:column;gap:16px")}>
              {cart.map((c) => (
                <li key={c.id} style={sx("display:flex;gap:14px;align-items:center")}>
                  <Thumb c={c} />
                  <div style={sx("flex:1;min-width:0;display:flex;flex-direction:column;gap:2px")}>
                    <span style={sx("font-size:15px;font-weight:600")}>{c.name}</span>
                    <span style={sx("font-size:13px;color:#aeb0c6")}>{c.sub}</span>
                    <span style={sx("font-size:13px;color:#8e90a8")}>
                      {nt(c.price)} × {c.qty}
                    </span>
                  </div>
                  <span style={sx("font-size:15px;font-weight:600;white-space:nowrap")}>{nt(c.price * c.qty)}</span>
                </li>
              ))}
            </ul>
            <button type="button" onClick={openCart} className="h-text-gold tap" style={sx("align-self:flex-start;background:none;border:0;padding:4px 0;color:#aeb0c6;font-size:14px;cursor:pointer;text-decoration:underline;text-underline-offset:3px")}>
              修改購物車
            </button>
            <dl style={sx("margin:0;border-top:1px solid #2a3358;padding-top:14px;display:flex;flex-direction:column;gap:10px")}>
              <div style={sx("display:flex;justify-content:space-between;font-size:15px;color:#cfcbe0")}>
                <dt>小計（{count} 件）</dt>
                <dd style={{ margin: 0 }}>{nt(total)}</dd>
              </div>
              <div style={sx("display:flex;justify-content:space-between;align-items:baseline;font-size:20px;font-weight:700;border-top:1px solid #2a3358;padding-top:12px")}>
                <dt>合計</dt>
                <dd style={{ margin: 0 }}>
                  <span style={sx("font-size:12px;font-weight:500;color:#8e90a8;margin-right:6px")}>TWD</span>
                  {nt(total)}
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        {/* ---------- 表單 ---------- */}
        <form id="checkout-form" ref={formRef} onSubmit={submit} noValidate className="co-form" style={sx("display:flex;flex-direction:column;gap:20px;min-width:0")}>
          <Section n={1} title="聯絡資訊">
            <label style={label}>
              <span>
                Email
                <Req />
              </span>
              <input {...fieldProps("email")} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={100} placeholder="name@example.com" />
              {fieldErr("email")}
              <span id="email-note" style={note}>
                付款完成後，電子發票會寄到這個信箱
              </span>
            </label>
            <label style={label}>
              <span>
                手機
                <Req />
              </span>
              <input {...fieldProps("phone")} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} placeholder="0912345678" />
              {fieldErr("phone")}
            </label>
          </Section>

          <Section n={2} title="收件與取貨">
            <label style={label}>
              <span>
                收件人
                <Req />
              </span>
              <input {...fieldProps("name")} type="text" autoComplete="name" maxLength={40} placeholder="真實姓名（取貨時核對）" />
              {fieldErr("name")}
            </label>
            <div role="radiogroup" aria-label="取貨方式" style={sx("display:flex;flex-direction:column;gap:8px")}>
              <span style={sx("font-size:14px;color:#cfcbe0")}>取貨方式</span>
              {SHIPPING_OPTIONS.map((o) => (
                <label key={o} className="co-opt" data-on={shipping === o ? "1" : undefined}>
                  <input type="radio" name="ship" value={o} checked={shipping === o} onChange={() => setShipping(o)} />
                  <span style={sx("font-size:16px")}>{o}</span>
                </label>
              ))}
            </div>
          </Section>

          <Section n={3} title="付款方式">
            <div role="radiogroup" aria-label="付款方式" style={sx("display:flex;flex-direction:column;gap:8px")}>
              {PAYMENT_OPTIONS.map((o) => (
                <label key={o} className="co-opt" data-on={payment === o ? "1" : undefined}>
                  <input type="radio" name="pay" value={o} checked={payment === o} onChange={() => setPayment(o)} />
                  <span style={sx("display:flex;flex-direction:column;gap:2px")}>
                    <span style={sx("font-size:16px")}>{o}</span>
                    <span style={sx("font-size:13px;color:#aeb0c6")}>黑貓PAY（統一金流）</span>
                  </span>
                </label>
              ))}
            </div>
            <p style={{ ...note, margin: 0 }}>按下「確認下單並付款」後，會前往黑貓PAY 的信用卡安全付款頁輸入卡號，本站不會經手你的卡片資料。</p>
          </Section>

          <Section n={4} title="發票">
            <p style={sx("margin:0;font-size:15px;color:#cfcbe0;line-height:1.7")}>
              付款完成後，電子發票會寄到
              {values.email.trim() ? <strong style={sx("color:#f6f0e1;word-break:break-all")}> {values.email.trim()}</strong> : " 你在上方填寫的 Email"}。
            </p>
          </Section>

          <div ref={errRef}>
            {serverError && (
              <div role="alert" style={sx("background:rgba(242,169,154,.1);border:1px solid rgba(242,169,154,.4);border-radius:16px;padding:14px 16px;font-size:15px;color:#f2a99a;line-height:1.6")}>
                {serverError}
              </div>
            )}
          </div>

          <div className="co-submit-inline" style={sx("display:flex;flex-direction:column;gap:10px")}>
            <button type="submit" disabled={busy} aria-busy={busy} className="h-bg-gold" style={{ ...primary, opacity: busy ? 0.75 : 1 }}>
              {busy && <Spinner />}
              {busy ? "建立訂單中…" : "確認下單並付款"}
            </button>
            <span style={{ ...note, textAlign: "center" }}>付款在黑貓PAY 安全頁面完成，本站不儲存卡號。</span>
          </div>
        </form>
      </div>

      {/* 手機底部固定：合計＋主按鈕 */}
      <div className="co-bar" style={sx("position:fixed;left:0;right:0;bottom:0;z-index:30;background:rgba(21,28,56,.96);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border-top:1px solid #2a3358;padding:12px max(16px,var(--safe-r)) calc(12px + var(--safe-b)) max(16px,var(--safe-l));align-items:center;gap:14px")}>
        <div style={sx("display:flex;flex-direction:column;flex:0 0 auto")}>
          <span style={sx("font-size:12px;color:#aeb0c6")}>合計</span>
          <span style={sx("font-size:20px;font-weight:700")}>{nt(total)}</span>
        </div>
        <button type="submit" form="checkout-form" disabled={busy} aria-busy={busy} className="h-bg-gold" style={{ ...primary, flex: 1, padding: "14px 16px", fontSize: 16, opacity: busy ? 0.75 : 1 }}>
          {busy && <Spinner />}
          {busy ? "建立訂單中…" : "確認下單並付款"}
        </button>
      </div>
    </section>
  );
}
