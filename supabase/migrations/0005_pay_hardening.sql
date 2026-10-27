-- 十二星球 · 0005_pay_hardening（審查修正）
-- 只動 planet schema 與 planet- 前綴的 pg_cron job；panpan / hank 的物件與 job 一律不碰。
--   H1/M5  定期對帳：pg_cron 每 10 分鐘以 pg_net 呼叫 /api/pay/reconcile-cron（secret 存 Vault：planet_cron_secret，不進 repo）
--   M5     報名逾時釋出前，所有 init 付款嘗試都必須在保留期滿後被回查過、且非處理中／已付／ATM 待繳
--   L11    同單號回查節流（claim_payment_check，條件式 update，無競態）
--   L13    payments FK 改 on delete restrict（刪測試資料要先刪 payments）

-- ---------- 回查紀錄 ----------
alter table planet.payments add column if not exists gateway_status text;   -- 最近一次回查的 status（W/P/S/F…）
alter table planet.payments add column if not exists checked_at timestamptz; -- 最近一次「成功」回查時間（釋出判斷用）
alter table planet.payments add column if not exists check_claimed_at timestamptz; -- 最近一次嘗試回查時間（節流用）

-- ---------- L13：FK 改 restrict ----------
alter table planet.payments drop constraint if exists payments_order_id_fkey;
alter table planet.payments add constraint payments_order_id_fkey
  foreign key (order_id) references planet.orders(id) on delete restrict;
alter table planet.payments drop constraint if exists payments_registration_id_fkey;
alter table planet.payments add constraint payments_registration_id_fkey
  foreign key (registration_id) references planet.registrations(id) on delete restrict;

-- ---------- L11：回查節流 ----------
-- 回 true = 取得回查權（並記下 check_claimed_at）；false = p_min_seconds 內已有人回查過
create or replace function planet.claim_payment_check(p_gateway_order_id text, p_min_seconds int)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_n int;
begin
  update planet.payments
     set check_claimed_at = now()
   where gateway_order_id = p_gateway_order_id
     and (check_claimed_at is null or check_claimed_at < now() - make_interval(secs => greatest(p_min_seconds, 0)));
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

-- ---------- M5：逾時判斷（保守：沒確認過閘道狀態就不釋出） ----------
create or replace function planet.registration_is_stale(p_reg_id uuid, p_created_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_created_at < now() - interval '2 hours'
     and exists (select 1 from planet.payments p where p.registration_id = p_reg_id)
     and not exists (
       select 1 from planet.payments p
        where p.registration_id = p_reg_id
          and (p.status = 'paid'
               or (p.status = 'init' and (
                     p.checked_at is null
                     or p.checked_at < p_created_at + interval '2 hours'      -- 保留期滿後還沒回查過
                     or p.gateway_status in ('P', 'S')                        -- 閘道處理中／已付（尚未入帳）
                     or (p.atm_virtual_account is not null
                         and coalesce(p.atm_expire_at, p.created_at + interval '3 days') > now()))))
     );
$$;

-- view 不能呼叫函式（view 內函式以 anon 權限執行），同一判斷內聯一份
create or replace view planet.event_seats with (security_invoker = false) as
  select e.id,
         greatest(e.capacity - count(r.id) filter (
           where r.status <> 'cancelled'
             and not (
               r.status = 'pending'
               and r.created_at < now() - interval '2 hours'
               and exists (select 1 from planet.payments p where p.registration_id = r.id)
               and not exists (
                 select 1 from planet.payments p
                  where p.registration_id = r.id
                    and (p.status = 'paid'
                         or (p.status = 'init' and (
                               p.checked_at is null
                               or p.checked_at < r.created_at + interval '2 hours'
                               or p.gateway_status in ('P', 'S')
                               or (p.atm_virtual_account is not null
                                   and coalesce(p.atm_expire_at, p.created_at + interval '3 days') > now()))))
               )
             )
         ), 0)::int as seats_left
  from planet.events e
  left join planet.registrations r on r.event_id = e.id
  where e.published
  group by e.id;
grant select on planet.event_seats to anon, authenticated;

-- ---------- 排程執行紀錄（僅 service role） ----------
create table if not exists planet.job_runs (
  name text primary key,
  last_run_at timestamptz not null default now(),
  last_result jsonb not null default '{}'::jsonb
);
alter table planet.job_runs enable row level security;
revoke all on planet.job_runs from anon, authenticated;
grant all on planet.job_runs to service_role;

-- ---------- H1：pg_cron + pg_net 定期對帳 ----------
create extension if not exists pg_net;

create or replace function planet.trigger_pay_reconcile()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'planet_cron_secret';
  if v_secret is null then
    raise warning 'planet_cron_secret 未設定，略過';
    return null;
  end if;
  return net.http_post(
    url := 'https://planet-pi-seven.vercel.app/api/pay/reconcile-cron',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
end;
$$;
revoke all on function planet.trigger_pay_reconcile() from public, anon, authenticated, service_role;

-- 成功回查後記錄閘道狀態（不論結果，只記時間與 status）
create or replace function planet.record_payment_check(p_gateway_order_id text, p_gateway_status text)
returns void
language sql
set search_path = ''
as $$
  update planet.payments
     set gateway_status = left(nullif(btrim(p_gateway_status), ''), 8), checked_at = now()
   where gateway_order_id = p_gateway_order_id;
$$;
revoke all on function planet.record_payment_check(text, text) from public, anon, authenticated;
grant execute on function planet.record_payment_check(text, text) to service_role;

revoke all on function planet.claim_payment_check(text, int) from public, anon, authenticated;
revoke all on function planet.registration_is_stale(uuid, timestamptz) from public, anon, authenticated;
grant execute on function planet.claim_payment_check(text, int) to service_role;
grant execute on function planet.registration_is_stale(uuid, timestamptz) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('planet-pay-reconcile', '*/10 * * * *', 'select planet.trigger_pay_reconcile()');
  end if;
end;
$$;
