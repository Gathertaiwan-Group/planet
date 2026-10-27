-- 十二星球 · 0003_pchomepay
-- PChomePay（支付連）金流：付款紀錄表 planet.payments ＋ 對帳函式。全部在 apps/web（Vercel）執行，不依賴 worker。
-- 只動 planet schema（同庫還有 panpan / hank，禁止碰）。由 scripts/apply-migrations.mjs 套用，絕不 supabase db push。
--
-- 設計：
--   - 一筆訂單／報名可有多筆付款嘗試（失敗後重新付款會開新的 gateway_order_id，PChomePay 的 order_id 不能重用）
--   - gateway_order_id：TP + 台北 yyMMdd + 8 碼英數（16 字元），本站專用前綴，避免與同商店其他站（DD/GT…）撞號
--   - 狀態只由伺服器回查 PChomePay（GET /v1/payment/{order_id}）決定；notify 無簽章，payload 不可信
--   - 付款成功的轉換一律條件式（where status = 'pending'），遲到／重複 callback 不會覆蓋 paid / cancelled

-- ---------- 付款紀錄 ----------
create table if not exists planet.payments (
  id uuid primary key default gen_random_uuid(),
  gateway text not null default 'pchomepay',
  gateway_order_id text not null unique check (gateway_order_id ~ '^TP[0-9]{6}[0-9A-Z]{8}$'),
  order_id uuid references planet.orders(id) on delete cascade,
  registration_id uuid references planet.registrations(id) on delete cascade,
  status text not null default 'init' check (status in ('init', 'paid', 'failed')),
  amount int not null check (amount >= 30),           -- PChomePay 最低 NT$30
  pay_type text,                                       -- 建單時要求的方式（CARD / ATM / CARD,ATM）；付款後改存閘道回報值
  payment_url text,
  atm_bank_code text,
  atm_virtual_account text,
  atm_expire_at timestamptz,
  needs_attention text,                                -- amount_mismatch / paid_after_cancel / duplicate_payment …（需人工處理）
  raw jsonb not null default '{}'::jsonb,              -- 回查結果歷史（不含個資）
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_one_target check ((order_id is null) <> (registration_id is null))
);
create index if not exists payments_order_idx on planet.payments (order_id);
create index if not exists payments_registration_idx on planet.payments (registration_id);

alter table planet.orders add column if not exists paid_at timestamptz;
alter table planet.registrations add column if not exists paid_at timestamptz;

create or replace function planet.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists payments_touch on planet.payments;
create trigger payments_touch before update on planet.payments
  for each row execute function planet.touch_updated_at();

alter table planet.payments enable row level security;
-- 無 policy、無 anon/authenticated grant → 只有 service role 能讀寫
revoke all on planet.payments from anon, authenticated;
grant all on planet.payments to service_role;

-- ---------- 逾時未付的報名：釋出座位 ----------
-- 只處理「走過線上付款」的報名（有 payments 紀錄）；舊資料、0 元、1–29 元（人工收費）不受影響。
-- 逾時條件：建立超過 2 小時、沒有任何已付款紀錄、且沒有仍在繳費期限內的 ATM 虛擬帳號。
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
               or (p.status = 'init' and p.atm_virtual_account is not null
                   and coalesce(p.atm_expire_at, p.created_at + interval '3 days') > now()))
     );
$$;

