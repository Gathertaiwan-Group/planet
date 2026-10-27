-- 十二星球 · 0007_pay_review_fixes（黑貓PAY 審查修正）
-- 只動 planet schema。由 scripts/apply-migrations.mjs 套用，絕不 supabase db push。
--   M1  重新付款序列化：同一訂單／報名同時只能有一筆 init（partial unique）；舊嘗試改 superseded（仍會被對帳、仍可入帳）
--       黑貓PAY 無法確定能作廢「未授權」的單（CocsOrderCancel 是取消授權用），所以不呼叫作廢，改靠：
--       舊單付了 → mark_blackcat_paid 照常入帳（目標仍 pending 時合法）；兩筆都付 → duplicate_payment 需人工
--   M3  報名改 Email 必填，手機選填 → registrations.phone
--   L1  金額比對改 is distinct from（目標不存在／應收為 null 時不入帳）
--   L4  process_code 13/14（刷卡頁、繳款人確認）也保留名額不釋出
--   清掉舊的 mark_payment_paid（PChomePay 版，程式已無引用）

-- ---------- M1 ----------
alter table planet.payments drop constraint if exists payments_status_check;
alter table planet.payments add constraint payments_status_check check (status in ('init', 'paid', 'failed', 'superseded'));
create unique index if not exists payments_one_open_order on planet.payments (order_id) where status = 'init' and order_id is not null;
create unique index if not exists payments_one_open_reg on planet.payments (registration_id) where status = 'init' and registration_id is not null;

-- 開一筆新的付款嘗試（序列化點）：鎖住目標列，
--   p_based_on = null（第一次結帳）：目標不可已有 init
--   p_based_on = 舊付款編號（重新付款）：目前的 init 只能是它本人（或沒有 init）；有別的 init → 已被別人搶先（superseded）
-- 通過後把舊 init 轉 superseded，插入新的 init。
create or replace function planet.begin_payment_attempt(
  p_kind text,
  p_target uuid,
  p_gateway_order_id text,
  p_amount int,
  p_buyer_email text,
  p_buyer_name text,
  p_based_on text
) returns text
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_open text;
begin
  if p_kind = 'order' then
    select o.status into v_status from planet.orders o where o.id = p_target for update;
  elsif p_kind = 'reg' then
    select r.status into v_status from planet.registrations r where r.id = p_target for update;
  else
    raise exception 'bad_kind';
  end if;
  if v_status is distinct from 'pending' then
    return 'not_pending';
  end if;

  select p.gateway_order_id into v_open from planet.payments p
   where p.status = 'init'
     and ((p_kind = 'order' and p.order_id = p_target) or (p_kind = 'reg' and p.registration_id = p_target))
   limit 1;
  if v_open is not null and v_open is distinct from p_based_on then
    return 'superseded';
  end if;
  if p_based_on is not null and exists (
    select 1 from planet.payments p
     where p.status = 'paid'
       and ((p_kind = 'order' and p.order_id = p_target) or (p_kind = 'reg' and p.registration_id = p_target))) then
    return 'already_paid';
  end if;

  update planet.payments set status = 'superseded' where gateway_order_id = v_open and status = 'init';

  insert into planet.payments (gateway, gateway_order_id, order_id, registration_id, amount, pay_type, buyer_email, buyer_name)
  values ('blackcat', p_gateway_order_id,
          case when p_kind = 'order' then p_target end,
          case when p_kind = 'reg' then p_target end,
          p_amount, 'CARD', nullif(btrim(p_buyer_email), ''), nullif(btrim(p_buyer_name), ''));
  return 'ok';
exception when unique_violation then
  return 'conflict';
end;
$$;

-- 失敗也適用 superseded（回查確認拿不到錢就不用再對帳）
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
   where gateway_order_id = p_gateway_order_id and status in ('init', 'superseded');
  get diagnostics v_n = row_count;
  return jsonb_build_object('result', case when v_n = 1 then 'failed' else 'noop' end);
end;
$$;

-- ---------- M3 ----------
alter table planet.registrations add column if not exists phone text check (phone is null or char_length(phone) between 6 and 20);

-- ---------- L4（＋M1：superseded 視同仍開著） ----------
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
               or (p.status in ('init', 'superseded') and (
                     p.checked_at is null
                     or p.checked_at < p_created_at + interval '2 hours'
                     or p.gateway_status in ('P', 'S', '13', '14', '15', '20', '21', '22', '23')
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
                         or (p.status in ('init', 'superseded') and (
                               p.checked_at is null
                               or p.checked_at < r.created_at + interval '2 hours'
                               or p.gateway_status in ('P', 'S', '13', '14', '15', '20', '21', '22', '23')
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

-- ---------- L1（簽名與 RETURNS 不變 → create or replace 即可） ----------
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

  -- 三方比對：實收（APN pay_amount）= payments.amount = 應收；任一為 null 都不入帳
  if p_amount is null or v_expected is null
     or p_amount is distinct from v_pay.amount or v_pay.amount is distinct from v_expected then
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
        null;
      end;
    end if;
  end if;

  v_reason := case when v_status in ('paid', 'shipped') then 'duplicate_payment' else 'paid_after_cancel' end;
  update planet.payments set needs_attention = v_reason where id = v_pay.id;
  return jsonb_build_object('result', 'needs_attention', 'reason', v_reason, 'transitioned', false,
                            'attention_new', v_pay.needs_attention is distinct from v_reason,
                            'kind', v_kind, 'target_id', v_target, 'payment_id', v_pay.id);
end;
$$;

-- ---------- 清掉 PChomePay 時代的舊函式 ----------
drop function if exists planet.mark_payment_paid(text, int, text, jsonb);
drop function if exists planet.record_atm_info(text, text, text, timestamptz, jsonb);

revoke all on function planet.begin_payment_attempt(text, uuid, text, int, text, text, text) from public, anon, authenticated;
revoke all on function planet.mark_payment_failed(text, jsonb) from public, anon, authenticated;
revoke all on function planet.registration_is_stale(uuid, timestamptz) from public, anon, authenticated;
revoke all on function planet.mark_blackcat_paid(text, int, text, jsonb) from public, anon, authenticated;
grant execute on function planet.begin_payment_attempt(text, uuid, text, int, text, text, text) to service_role;
grant execute on function planet.mark_payment_failed(text, jsonb) to service_role;
grant execute on function planet.registration_is_stale(uuid, timestamptz) to service_role;
grant execute on function planet.mark_blackcat_paid(text, int, text, jsonb) to service_role;
