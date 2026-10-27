-- 十二星球 · 0006_blackcat_amego
-- 金流由 PChomePay 改為「黑貓PAY（統一客樂得 COCS，收單統一金流）」＋付款成功後自動開立光貿 Amego 電子發票。
-- 契約與小時光書店／快樂手相同：契客 好日子股份有限公司（賣方統編 53912857）。
-- 只動 planet schema（同庫還有 panpan / hank，禁止碰）。由 scripts/apply-migrations.mjs 套用，絕不 supabase db push。
--
-- 與既有程式相容：舊的 mark_payment_paid() 保留不動（推碼前的舊部署仍可運作），新程式改呼叫 mark_blackcat_paid()。
--
-- 黑貓PAY 的關鍵差異（見 apps/web/lib/pay/blackcat-core.ts 檔頭）：
--   - APN 的 checksum 不含祕密 → 一律回查 CocsOrderQuery 的 process_code（15/20/21/22 才算授權）
--   - 實收金額只在 APN 的 payment_detail.pay_amount；回查回應沒有實收金額欄位（grant_amount 是扣手續費淨額，不可比對）
--   - APN 冪等鍵 = (provider, trans_id, status_code)，不含 nonce（每次重送 nonce 都不同）

-- ---------- payments：放寬金額下限、記錄實收金額與交易序號 ----------
alter table planet.payments drop constraint if exists payments_amount_check;
alter table planet.payments add constraint payments_amount_check check (amount between 1 and 100000); -- 黑貓PAY 單筆上限 100,000
alter table planet.payments alter column gateway set default 'blackcat';
alter table planet.payments add column if not exists buyer_email text;   -- 發票通知信箱（結帳時填的 email）
alter table planet.payments add column if not exists buyer_name text;    -- 發票買受人名稱（B2C，可空 → 「消費者」）
alter table planet.payments add column if not exists trans_id text;      -- 黑貓PAY 交易序號（APN trans_id）
alter table planet.payments add column if not exists paid_amount int;    -- APN payment_detail.pay_amount（實收）

-- ---------- APN 事件（冪等＋稽核；service role only） ----------
create table if not exists planet.payment_events (
  id bigint generated always as identity primary key,
  provider text not null default 'blackcat',
  trans_id text not null,
  status_code text not null,
  gateway_order_id text,
  amount int,
  pay_amount int,
  outcome text not null default 'pending',
  note text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payment_events_dedupe unique (provider, trans_id, status_code)
);
create index if not exists payment_events_order_idx on planet.payment_events (gateway_order_id);
drop trigger if exists payment_events_touch on planet.payment_events;
create trigger payment_events_touch before update on planet.payment_events
  for each row execute function planet.touch_updated_at();
alter table planet.payment_events enable row level security;
revoke all on planet.payment_events from anon, authenticated;
grant all on planet.payment_events to service_role;

-- ---------- 電子發票（一筆已付款的 payment 對一張發票；service role only） ----------
create table if not exists planet.invoices (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null unique references planet.payments(id) on delete restrict,
  order_ref text not null unique,                      -- Amego OrderId（= gateway_order_id，TP 開頭；Amego 端唯一 → 天然冪等鍵）
  amount int not null check (amount > 0),
  buyer_email text,
  buyer_name text,
  status text not null default 'pending' check (status in ('pending', 'issuing', 'issued', 'failed', 'voided')),
  invoice_number text unique,
  random_number text,
  issued_at timestamptz,
  retry_count int not null default 0,
  last_error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists invoices_backlog_idx on planet.invoices (status, created_at) where status <> 'issued';
drop trigger if exists invoices_touch on planet.invoices;
create trigger invoices_touch before update on planet.invoices
  for each row execute function planet.touch_updated_at();
alter table planet.invoices enable row level security;
revoke all on planet.invoices from anon, authenticated;
grant all on planet.invoices to service_role;

-- ---------- 報名逾時判斷：黑貓PAY 已授權（process_code 15/20/21/22）或請款失敗（23）的嘗試不釋出 ----------
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
               or p.needs_attention is not null
               or (p.status = 'init' and (
                     p.checked_at is null
                     or p.checked_at < p_created_at + interval '2 hours'
                     or p.gateway_status in ('P', 'S', '15', '20', '21', '22', '23')
                     or (p.atm_virtual_account is not null
                         and coalesce(p.atm_expire_at, p.created_at + interval '3 days') > now()))))
     );
