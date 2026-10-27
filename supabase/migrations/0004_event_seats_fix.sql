-- 十二星球 · 0004_event_seats_fix
-- 修正 0003：event_seats view（security_invoker = false）裡呼叫 planet.registration_is_stale()，
-- 但 view 內的函式仍以「呼叫者」（anon）權限執行 → anon 讀 view 時 permission denied，前台整個 fallback 成 seed 資料。
-- 改成把逾時判斷直接寫在 view 裡（表存取以 view 擁有者權限執行），anon 不需要任何函式權限、也讀不到 payments。
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
                         or (p.status = 'init' and p.atm_virtual_account is not null
                             and coalesce(p.atm_expire_at, p.created_at + interval '3 days') > now()))
               )
             )
         ), 0)::int as seats_left
  from planet.events e
  left join planet.registrations r on r.event_id = e.id
  where e.published
  group by e.id;
grant select on planet.event_seats to anon, authenticated;
