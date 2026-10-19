-- 十二星球 · 0002_seed（由 scripts/gen-seed-sql.mjs 自動產生，文案逐字取自 data/seed.json）
-- 可重跑：全部 on conflict do update。

insert into planet.planets (id, slug, name, en, hue, tagline, description, strengths, weakness, meetup_role, kit_name, helper_planet_ids) values
(1, 'ember', '火山星', 'EMBER', 20, '熱血衝鋒隊', '想到就做，點子還沒講完人已經出發。你的能量會傳染，大家看到你就想動起來。', array['行動力爆表','敢說真話','關鍵時刻扛得住']::text[], '有時候衝太快，忘了等等隊友。', '推還在猶豫的人一把。', '火焰小圍巾', array[7,10]::int[]),
(2, 'anvil', '鐵砧星', 'ANVIL', 50, '可靠實幹家', '說到做到，交給你的事一定有著落。朋友遇到麻煩，第一個想到的就是你。', array['超強執行力','穩定可靠','把大問題拆小']::text[], '習慣自己扛，忘了你也可以求救。', '把別人的煩惱拆成能做的下一步。', '小工具腰帶', array[5,11]::int[]),
(3, 'dawn', '晨光星', 'DAWN', 80, '開朗點火者', '你一走進來，氣氛就亮了。陌生人變朋友只要五分鐘，冷場？不存在的。', array['破冰高手','樂觀感染力','讓人放鬆']::text[], '不太擅長面對自己的低潮。', '讓第一次來的人自在開口。', '太陽小帽', array[8,7]::int[]),
(4, 'beacon', '燈塔星', 'BEACON', 110, '暖心守護者', '你總是第一個發現誰落單了。默默照顧大家，是很多人心裡的安全感。', array['很會照顧人','細心觀察','給人安全感']::text[], '常常把自己排在最後一個。', '接住情緒最低落的那個人。', '星光小提燈', array[3,9]::int[]),
(5, 'mist', '霧林星', 'MIST', 140, '腦洞發明家', '你的腦袋像一座起霧的森林，走著走著就會冒出奇怪又好用的點子。', array['創意源源不絕','跳脫框架','把無聊變有趣']::text[], '點子太多，常常做到一半。', '給卡住的問題一個意想不到的解法。', '蘑菇小帽', array[10,2]::int[]),
(6, 'compass', '羅盤星', 'COMPASS', 170, '好奇探險家', '沒去過的地方、沒試過的事，都讓你眼睛發亮。你的人生是一張還在畫的地圖。', array['好奇心滿點','適應力超好','勇於嘗試']::text[], '對重複的日常容易失去耐心。', '提醒大家「其實還有別條路」。', '探險小背包', array[12,10]::int[]),
(7, 'chime', '風鈴星', 'CHIME', 200, '溫柔傾聽者', '別人的情緒你都聽得見，一陣小小的風，就能讓你心有所感。', array['共感力強','很會傾聽','說話溫柔']::text[], '太容易把別人的心事帶回家。', '讓說話的人覺得被真的聽見。', '風鈴小吊飾', array[1,2]::int[]),
(8, 'deep', '深海星', 'DEEP', 230, '安靜觀察家', '話不多，但每句都很有份量。你習慣潛到事情底下，看見別人沒看到的東西。', array['洞察力','冷靜分析','深度思考']::text[], '想太多的時候，會把自己困在海底。', '幫大家看清楚問題真正的樣子。', '小潛水鏡', array[3,6]::int[]),
(9, 'stardust', '星塵星', 'STARDUST', 260, '自由靈魂', '你不太在乎別人怎麼定義你。獨處時最有力量，也最懂自己要什麼。', array['自我覺察','獨立','有自己的風格']::text[], '太獨立了，讓人不知道怎麼靠近你。', '提醒大家「你不必跟別人一樣」。', '星星小斗篷', array[4,11]::int[]),
(10, 'hourglass', '沙漏星', 'HOURGLASS', 290, '精準規劃師', '行事曆是你最好的朋友。什麼時候該做什麼，你心裡都有一張表。', array['有條理','時間管理','計畫周全']::text[], '計畫被打亂時，會偷偷焦慮。', '幫大家排出真的做得到的計畫。', '懷錶小項鍊', array[5,9]::int[]),
(11, 'moonbridge', '月橋星', 'MOONBRIDGE', 320, '人際和事佬', '你像一座月光下的橋，總能把吵架的兩邊重新接起來。', array['協調溝通','換位思考','讓氣氛變柔軟']::text[], '太想讓大家開心，忘了說自己的意見。', '幫卡在人際關係裡的人找台階。', '彎月小髮夾', array[1,8]::int[]),
(12, 'garden', '花園星', 'GARDEN', 350, '耐心培育者', '你相信好事要慢慢長。對人、對植物、對自己，你都願意多等一下。', array['有耐心','溫柔又堅定','陪伴成長']::text[], '等太久，有時錯過說出口的時機。', '陪大家把小目標慢慢養大。', '小花圈', array[6,3]::int[])
on conflict (id) do update set slug = excluded.slug, name = excluded.name, en = excluded.en, hue = excluded.hue, tagline = excluded.tagline, description = excluded.description, strengths = excluded.strengths, weakness = excluded.weakness, meetup_role = excluded.meetup_role, kit_name = excluded.kit_name, helper_planet_ids = excluded.helper_planet_ids;

