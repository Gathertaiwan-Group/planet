-- 十二星球 · 0001_init
-- 所有物件都在自訂 schema `planet`（此 DB 與 panpan / hank 共用，禁止動 public、禁止 supabase db push）。
-- 由 scripts/apply-migrations.mjs 透過 Supabase Management API 套用，帳本 planet.schema_migrations。

create schema if not exists planet;
grant usage on schema planet to anon, authenticated, service_role;

-- ---------- 目錄表（公開唯讀） ----------
create table if not exists planet.planets (
  id int primary key,                 -- 1..12，順序即星軌位置與同分 tie-break
  slug text unique not null,
  name text not null,
  en text not null,
  hue int not null,                   -- OKLCH hue
  tagline text not null,
  description text not null,
  strengths text[] not null,
  weakness text not null,
  meetup_role text not null,
  kit_name text not null,
  helper_planet_ids int[] not null
);

create table if not exists planet.quiz_questions (
  id int primary key,
  text text not null
);

create table if not exists planet.quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id int not null references planet.quiz_questions(id) on delete cascade,
  letter char(1) not null,
  text text not null,
  primary_planet_id int not null references planet.planets(id),   -- +2
  secondary_planet_id int not null references planet.planets(id), -- +1
  unique (question_id, letter)
);

create table if not exists planet.plants (
  id int primary key,
  name text not null,
  note text,
  price_twd int not null check (price_twd >= 0),
  image_url text,
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists planet.products (            -- 周邊
  sku text primary key,
  name text not null,
  price_twd int not null check (price_twd >= 0),
  image_url text,
  sort_order int not null default 0,
  active boolean not null default true
);

create table if not exists planet.settings (
  key text primary key,
  value jsonb not null
);

create table if not exists planet.events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  starts_at timestamptz not null,
  city text not null,
  venue text,
  type text not null check (type in ('same','cross','open')),
  planet_id int references planet.planets(id),
  title text not null,
  description text,
  price_twd int not null check (price_twd >= 0),
  capacity int not null check (capacity >= 0),
  published boolean not null default true,
  constraint events_same_needs_planet check (type <> 'same' or planet_id is not null)
);
create index if not exists events_starts_at_idx on planet.events (starts_at);

-- ---------- 使用者資料（僅 server 端 service role 可讀寫） ----------
-- 本期全訪客流程（anon_id 存 localStorage）；user_id 欄位保留給之後的登入。
create table if not exists planet.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  phone text,
  planet_id int references planet.planets(id),
  created_at timestamptz not null default now()
);

create table if not exists planet.quiz_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  anon_id text check (anon_id is null or char_length(anon_id) <= 64),
  answers char(1)[] not null,
  planet_id int not null references planet.planets(id),
  created_at timestamptz not null default now()
);

create table if not exists planet.registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references planet.events(id) on delete cascade,
  user_id uuid references auth.users(id),
  anon_id text check (anon_id is null or char_length(anon_id) <= 64),
  nickname text not null check (char_length(nickname) between 1 and 40),
  contact text not null check (char_length(contact) between 3 and 100),
  planet_id int references planet.planets(id),
  issue text check (issue is null or char_length(issue) <= 1000),   -- 私密：只有主持人（service role）看得到
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  amount_twd int not null default 0,
  payment_ref text unique,
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);
-- 同一活動同一聯絡方式不可重複報名（取消的不算）
create unique index if not exists registrations_event_contact_uniq
  on planet.registrations (event_id, lower(contact)) where status <> 'cancelled';

create table if not exists planet.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  anon_id text check (anon_id is null or char_length(anon_id) <= 64),
  recipient text not null check (char_length(recipient) between 1 and 40),
  phone text not null check (char_length(phone) between 6 and 20),
  shipping text not null check (shipping in ('超商取貨','宅配到府','聚會現場取貨')),
  payment text not null check (payment in ('信用卡','LINE Pay','ATM 轉帳')),
  total_twd int not null check (total_twd >= 0),
  status text not null default 'pending' check (status in ('pending','paid','shipped','cancelled')),
  payment_ref text unique,
  created_at timestamptz not null default now()
);

create table if not exists planet.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references planet.orders(id) on delete cascade,
  kind text not null check (kind in ('baby','extra')),
  planet_id int references planet.planets(id),
  plant_id int references planet.plants(id),
  sku text references planet.products(sku),
  name text not null,
  sub text,
  unit_price_twd int not null check (unit_price_twd >= 0),
  qty int not null check (qty > 0)
);
create index if not exists order_items_order_idx on planet.order_items (order_id);

-- ---------- 座位 view（security_invoker = false：以擁有者權限計算，只露出 id 與剩餘座位） ----------
create or replace view planet.event_seats with (security_invoker = false) as
  select e.id,
         greatest(e.capacity - count(r.id) filter (where r.status <> 'cancelled'), 0)::int as seats_left
  from planet.events e
  left join planet.registrations r on r.event_id = e.id
  where e.published
  group by e.id;

-- ---------- RLS ----------
alter table planet.planets        enable row level security;
alter table planet.quiz_questions enable row level security;
alter table planet.quiz_options   enable row level security;
alter table planet.plants         enable row level security;
alter table planet.products       enable row level security;
alter table planet.settings       enable row level security;
alter table planet.events         enable row level security;
alter table planet.profiles       enable row level security;
alter table planet.quiz_results   enable row level security;
alter table planet.registrations  enable row level security;
alter table planet.orders         enable row level security;
alter table planet.order_items    enable row level security;

