const v = (k: string) => {
  const x = process.env[k];
  return x && x.trim() !== "" ? x.trim() : undefined;
};

export const env = {
  port: Number(v("PORT") ?? 8787),
  supabaseUrl: v("SUPABASE_URL") ?? v("NEXT_PUBLIC_SUPABASE_URL"),
  serviceRoleKey: v("SUPABASE_SERVICE_ROLE_KEY"),
  webUrl: (v("WEB_URL") ?? "http://localhost:3000").replace(/\/$/, ""),
  publicUrl: (v("PUBLIC_URL") ?? `http://localhost:${v("PORT") ?? 8787}`).replace(/\/$/, ""),
  ecpay: {
    merchantId: v("ECPAY_MERCHANT_ID"),
    hashKey: v("ECPAY_HASH_KEY"),
    hashIV: v("ECPAY_HASH_IV"),
    production: v("ECPAY_ENV") === "production",
  },
  linepay: {
    channelId: v("LINEPAY_CHANNEL_ID"),
    channelSecret: v("LINEPAY_CHANNEL_SECRET"),
    production: v("LINEPAY_ENV") === "production",
  },
  resendKey: v("RESEND_API_KEY"),
  mailFrom: v("MAIL_FROM") ?? "十二星球 <noreply@example.com>",
};

export const ecpayReady = () => Boolean(env.ecpay.merchantId && env.ecpay.hashKey && env.ecpay.hashIV);
export const linepayReady = () => Boolean(env.linepay.channelId && env.linepay.channelSecret);
export const dbReady = () => Boolean(env.supabaseUrl && env.serviceRoleKey);