insert into planet.quiz_questions (id, text) values
(1, '週末突然空出一整天，你會…'),
(2, '朋友半夜傳訊息說他好煩，你會…'),
(3, '你最喜歡哪一種天氣？'),
(4, '在一群人裡，你通常是那個…'),
(5, '事情搞砸了，你的第一反應是…'),
(6, '如果要養一株植物，你希望它…'),
(7, '朋友最常說你…'),
(8, '來聚會，你最想帶走什麼？')
on conflict (id) do update set text = excluded.text;

insert into planet.quiz_options (question_id, letter, text, primary_planet_id, secondary_planet_id) values
(1, 'A', '揪一群人出去玩', 3, 1),
(1, 'B', '窩在家追劇看書', 8, 9),
(1, 'C', '去一個沒去過的地方', 6, 5),
(1, 'D', '把房間跟待辦清單整理好', 10, 2),
(2, 'A', '先聽他說完，陪著就好', 7, 12),
(2, 'B', '直接幫他想解法', 2, 10),
(2, 'C', '約他明天去吃好吃的', 3, 4),
(2, 'D', '幫他換個角度看事情', 8, 11),
(3, 'A', '大太陽！', 3, 1),
(3, 'B', '下雨天', 8, 7),
(3, 'C', '起霧的早晨', 5, 9),
(3, 'D', '有風的傍晚', 6, 11),
(4, 'A', '點子王', 5, 6),
(4, 'B', '照顧大家的人', 4, 12),
(4, 'C', '把事情做完的人', 2, 10),
(4, 'D', '讓大家和好的人', 11, 7),
(5, 'A', '先衝再說，邊做邊修', 1, 6),
(5, 'B', '冷靜想清楚哪裡出錯', 8, 10),
(5, 'C', '找信任的人聊聊', 7, 11),
(5, 'D', '給自己一點獨處時間', 9, 12),
(6, 'A', '慢慢長，需要耐心', 12, 4),
(6, 'B', '長得很奇特，很有個性', 5, 9),
(6, 'C', '好照顧，超堅強', 2, 1),
(6, 'D', '漂亮療癒，看了就開心', 7, 3),
(7, 'A', '好溫暖', 4, 12),
(7, 'B', '好有想法', 5, 8),
(7, 'C', '好可靠', 2, 4),
(7, 'D', '好自由', 9, 6),
(8, 'A', '一群新朋友', 3, 11),
(8, 'B', '被理解的感覺', 7, 9),
(8, 'C', '實際能用的建議', 10, 2),
(8, 'D', '看事情的新角度', 8, 1)
on conflict (question_id, letter) do update set text = excluded.text, primary_planet_id = excluded.primary_planet_id, secondary_planet_id = excluded.secondary_planet_id;

insert into planet.plants (id, name, note, price_twd, sort_order) values
(1, 'T1 翡翠', '圓潤飽滿，新手友善', 450, 1),
(2, 'T1 綠鑽', '葉片亮綠，很有精神', 450, 2),
(3, 'T1 觀音蓮', '葉脈像星圖', 480, 3),
(4, 'T1 拉威雪蓮', '淡淡霜白色', 480, 4),
(5, 'T1 小毛氈苔', '會抓小蟲的個性派', 520, 5),
(6, 'T2 粉紅公主', '粉嫩大尺寸', 680, 6),
(7, 'T2 正壽', '透亮窗面，大尺寸', 680, 7)
on conflict (id) do update set name = excluded.name, note = excluded.note, price_twd = excluded.price_twd, sort_order = excluded.sort_order;

insert into planet.products (sku, name, price_twd, sort_order) values
('x1', '星球寶寶 KELLY 提包', 450, 1),
('x2', '木質小桌燈', 1280, 2),
('x3', '12 星球水晶貼紙組', 150, 3)
on conflict (sku) do update set name = excluded.name, price_twd = excluded.price_twd, sort_order = excluded.sort_order;

insert into planet.settings (key, value) values ('kit_price_twd', '280'::jsonb)
on conflict (key) do update set value = excluded.value;

-- 活動時間視為台北時間；capacity 先用 seed 的 seats_left
insert into planet.events (slug, starts_at, city, venue, type, planet_id, title, description, price_twd, capacity) values
('e1', '2026-11-01 14:00:00+08'::timestamptz, '台北 · 大安', null, 'cross', null, '跨星球煩惱交換所', '每桌 4 顆不同星球，抽一張煩惱卡，輪流給建議。', 350, 4),
('e2', '2026-11-08 19:00:00+08'::timestamptz, '新竹 · 東區', null, 'same', 7, '風鈴星之夜：被好好聽見', '同星球的溫柔局，這次換你被聽。', 300, 7),
('e3', '2026-11-15 14:00:00+08'::timestamptz, '台中 · 西區', null, 'cross', null, '卡關診所：工作 & 人際', '帶著一件卡住的事來，30 分鐘輪桌，換三種星球的腦袋。', 350, 9),
('e4', '2026-11-22 10:30:00+08'::timestamptz, '新北 · 新店', null, 'open', null, '寶寶健檢日：燈泡植栽照護', '植栽師現場幫你的寶寶看狀況，教你換水、補光。', 250, 15),
('e5', '2026-11-29 19:30:00+08'::timestamptz, '台北 · 中山', null, 'same', 8, '深海星讀書夜', '安靜讀 40 分鐘，再慢慢聊。', 300, 2),
('e6', '2026-12-06 14:00:00+08'::timestamptz, '高雄 · 鹽埕', null, 'cross', null, '年末星球大會', '12 顆星球全員集合，一起把今年的卡關留在今年。', 450, 22)
on conflict (slug) do update set starts_at = excluded.starts_at, city = excluded.city, type = excluded.type, planet_id = excluded.planet_id, title = excluded.title, description = excluded.description, price_twd = excluded.price_twd, capacity = excluded.capacity;