$$;

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
                         or p.needs_attention is not null
                         or (p.status = 'init' and (
                               p.checked_at is null
                               or p.checked_at < r.created_at + interval '2 hours'
                               or p.gateway_status in ('P', 'S', '15', '20', '21', '22', '23')
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

-- ---------- 付款成功（回查 process_code ∈ {15,20,21,22} 且有 APN 實收金額後才呼叫） ----------
-- 與 mark_payment_paid 相同語意（冪等、金額三方比對、目標只在 pending 時轉 paid、報名逾時取消可復原），另外：
--   - p_amount 必須是 APN 的 payment_detail.pay_amount（實收）；null 一律視為金額不符（不標記、需人工）
--   - 記錄 trans_id / paid_amount
--   - 真的轉成 paid（transitioned）時，同一交易內建立待開發票列（invoices.status = 'pending'）
create or replace function planet.mark_blackcat_paid(
  p_gateway_order_id text,
  p_amount int,
  p_trans_id text,
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
     set raw = raw || jsonb_build_object('paid_check_' || to_char(now(), 'YYYYMMDD"T"HH24MISS'), coalesce(p_raw, '{}'::jsonb)),
         trans_id = coalesce(nullif(btrim(p_trans_id), ''), trans_id)
   where id = v_pay.id;

  if v_pay.status = 'paid' then
    return jsonb_build_object('result', 'already_paid', 'transitioned', false, 'kind', v_kind, 'target_id', v_target,
                              'payment_id', v_pay.id);
  end if;

  if v_kind = 'order' then
    select o.status, o.total_twd into v_status, v_expected from planet.orders o where o.id = v_pay.order_id for update;
  else
    select * into v_reg from planet.registrations r where r.id = v_pay.registration_id for update;
    v_status := v_reg.status;
    v_expected := v_reg.amount_twd;
  end if;

  if p_amount is null or p_amount <> v_pay.amount or v_pay.amount <> v_expected then
    update planet.payments set needs_attention = 'amount_mismatch', paid_amount = p_amount where id = v_pay.id;
    return jsonb_build_object('result', 'amount_mismatch', 'transitioned', false, 'kind', v_kind, 'target_id', v_target,
                              'payment_id', v_pay.id,
                              'attention_new', v_pay.needs_attention is distinct from 'amount_mismatch');
  end if;

  update planet.payments
     set status = 'paid', paid_at = now(), pay_type = 'CARD', paid_amount = p_amount
   where id = v_pay.id;

  if v_kind = 'order' then
    update planet.orders set status = 'paid', paid_at = now() where id = v_pay.order_id and status = 'pending';
  else
    update planet.registrations set status = 'paid', paid_at = now() where id = v_pay.registration_id and status = 'pending';
  end if;
  get diagnostics v_n = row_count;
  if v_n = 1 then
    insert into planet.invoices (payment_id, order_ref, amount, buyer_email, buyer_name)
    values (v_pay.id, v_pay.gateway_order_id, p_amount, v_pay.buyer_email, v_pay.buyer_name)
    on conflict (payment_id) do nothing;
    return jsonb_build_object('result', 'paid', 'transitioned', true, 'kind', v_kind, 'target_id', v_target,
                              'payment_id', v_pay.id);
  end if;

  -- 報名已被取消（逾時釋出）→ 嘗試復原
  if v_kind = 'reg' and v_status = 'cancelled' then
    select * into v_event from planet.events e where e.id = v_reg.event_id for update;
    select count(*) into v_taken from planet.registrations r
     where r.event_id = v_reg.event_id and r.status <> 'cancelled';
    if v_event.starts_at > now() and v_taken < v_event.capacity then
      begin
        update planet.registrations set status = 'paid', paid_at = now() where id = v_reg.id and status = 'cancelled';
        insert into planet.invoices (payment_id, order_ref, amount, buyer_email, buyer_name)
        values (v_pay.id, v_pay.gateway_order_id, p_amount, v_pay.buyer_email, v_pay.buyer_name)
        on conflict (payment_id) do nothing;
        return jsonb_build_object('result', 'paid', 'reclaimed', true, 'transitioned', true, 'kind', v_kind,
                                  'target_id', v_target, 'payment_id', v_pay.id);
      exception when unique_violation then
        null; -- 同聯絡方式已重新報名 → 落到下面 needs_attention
      end;
    end if;
  end if;

  -- 收到錢但目標已付款／已取消 → 不開發票（多半要退款），交人工處理
  v_reason := case when v_status in ('paid', 'shipped') then 'duplicate_payment' else 'paid_after_cancel' end;
  update planet.payments set needs_attention = v_reason where id = v_pay.id;
  return jsonb_build_object('result', 'needs_attention', 'reason', v_reason, 'transitioned', false,
                            'attention_new', v_pay.needs_attention is distinct from v_reason,
                            'kind', v_kind, 'target_id', v_target, 'payment_id', v_pay.id);
end;
$$;

-- ---------- 標記需人工處理（回傳是否為新狀況，用來只寄一次通知） ----------
create or replace function planet.flag_payment_attention(p_gateway_order_id text, p_reason text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_n int;
begin
  update planet.payments
     set needs_attention = left(p_reason, 40)
   where gateway_order_id = p_gateway_order_id
     and needs_attention is distinct from left(p_reason, 40);
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

-- ---------- 發票：claim → 打 Amego → finish / fail（開出去撤不回來，所以鎖在 DB） ----------
-- claimed=false 的 reason：not_found / not_paid / already_issued / voided / retries_exhausted / locked
create or replace function planet.claim_invoice_issue(
  p_payment_id uuid,
  p_stale_after interval default '5 minutes',
  p_max_retries int default 10
) returns table (
  claimed boolean,
  reason text,
  attempt int,
  order_ref text,
  amount int,
  buyer_email text,
  buyer_name text,
  invoice_number text
)
language plpgsql
set search_path = ''
as $$
declare
  v_inv planet.invoices%rowtype;
  v_pay_status text;
begin
  select * into v_inv from planet.invoices i where i.payment_id = p_payment_id for update;
  if not found then
    return query select false, 'not_found'::text, 0, null::text, 0, null::text, null::text, null::text;
    return;
  end if;
  select p.status into v_pay_status from planet.payments p where p.id = p_payment_id;
  if v_pay_status is distinct from 'paid' then
    return query select false, 'not_paid'::text, v_inv.retry_count, v_inv.order_ref, v_inv.amount, null::text, null::text, null::text;
    return;
  end if;
  if v_inv.status = 'issued' then
    return query select false, 'already_issued'::text, v_inv.retry_count, v_inv.order_ref, v_inv.amount, null::text, null::text, v_inv.invoice_number;
    return;
  end if;
  if v_inv.status = 'voided' then
    return query select false, 'voided'::text, v_inv.retry_count, v_inv.order_ref, v_inv.amount, null::text, null::text, v_inv.invoice_number;
    return;
  end if;
  if v_inv.status = 'failed' and v_inv.retry_count >= p_max_retries then
    return query select false, 'retries_exhausted'::text, v_inv.retry_count, v_inv.order_ref, v_inv.amount, null::text, null::text, null::text;
    return;
  end if;
  if v_inv.status = 'issuing' and v_inv.locked_at is not null and v_inv.locked_at >= now() - p_stale_after then
    return query select false, 'locked'::text, v_inv.retry_count, v_inv.order_ref, v_inv.amount, null::text, null::text, null::text;
    return;
  end if;
  -- 過期的 issuing（程序在打 Amego 途中被砍）也可接手；attempt > 0 時呼叫端會先向 Amego 查是否已開過
  update planet.invoices i
     set status = 'issuing',
         locked_at = now(),
         retry_count = case when v_inv.status = 'issuing' then i.retry_count + 1 else i.retry_count end
   where i.id = v_inv.id
  returning * into v_inv;
  return query select true, 'claimed'::text, v_inv.retry_count, v_inv.order_ref, v_inv.amount, v_inv.buyer_email, v_inv.buyer_name, null::text;
end;
$$;

-- 開立成功。同一筆出現第二個發票號碼 → raise（代表真的多開了一張稅務憑證）
create or replace function planet.finish_invoice_issue(
  p_payment_id uuid,
  p_invoice_number text,
  p_random_number text default null,
  p_issued_at timestamptz default null
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_inv planet.invoices%rowtype;
begin
  if p_invoice_number is null or length(btrim(p_invoice_number)) = 0 then
    raise exception 'EMPTY_INVOICE_NUMBER';
  end if;
  select * into v_inv from planet.invoices i where i.payment_id = p_payment_id for update;
  if not found then
    raise exception 'INVOICE_ROW_MISSING:%', p_payment_id;
  end if;
  if v_inv.status = 'issued' then
    if v_inv.invoice_number is distinct from p_invoice_number then
      raise exception 'DOUBLE_ISSUE:% existing=% incoming=%', p_payment_id, v_inv.invoice_number, p_invoice_number;
    end if;
    return false;
  end if;
  update planet.invoices i
     set status = 'issued',
         invoice_number = btrim(p_invoice_number),
         random_number = coalesce(p_random_number, i.random_number),
         issued_at = coalesce(p_issued_at, now()),
         last_error = null,
         locked_at = null
   where i.id = v_inv.id;
  return true;
end;
$$;

-- 開立失敗。p_permanent = true（資料／設定問題，重試也一樣）→ retry_count 直接推到上限
create or replace function planet.fail_invoice_issue(
  p_payment_id uuid,
  p_error text,
  p_permanent boolean default false,
  p_max_retries int default 10
) returns int
language plpgsql
set search_path = ''
as $$
declare
  v_retry int;
begin
  update planet.invoices i
     set status = 'failed',
         last_error = left(coalesce(p_error, 'unknown'), 500),
         retry_count = case when p_permanent then greatest(i.retry_count + 1, p_max_retries) else i.retry_count + 1 end,
         locked_at = null
   where i.payment_id = p_payment_id
     and i.status <> 'issued'
  returning i.retry_count into v_retry;
  return v_retry;
end;
$$;

-- 待開清單（pending、可重試的 failed、過期的 issuing）
create or replace function planet.invoice_backlog(p_limit int default 20, p_max_retries int default 10)
returns table (payment_id uuid, order_ref text)
language sql
stable
set search_path = ''
as $$
  select i.payment_id, i.order_ref
    from planet.invoices i
    join planet.payments p on p.id = i.payment_id and p.status = 'paid'
   where i.status = 'pending'
      or (i.status = 'failed' and i.retry_count < p_max_retries)
      or (i.status = 'issuing' and (i.locked_at is null or i.locked_at < now() - interval '5 minutes'))
   order by i.created_at
   limit greatest(p_limit, 0);
$$;

revoke all on function planet.registration_is_stale(uuid, timestamptz) from public, anon, authenticated;
revoke all on function planet.mark_blackcat_paid(text, int, text, jsonb) from public, anon, authenticated;
revoke all on function planet.flag_payment_attention(text, text) from public, anon, authenticated;
revoke all on function planet.claim_invoice_issue(uuid, interval, int) from public, anon, authenticated;
revoke all on function planet.finish_invoice_issue(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function planet.fail_invoice_issue(uuid, text, boolean, int) from public, anon, authenticated;
revoke all on function planet.invoice_backlog(int, int) from public, anon, authenticated;
grant execute on function planet.registration_is_stale(uuid, timestamptz) to service_role;
grant execute on function planet.mark_blackcat_paid(text, int, text, jsonb) to service_role;
grant execute on function planet.flag_payment_attention(text, text) to service_role;
grant execute on function planet.claim_invoice_issue(uuid, interval, int) to service_role;
grant execute on function planet.finish_invoice_issue(uuid, text, text, timestamptz) to service_role;
grant execute on function planet.fail_invoice_issue(uuid, text, boolean, int) to service_role;
grant execute on function planet.invoice_backlog(int, int) to service_role;