drop policy if exists "public read" on planet.planets;
create policy "public read" on planet.planets for select to anon, authenticated using (true);
drop policy if exists "public read" on planet.quiz_questions;
create policy "public read" on planet.quiz_questions for select to anon, authenticated using (true);
drop policy if exists "public read" on planet.quiz_options;
create policy "public read" on planet.quiz_options for select to anon, authenticated using (true);
drop policy if exists "public read" on planet.plants;
create policy "public read" on planet.plants for select to anon, authenticated using (active);
drop policy if exists "public read" on planet.products;
create policy "public read" on planet.products for select to anon, authenticated using (active);
drop policy if exists "public read" on planet.settings;
create policy "public read" on planet.settings for select to anon, authenticated using (true);
drop policy if exists "public read" on planet.events;
create policy "public read" on planet.events for select to anon, authenticated using (published);
-- 使用者資料表：不給 anon / authenticated 任何 grant，RLS 也不開 policy → 只有 service role 能讀寫。

-- ---------- 權限 ----------
revoke all on all tables in schema planet from anon, authenticated;
grant select on planet.planets, planet.quiz_questions, planet.quiz_options, planet.plants,
                planet.products, planet.settings, planet.events to anon, authenticated;
grant select on planet.event_seats to anon, authenticated;
grant all on all tables in schema planet to service_role;
grant usage, select on all sequences in schema planet to service_role;

-- ---------- 交易函式（只給 service role 執行） ----------

-- 報名：鎖活動列 → 檢查截止 / 額滿 / 重複 → 建 pending 報名；金額取 DB 價格。
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

  select count(*) into v_taken from planet.registrations r
   where r.event_id = p_event_id and r.status <> 'cancelled';
  if v_taken >= v_event.capacity then raise exception 'sold_out'; end if;

  if exists (select 1 from planet.registrations r
              where r.event_id = p_event_id and r.status <> 'cancelled'
                and lower(r.contact) = lower(btrim(p_contact))) then
    raise exception 'duplicate';
  end if;

  insert into planet.registrations (event_id, anon_id, nickname, contact, planet_id, issue, amount_twd)
  values (p_event_id, p_anon_id, btrim(p_nickname), btrim(p_contact), p_planet_id, nullif(btrim(p_issue), ''), v_event.price_twd)
  returning id into v_id;

  return query select v_id, v_event.price_twd, (v_event.capacity - v_taken - 1)::int;
end;
$$;

-- 下單：品項只收 id 與數量，名稱 / 單價 / 合計全部由 DB 計算。
-- p_items: [{"kind":"baby","planet_id":5,"plant_id":1,"qty":1},{"kind":"extra","sku":"x1","qty":2}]
create or replace function planet.create_order(
  p_recipient text,
  p_phone text,
  p_shipping text,
  p_payment text,
  p_items jsonb,
  p_anon_id text
) returns table (order_id uuid, total_twd int)
language plpgsql
set search_path = ''
as $$
declare
  v_kit int;
  v_item jsonb;
  v_qty int;
  v_order uuid;
  v_total int := 0;
  v_name text;
  v_sub text;
  v_unit int;
  v_planet planet.planets%rowtype;
  v_plant planet.plants%rowtype;
  v_product planet.products%rowtype;
begin
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'empty_cart'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'too_many_items'; end if;

  select (s.value #>> '{}')::int into v_kit from planet.settings s where s.key = 'kit_price_twd';
  if v_kit is null then raise exception 'kit_price_missing'; end if;

  insert into planet.orders (anon_id, recipient, phone, shipping, payment, total_twd)
  values (p_anon_id, btrim(p_recipient), btrim(p_phone), p_shipping, p_payment, 0)
  returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'qty')::int;
    if v_qty is null or v_qty < 1 or v_qty > 99 then raise exception 'invalid_qty'; end if;

    if v_item->>'kind' = 'baby' then
      select * into v_planet from planet.planets p where p.id = (v_item->>'planet_id')::int;
      if not found then raise exception 'invalid_item'; end if;
      select * into v_plant from planet.plants p where p.id = (v_item->>'plant_id')::int and p.active;
      if not found then raise exception 'invalid_item'; end if;
      v_name := v_planet.name || '寶寶';
      v_sub := v_plant.name || ' × ' || v_planet.kit_name;
      v_unit := v_plant.price_twd + v_kit;
      insert into planet.order_items (order_id, kind, planet_id, plant_id, name, sub, unit_price_twd, qty)
      values (v_order, 'baby', v_planet.id, v_plant.id, v_name, v_sub, v_unit, v_qty);
    elsif v_item->>'kind' = 'extra' then
      select * into v_product from planet.products p where p.sku = v_item->>'sku' and p.active;
      if not found then raise exception 'invalid_item'; end if;
      v_unit := v_product.price_twd;
      insert into planet.order_items (order_id, kind, sku, name, sub, unit_price_twd, qty)
      values (v_order, 'extra', v_product.sku, v_product.name, '周邊', v_unit, v_qty);
    else
      raise exception 'invalid_item';
    end if;
    v_total := v_total + v_unit * v_qty;
  end loop;

  update planet.orders o set total_twd = v_total where o.id = v_order;
  return query select v_order, v_total;
end;
$$;

revoke all on function planet.register_for_event(uuid, text, text, int, text, text) from public, anon, authenticated;
revoke all on function planet.create_order(text, text, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function planet.register_for_event(uuid, text, text, int, text, text) to service_role;
grant execute on function planet.create_order(text, text, text, text, jsonb, text) to service_role;
