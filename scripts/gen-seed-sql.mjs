#!/usr/bin/env node
// 由 packages/shared/src/seed.json 產生 supabase/migrations/0002_seed.sql（可重跑：on conflict do update）
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const seed = JSON.parse(await readFile(path.join(root, "packages/shared/src/seed.json"), "utf8"));

const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const arrText = (a) => `array[${a.map(q).join(",")}]::text[]`;
const arrInt = (a) => `array[${a.join(",")}]::int[]`;

let sql = `-- 十二星球 · 0002_seed（由 scripts/gen-seed-sql.mjs 自動產生，文案逐字取自 data/seed.json）\n-- 可重跑：全部 on conflict do update。\n\n`;

sql += `insert into planet.planets (id, slug, name, en, hue, tagline, description, strengths, weakness, meetup_role, kit_name, helper_planet_ids) values\n`;
sql += seed.planets
  .map((p) => `(${p.id}, ${q(p.slug)}, ${q(p.name)}, ${q(p.en)}, ${p.hue}, ${q(p.tagline)}, ${q(p.description)}, ${arrText(p.strengths)}, ${q(p.weakness)}, ${q(p.meetup_role)}, ${q(p.kit_name)}, ${arrInt(p.helper_planet_ids)})`)
  .join(",\n");
sql += `\non conflict (id) do update set slug = excluded.slug, name = excluded.name, en = excluded.en, hue = excluded.hue, tagline = excluded.tagline, description = excluded.description, strengths = excluded.strengths, weakness = excluded.weakness, meetup_role = excluded.meetup_role, kit_name = excluded.kit_name, helper_planet_ids = excluded.helper_planet_ids;\n\n`;

sql += `insert into planet.quiz_questions (id, text) values\n`;
sql += seed.quiz.map((x) => `(${x.id}, ${q(x.text)})`).join(",\n");
sql += `\non conflict (id) do update set text = excluded.text;\n\n`;

sql += `insert into planet.quiz_options (question_id, letter, text, primary_planet_id, secondary_planet_id) values\n`;
sql += seed.quiz
  .flatMap((x) => x.options.map((o) => `(${x.id}, ${q(o.letter)}, ${q(o.text)}, ${o.primary_planet_id}, ${o.secondary_planet_id})`))
  .join(",\n");
sql += `\non conflict (question_id, letter) do update set text = excluded.text, primary_planet_id = excluded.primary_planet_id, secondary_planet_id = excluded.secondary_planet_id;\n\n`;

sql += `insert into planet.plants (id, name, note, price_twd, sort_order) values\n`;
sql += seed.plants.map((p, i) => `(${p.id}, ${q(p.name)}, ${q(p.note)}, ${p.price_twd}, ${i + 1})`).join(",\n");
sql += `\non conflict (id) do update set name = excluded.name, note = excluded.note, price_twd = excluded.price_twd, sort_order = excluded.sort_order;\n\n`;

sql += `insert into planet.products (sku, name, price_twd, sort_order) values\n`;
sql += seed.extras.map((p, i) => `(${q(p.sku)}, ${q(p.name)}, ${p.price_twd}, ${i + 1})`).join(",\n");
sql += `\non conflict (sku) do update set name = excluded.name, price_twd = excluded.price_twd, sort_order = excluded.sort_order;\n\n`;

sql += `insert into planet.settings (key, value) values ('kit_price_twd', '${seed.kit_price_twd}'::jsonb)\non conflict (key) do update set value = excluded.value;\n\n`;

sql += `-- 活動時間視為台北時間；capacity 先用 seed 的 seats_left\n`;
sql += `insert into planet.events (slug, starts_at, city, venue, type, planet_id, title, description, price_twd, capacity) values\n`;
sql += seed.events
  .map((e) => `(${q(e.slug)}, ${q(`${e.date} ${e.time}:00+08`)}::timestamptz, ${q(e.city)}, null, ${q(e.type)}, ${e.planet_id ?? "null"}, ${q(e.title)}, ${q(e.description)}, ${e.price_twd}, ${e.seats_left})`)
  .join(",\n");
sql += `\non conflict (slug) do update set starts_at = excluded.starts_at, city = excluded.city, type = excluded.type, planet_id = excluded.planet_id, title = excluded.title, description = excluded.description, price_twd = excluded.price_twd, capacity = excluded.capacity;\n`;

await writeFile(path.join(root, "supabase/migrations/0002_seed.sql"), sql);
console.log("wrote supabase/migrations/0002_seed.sql");
