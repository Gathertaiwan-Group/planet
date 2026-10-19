-- 十二星球 · Supabase schema
-- Run in Supabase SQL editor, then load data/seed.json via scripts/seed.ts

create extension if not exists "pgcrypto";

create table planets (
  id int primary key,                 -- 1..12, order matters (orbit position + tie-break)
  slug text unique not null,
  name text not null,
  en text not null,
  hue int not null,                   -- OKLCH hue for orb gradient
  tagline text not null,
  description text not null,
  strengths text[] not null,
  weakness text not null,
  meetup_role text not null,
  kit_name text not null,
  helper_planet_ids int[] not null
);

create table quiz_questions (
  id int primary key,
  text text not null
);

create table quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id int references quiz_questions(id) on delete cascade,
  letter char(1) not null,
  text text not null,
  primary_planet_id int references planets(id),   -- +2
  secondary_planet_id int references planets(id), -- +1
  unique (question_id, letter)
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  phone text,
  planet_id int references planets(id),
  created_at timestamptz default now()
);

create table quiz_results (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  anon_id text,                         -- for guests (localStorage id)
  answers char(1)[] not null,           -- e.g. {A,C,B,D,A,B,C,D}
  planet_id int references planets(id) not null,
  created_at timestamptz default now()
);

create table plants (
  id int primary key,
  name text not null,
  note text,
  price_twd int not null,
  image_url text,
  active boolean default true
);

create table products (                 -- extras / 周邊
  sku text primary key,
  name text not null,
  price_twd int not null,
  image_url text,
  active boolean default true
);

create table settings (key text primary key, value jsonb not null);
-- insert into settings values ('kit_price_twd', '280');

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  starts_at timestamptz not null,
  city text not null,
  venue text,
  type text not null check (type in ('same','cross','open')),
  planet_id int references planets(id),           -- required when type='same'
  title text not null,
  description text,
  price_twd int not null,
  capacity int not null,
  published boolean default true
);

create table registrations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  user_id uuid references auth.users(id),
  nickname text not null,
  contact text not null,
  planet_id int references planets(id),
  issue text,                                     -- private: host only
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  created_at timestamptz default now()
);

create view event_seats as
  select e.id, e.capacity - count(r.id) filter (where r.status <> 'cancelled') as seats_left
  from events e left join registrations r on r.event_id = e.id group by e.id;

create table orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  recipient text not null,
  phone text not null,
  shipping text not null check (shipping in ('超商取貨','宅配到府','聚會現場取貨')),
  payment text not null check (payment in ('信用卡','LINE Pay','ATM 轉帳')),
  total_twd int not null,
  status text not null default 'pending' check (status in ('pending','paid','shipped','cancelled')),
  payment_ref text,
  created_at timestamptz default now()
);

create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete cascade,
  kind text not null check (kind in ('baby','extra')),
  planet_id int references planets(id),   -- baby: kit
  plant_id int references plants(id),     -- baby: plant
  sku text references products(sku),      -- extra
  name text not null,                     -- snapshot e.g. 霧林星寶寶
  sub text,                               -- snapshot e.g. T1 翡翠 × 蘑菇小帽
  unit_price_twd int not null,
  qty int not null check (qty > 0)
);

-- RLS
alter table profiles enable row level security;
alter table quiz_results enable row level security;
alter table registrations enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "own profile" on profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "insert result" on quiz_results for insert with check (true);
create policy "read own results" on quiz_results for select using (auth.uid() = user_id);
create policy "insert registration" on registrations for insert with check (auth.uid() = user_id or user_id is null);
create policy "read own registrations" on registrations for select using (auth.uid() = user_id);
create policy "read own orders" on orders for select using (auth.uid() = user_id);
create policy "read own order items" on order_items for select using (exists (select 1 from orders o where o.id = order_id and o.user_id = auth.uid()));
-- Orders are created server-side (service role) only — no client insert policy.

-- Public read for catalog tables
alter table planets enable row level security;      create policy "public" on planets for select using (true);
alter table quiz_questions enable row level security; create policy "public" on quiz_questions for select using (true);
alter table quiz_options enable row level security; create policy "public" on quiz_options for select using (true);
alter table plants enable row level security;       create policy "public" on plants for select using (active);
alter table products enable row level security;     create policy "public" on products for select using (active);
alter table events enable row level security;       create policy "public" on events for select using (published);
alter table settings enable row level security;     create policy "public" on settings for select using (true);