create or replace function planet.expire_unpaid_registrations(p_event_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_n int;
begin
  update planet.registrations r
     set status = 'cancelled'
   where r.event_id = p_event_id
     and r.status = 'pending'
     and planet.registration_is_stale(r.id, r.created_at);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- 座位 view：逾時未付的 pending 不佔位（即使還沒被 expire_unpaid_registrations 實際取消）
create or replace view planet.event_seats with (security_invoker = false) as
  select e.id,
         greatest(e.capacity - count(r.id) filter (
           where r.status <> 'cancelled'
             and not (r.status = 'pending' and planet.registration_is_stale(r.id, r.created_at))
         ), 0)::int as seats_left
  from planet.events e
  left join planet.registrations r on r.event_id = e.id
  where e.published
  group by e.id;
grant select on planet.event_seats to anon, authenticated;

-- ---------- 報名：先釋出逾時座位；0 元直接成立（paid） ----------
create or replace function planet.register_for_event(
  p_event_id uuid,
  p_nickname text,
  p_contact text,
  p_planet_id int,
  p_issue text,
  p_anon_id text
) returns table (registration_id uuid, amount_twd int, seats_left int)
language plpgsql
set search_path = ''
as $$
declare
  v_event planet.events%rowtype;
  v_taken int;
  v_id uuid;
begin
  select * into v_event from planet.events e where e.id = p_event_id and e.published for update;
  if not found then raise exception 'event_not_found'; end if;
  if v_event.starts_at < now() then raise exception 'event_closed'; end if;

  perform planet.expire_unpaid_registrations(p_event_id);

  select count(*) into v_taken from planet.registrations r
   where r.event_id = p_event_id and r.status <> 'cancelled';
  if v_taken >= v_event.capacity then raise exception 'sold_out'; end if;

  if exists (select 1 from planet.registrations r
              where r.event_id = p_event_id and r.status <> 'cancelled'
                and lower(r.contact) = lower(btrim(p_contact))) then
    raise exception 'duplicate';
  end if;

  insert into planet.registrations (event_id, anon_id, nickname, contact, planet_id, issue, amount_twd, status, paid_at)
  values (p_event_id, p_anon_id, btrim(p_nickname), btrim(p_contact), p_planet_id, nullif(btrim(p_issue), ''), v_event.price_twd,
          case when v_event.price_twd = 0 then 'paid' else 'pending' end,
          case when v_event.price_twd = 0 then now() else null end)
  returning id into v_id;

  return query select v_id, v_event.price_twd, (v_event.capacity - v_taken - 1)::int;
end;
$$;

-- ---------- 付款成功（回查 status = 'S' 後才呼叫） ----------
-- 冪等：已 paid → already_paid；金額不符 → 不標記、記 needs_attention；
-- 目標（訂單／報名）只在 status = 'pending' 時轉 paid（transitioned = true）。
-- 報名若已因逾時被取消：座位仍有、且無重複報名 → 復原為 paid；否則記 needs_attention（需退款）。
create or replace function planet.mark_payment_paid(
  p_gateway_order_id text,
  p_amount int,
  p_pay_type text,
  p_raw jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_pay planet.payments%rowtype;
  v_status text;
  v_expected int;
  v_event planet.events%rowtype;
  v_reg planet.registrations%rowtype;
  v_taken int;
  v_n int;
  v_reason text;
  v_kind text;
  v_target uuid;
begin
  select * into v_pay from planet.payments where gateway_order_id = p_gateway_order_id for update;
  if not found then
    return jsonb_build_object('result', 'not_found', 'transitioned', false);
  end if;
  v_kind := case when v_pay.order_id is not null then 'order' else 'reg' end;
  v_target := coalesce(v_pay.order_id, v_pay.registration_id);

  update planet.payments
     set raw = raw || jsonb_build_object('paid_check_' || to_char(now(), 'YYYYMMDD"T"HH24MISS'), coalesce(p_raw, '{}'::jsonb))
   where id = v_pay.id;

  if v_pay.status = 'paid' then
    return jsonb_build_object('result', 'already_paid', 'transitioned', false, 'kind', v_kind, 'target_id', v_target);
  end if;

  if v_kind = 'order' then
    select o.status, o.total_twd into v_status, v_expected from planet.orders o where o.id = v_pay.order_id for update;
  else
    select * into v_reg from planet.registrations r where r.id = v_pay.registration_id for update;
    v_status := v_reg.status;
    v_expected := v_reg.amount_twd;
  end if;

  if p_amount is null or p_amount <> v_pay.amount or v_pay.amount <> v_expected then
    update planet.payments set needs_attention = 'amount_mismatch' where id = v_pay.id;
    return jsonb_build_object('result', 'amount_mismatch', 'transitioned', false, 'kind', v_kind, 'target_id', v_target,
                              'attention_new', v_pay.needs_attention is distinct from 'amount_mismatch');
  end if;

  update planet.payments
     set status = 'paid', paid_at = now(), pay_type = coalesce(nullif(p_pay_type, ''), pay_type)
   where id = v_pay.id;

  if v_kind = 'order' then
    update planet.orders set status = 'paid', paid_at = now() where id = v_pay.order_id and status = 'pending';
  else
    update planet.registrations set status = 'paid', paid_at = now() where id = v_pay.registration_id and status = 'pending';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    return jsonb_build_object('result', 'paid', 'transitioned', true, 'kind', v_kind, 'target_id', v_target);
  end if;

  -- 報名已被取消（逾時釋出）→ 嘗試復原
  if v_kind = 'reg' and v_status = 'cancelled' then
    select * into v_event from planet.events e where e.id = v_reg.event_id for update;
    select count(*) into v_taken from planet.registrations r
     where r.event_id = v_reg.event_id and r.status <> 'cancelled';
    if v_event.starts_at > now() and v_taken < v_event.capacity then
      begin
        update planet.registrations set status = 'paid', paid_at = now() where id = v_reg.id and status = 'cancelled';
        return jsonb_build_object('result', 'paid', 'reclaimed', true, 'transitioned', true, 'kind', v_kind, 'target_id', v_target);
      exception when unique_violation then
        null; -- 同聯絡方式已重新報名 → 落到下面 needs_attention
      end;
    end if;
  end if;

  v_reason := case when v_status in ('paid', 'shipped') then 'duplicate_payment' else 'paid_after_cancel' end;
  update planet.payments set needs_attention = v_reason where id = v_pay.id;
  return jsonb_build_object('result', 'needs_attention', 'reason', v_reason, 'transitioned', false,
                            'attention_new', true, 'kind', v_kind, 'target_id', v_target);
end;
$$;

-- ---------- 付款失敗（回查 status = 'F'） ----------
create or replace function planet.mark_payment_failed(p_gateway_order_id text, p_raw jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_n int;
begin
  update planet.payments
     set status = 'failed',
         raw = raw || jsonb_build_object('failed_' || to_char(now(), 'YYYYMMDD"T"HH24MISS'), coalesce(p_raw, '{}'::jsonb))
   where gateway_order_id = p_gateway_order_id and status = 'init';
  get diagnostics v_n = row_count;
  return jsonb_build_object('result', case when v_n = 1 then 'failed' else 'noop' end);
end;
$$;

-- ---------- ATM 取號 ----------
create or replace function planet.record_atm_info(
  p_gateway_order_id text,
  p_bank_code text,
  p_virtual_account text,
  p_expire_at timestamptz,
  p_raw jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_n int;
begin
  update planet.payments
     set atm_bank_code = coalesce(nullif(p_bank_code, ''), atm_bank_code),
         atm_virtual_account = coalesce(nullif(p_virtual_account, ''), atm_virtual_account),
         atm_expire_at = coalesce(p_expire_at, atm_expire_at),
         raw = raw || jsonb_build_object('atm_' || to_char(now(), 'YYYYMMDD"T"HH24MISS'), coalesce(p_raw, '{}'::jsonb))
   where gateway_order_id = p_gateway_order_id and status = 'init'
     and (atm_virtual_account is distinct from nullif(p_virtual_account, '')
          or atm_expire_at is distinct from coalesce(p_expire_at, atm_expire_at)
          or atm_bank_code is distinct from coalesce(nullif(p_bank_code, ''), atm_bank_code));
  get diagnostics v_n = row_count;
  return jsonb_build_object('result', case when v_n = 1 then 'updated' else 'noop' end);
end;
$$;

revoke all on function planet.touch_updated_at() from public, anon, authenticated;
revoke all on function planet.registration_is_stale(uuid, timestamptz) from public, anon, authenticated;
revoke all on function planet.expire_unpaid_registrations(uuid) from public, anon, authenticated;
revoke all on function planet.register_for_event(uuid, text, text, int, text, text) from public, anon, authenticated;
revoke all on function planet.mark_payment_paid(text, int, text, jsonb) from public, anon, authenticated;
revoke all on function planet.mark_payment_failed(text, jsonb) from public, anon, authenticated;
revoke all on function planet.record_atm_info(text, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function planet.registration_is_stale(uuid, timestamptz) to service_role;
grant execute on function planet.expire_unpaid_registrations(uuid) to service_role;
grant execute on function planet.register_for_event(uuid, text, text, int, text, text) to service_role;
grant execute on function planet.mark_payment_paid(text, int, text, jsonb) to service_role;
grant execute on function planet.mark_payment_failed(text, jsonb) to service_role;
grant execute on function planet.record_atm_info(text, text, text, timestamptz, jsonb) to service_role;
