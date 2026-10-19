# Handoff: 十二星球 · 星球寶寶社群網站

> 給 Claude Code：請先完整讀完本文件，再讀 `design/Twelve Planets.dc.html`（原始設計，含全部樣式與邏輯）和 `data/seed.json`（全部文案資料）。目標是 **100% 還原** 這個設計，並部署到 GitHub + Vercel + Supabase + Railway。

## Overview
年輕人社群網站，概念受「小王子」啟發（但 12 顆星球、角色、文案全部原創，**不可使用小王子的角色、插畫或名稱**）。
1. 使用者做 8 題心理測驗 → 被分配到 12 顆星球之一。
2. 線上領養「星球寶寶」＝燈泡植栽（芯宸農業產品）＋星球專屬造型配件。植栽自選，造型由星球決定。
3. 瀏覽並線上報名線下聚會（同星球場／跨星球場／所有人），聚會時帶著寶寶，互相討論生活卡關。

## About the Design Files
`design/` 內的檔案是 **用 HTML 做的設計參考原型**，不是可直接上線的程式碼。`Twelve Planets.dc.html` 是一個自訂格式的單檔元件（template 用 `{{ }}`、`<sc-for>`、`<sc-if>`，邏輯在檔案底部 `class Component extends DCLogic`），需要同資料夾的 `support.js` 才能在瀏覽器開啟。請**用下方技術棧重寫**，並逐一對照原型的版面、顏色、字級、間距、文案與互動。
- 在本機用任何靜態伺服器開 `design/Twelve Planets.dc.html` 即可看到原型（例如 `npx serve design`）。
- `design/Mobile Preview.dc.html` 是 390×844 手機框預覽。

## Fidelity
**High-fidelity**。顏色、字體、字級、圓角、陰影、文案都是最終版，請像素級還原。價格、活動日期地點、產品照為示意，資料要放 DB 讓管理者修改。

---

## 技術棧與部署架構

```
GitHub (monorepo)
├── apps/web      → Vercel     Next.js 14+ App Router, TypeScript
├── apps/worker   → Railway    Node 20 (Hono)：金流 webhook、通知信、排程
├── packages/shared            型別、星球計分函式、seed 資料
└── supabase/                  schema.sql、migrations、seed script
Supabase：Postgres + Auth + Storage（產品照）+ RLS
```

**分工**
- **Vercel / apps/web**：所有頁面（SSR/ISR）、Server Actions 處理建立訂單、報名、存測驗結果（用 Supabase service role，僅在 server 端）。
- **Supabase**：資料庫（`supabase/schema.sql`）、Auth（Email magic link；之後可加 LINE Login）、Storage bucket `products` 放產品照。
- **Railway / apps/worker**：
  - `POST /webhooks/payment`：金流（綠界 ECPay 信用卡/ATM、LINE Pay）回呼 → 將 `orders.status` / `registrations.status` 更新為 `paid`。
  - 寄送訂單確認、活動行前通知（活動前 3 天，cron 每日 09:00 Asia/Taipei）。
  - 需要長連線或排程的工作都放這裡，不放 Vercel。
- **GitHub**：main 推送 → Vercel 自動部署 web；Railway 連 GitHub 自動部署 worker；Supabase migrations 用 GitHub Action `supabase db push`。

**環境變數**
```
# apps/web (Vercel)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
WORKER_URL=                     # Railway 服務網址
PAYMENT_PROVIDER=ecpay|linepay
# apps/worker (Railway)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ECPAY_MERCHANT_ID= / ECPAY_HASH_KEY= / ECPAY_HASH_IV=
LINEPAY_CHANNEL_ID= / LINEPAY_CHANNEL_SECRET=
RESEND_API_KEY=                 # 或其他寄信服務
TZ=Asia/Taipei
```

**步驟**
1. 建 GitHub repo，照上方結構初始化（pnpm workspaces）。
2. Supabase 建專案 → 執行 `supabase/schema.sql` → 寫 `scripts/seed.ts` 匯入 `data/seed.json`（planets、quiz_questions、quiz_options、plants、products、events；`settings.kit_price_twd = 280`；events 的 `capacity` 先用 `seats_left` 值）。
3. apps/web 實作所有頁面 → 部署 Vercel。
4. apps/worker 實作 webhook 與排程 → 部署 Railway。
5. 驗收：對照原型逐頁截圖比對（桌機 1440、手機 390）。

---

## 路由對照

| 原型 page | 路由 |
|---|---|
| home | `/` |
| quiz | `/quiz` |
| result | `/me`（我的星球；未測驗顯示空狀態） |
| planets | `/planets`、`/planets/[slug]`（選中的星球） |
| events | `/events`（`?type=all|cross|same|open|mine`）|
| shop | `/shop`（`?planet=slug` 預選造型） |
| 購物車抽屜 | 全站元件（右側抽屜）＋ `/checkout` 可選 |
| 報名對話框 | 全站元件（modal），也可對應 `/events/[slug]/register` |

---

## Design Tokens

**字體**（Google Fonts）
- `Fredoka` 400/500/600/700 — 拉丁字、數字、UI（body 主字體，fallback `Noto Sans TC`）
- `Noto Sans TC` 400/500/700/900 — 中文內文
- `LXGW WenKai TC` 400/700 — 所有大標題（繪本感），fallback `Noto Sans TC`, serif
- `body { font-family: 'Fredoka','Noto Sans TC',sans-serif; text-wrap: pretty; -webkit-font-smoothing: antialiased }`

**顏色**
| Token | 值 | 用途 |
|---|---|---|
| bg | `#10162e` | 頁面底 |
| bg-deep | `#0b1024` | 手機預覽外框 |
| drawer | `#151c38` | 抽屜、對話框 |
| surface | `#19213f` | 卡片 |
| surface-2 | `#222b4f` | 選中卡片、日期塊、次要按鈕 |
| line | `#2a3358` | 卡片 1px 邊框、分隔線 |
| line-2 | `#3d4672` | 輸入框邊、篩選 chip 邊 |
| line-3 | `#4c5684` | 次要按鈕外框 |
| text | `#f6f0e1` | 主文字 |
| text-2 | `#cfcbe0` | 內文說明 |
| muted | `#aeb0c6` | 次要資訊 |
| faint | `#8e90a8` | 註解 |
| gold | `#f0c96e` | 主色：主要按鈕、強調字 |
| gold-hover | `#f7d88f` | 主按鈕 hover |
| rose | `#f2a99a` | 小卡關、跨星球標籤、座位告急 |
| mint | `#9fd8c4` | 聚會角色、所有人標籤、已報名 |
| overlay | `rgba(5,8,20,.6)` 抽屜 / `.65` 對話框 | 遮罩 |
| header | `rgba(16,22,46,.86)` + `backdrop-filter: blur(10px)` | 黏頂導覽 |

標籤底色：same `rgba(240,201,110,.16)`／cross `rgba(242,169,154,.18)`／open `rgba(159,216,196,.16)`，文字分別用 gold／rose／mint。

**星球球體**（每顆星球 `hue` 見 seed）
```js
orb  = h => `radial-gradient(circle at 32% 28%, oklch(0.96 0.04 ${h}) 0%, oklch(0.8 0.11 ${h}) 40%, oklch(0.5 0.12 ${h}) 100%)`
glow = h => `oklch(0.75 0.12 ${h} / 0.35)`   // box-shadow: 0 0 Npx glow
```
金色太陽球（Logo、星軌中心、完成畫面）：`radial-gradient(circle at 32% 28%,#fff3c9,#f0c96e 45%,#a8792a)`（Logo 末段為 `#b9862e`），glow `rgba(240,201,110,.45~.5)`。

**星空背景**（整頁 wrapper）
```css
background-color:#10162e;
background-image:
 radial-gradient(1.5px 1.5px at 12% 18%,#f6f0e1 50%,transparent 52%),
 radial-gradient(1px 1px at 78% 9%,#f6f0e1 50%,transparent 52%),
 radial-gradient(1.5px 1.5px at 64% 42%,#f0c96e 50%,transparent 52%),
 radial-gradient(1px 1px at 33% 71%,#f6f0e1 50%,transparent 52%),
 radial-gradient(1px 1px at 90% 63%,#f6f0e1 50%,transparent 52%),
 radial-gradient(1.5px 1.5px at 6% 88%,#f0c96e 50%,transparent 52%);
background-size:640px 640px;
```

**圓角**：按鈕/chip `999px`；卡片 `24px`；大卡片/對話框/繪本 `28px`；選項 `20px`；小選項 `16–18px`；輸入框 `14px`；日期塊 `20px`；佔位圖 `16–20px`。
**陰影**：主按鈕 `0 8px 30px rgba(240,201,110,.3)`；繪本卡 `0 30px 80px rgba(0,0,0,.45)`。
**容器**：`max-width:1240px; margin:0 auto; padding-inline: clamp(16px,4vw,40px)`（測驗頁 760、聚會頁 1100）。
**區塊垂直間距**：`clamp(32px,6vw,72px)` 為主。
**Focus**：`outline:2px solid #f0c96e; outline-offset:3px`。`::selection` 金底深藍字。
**連結**：`a{color:#f0c96e}` `a:hover{color:#f7d88f}`。
**動畫**：結果頁大球 `floaty 5s ease-in-out infinite`（translateY 0 → -8px → 0）；測驗進度條 `transition: width .3s`。

**常用元件**
- 主要按鈕：gold 底、`#10162e` 字、600、`padding 16px 28px`、18px、圓角 999、主按鈕陰影；hover gold-hover。
- 次要按鈕：透明底、`1.5px solid #4c5684`、hover 邊框與字變 gold。
- 卡片：`#19213f`、`1px solid #2a3358`、圓角 24、padding 24–28。
- 選中態：底 `#222b4f`、邊框 `1.5px solid #f0c96e`。
- 輸入框：`#10162e` 底、`1.5px solid #3d4672`、圓角 14、padding `13px 14px`、16px。
- 產品佔位圖：`repeating-linear-gradient(135deg,#1d2649 0 12px,#222b4f 12px 24px)`，左下角 monospace 標籤（之後換成 Supabase Storage 的產品照）。

---

## Screens

所有精確樣式以 `design/Twelve Planets.dc.html` 為準（皆為 inline style，可直接讀數值）。以下是結構與行為。

### 全站 Header（sticky, z 20）
- 左：金色小球 26px + 「十二星球」（WenKai 700 21px），點擊回首頁。
- 導覽：首頁、心理測驗、（有結果時插入「我的星球」）、12 星球、聚會、星球寶寶。膠囊按鈕 15px/500，目前頁 gold 字＋`#222b4f` 底。
- 右：購物車膠囊（gold 底）＋數量徽章（深藍底 gold 字）。
- **手機 ≤720px**：Logo 與購物車同一行（購物車 `margin-left:auto`），導覽換到第二行、全寬、可水平捲動（隱藏捲軸）。

### 首頁 `/` — 三種 Hero（後台設定或 env `NEXT_PUBLIC_HERO=orbit|storybook|carousel`，預設 orbit）
- **orbit 星軌**：兩欄（`auto-fit minmax(min(100%,440px),1fr)`）。左：膠囊小標「✦ 2 分鐘測驗 · 每月線下聚會」、H1「每個人，／都是從一顆**小星球**／來的。」（WenKai clamp(42px,6vw,76px) lh 1.18，「小星球」gold）、說明、按鈕「開始測驗 →」「近期聚會」。右：正方形（max 560px），兩圈虛線軌道（inset 8%、26%），中心金球 32%（「你的星球」＋「？」），12 顆星球依 `angle = i*30° − 90°`、半徑 42% 排列，大小依 `i%3` 為 13% / 10% / 11.5%，下方 13px 名稱；點擊進該星球頁。
- **storybook 繪本**：米色 `#f6f0e1` 大卡（圓角 28），左插畫佔位（`#ece3cc/#e5dbc1` 斜紋，min-height 420）、右文：「第一章 · CHAPTER ONE」（`#a0731f`）、H1「從前從前，／宇宙裡有 12 顆小星球。」、內文 `#454a6b`、深藍按鈕「翻到下一頁：開始測驗 →」與外框按鈕「先看 12 顆星球」。
- **carousel 星球列**：置中 H1「嘿，你是**哪顆星**的？」＋說明＋按鈕「測出我的星球 →」，下方水平 scroll-snap 卡片列（每張 200px：編號·英文、96px 球、名稱、tagline）。
- 共用區塊：「三步，加入星球派對」三張卡（01 做測驗，找到星球／02 領養星球寶寶／03 帶著寶寶來聚會）；「近期聚會」前 3 筆活動卡＋「全部活動 →」。

### 測驗 `/quiz`
- 頂部：「← 回首頁 / 上一題」、「第 n / 8 題」；8px 進度條 gold，寬度 `(n/8)*100%`。
- 題目 WenKai clamp(30px,4.6vw,46px)。4 個選項全寬膠囊卡（A–D 字母圓），點選即自動下一題；回上一題時顯示先前選擇（gold 底）。
- **計分**：每個選項有 primary（+2）與 secondary（+1）星球；8 題後加總，最高分勝出，**同分取 id 最小者**。函式放 `packages/shared`，前後端共用。
- 完成 → 寫入 `quiz_results`（登入者帶 user_id，訪客帶 anon_id）、更新 `profiles.planet_id`、localStorage 也存一份 → 導向 `/me`。

### 我的星球 `/me`
- 未測驗：「你還沒有星球喔」＋開始測驗按鈕。
- 有結果：兩欄，左 380px 大球（glow 90px、floaty 動畫）；右「測驗結果 · 你來自 NN 號星球」、星球名（WenKai clamp(56px,8vw,104px)）、「EN · tagline」、描述、按鈕「領養我的星球寶寶 →」（→ `/shop?planet=`）「再測一次」。
- 三卡：你的超能力（✦ 列表，gold 標）／你的小卡關（rose 標）／聚會時，你最會（mint 標）。
- 「卡關時，可以找這兩顆星球聊聊」：helper_planet_ids 兩張可點卡片。

### 12 星球 `/planets`
- 兩欄：左詳細卡（112px 球、編號·英文、名稱 38px、tagline gold、描述、strength chips、小卡關、專屬造型、按鈕「領養{名稱}寶寶 →」）；右 `auto-fill minmax(130px,1fr)` 12 格，選中格 gold 邊，使用者自己的星球下方標「你的星球」。

### 聚會 `/events`
- 標題＋說明；篩選膠囊：全部、跨星球、同星球、所有人、（有結果時）適合我的（＝cross＋open＋同星球且為我的星球）。
- 每筆活動卡（flex-wrap）：84px 日期塊（月英文、日 32px gold、週）；類型標籤＋城市·時間；標題 20px/700；描述；右側價格、座位（≤4 顯示「只剩 N 位！」rose，否則「剩 N 位」）、按鈕「報名」或「已報名 ✓」（`#222b4f` 底 mint 字，不可再點）。
- **報名對話框**：標題列（日期·城市、活動名、✕）；欄位：暱稱*、Email 或手機*、我的星球（select，預設為測驗結果，或「還沒測驗」）、最近卡關的事（選填，只有主持人看得到；placeholder「例：工作上不知道怎麼拒絕主管…」）；報名費；「確認報名」。送出 → 建 `registrations`（status pending）→ 如需付費導向金流 → 成功畫面「報名成功，到時候見！」＋「行前通知會在活動前 3 天寄出。別忘了帶你的星球寶寶。」＋「好」。
- 座位數從 `event_seats` view 讀；滿額時按鈕改「已額滿」disabled。

### 星球寶寶 `/shop`
- 兩欄：左「1 選星球造型」12 格（`auto-fill minmax(92px,1fr)`，40px 球＋名稱）、「2 選你的植栽」7 列（名稱、說明、價格 gold）。右 sticky（top 88px）預覽卡：4:3 佔位圖＋右上 64px 星球球、「{星球}寶寶」、「{植栽} × {造型}」、明細（植栽價、造型 NT$280）、合計、按鈕「加入購物車」→ 加入後 1.4 秒顯示「已加入購物車 ✓」。
- 同一組合（星球＋植栽）重複加入 → 數量 +1。
- 「寶寶周邊」3 張商品卡＋「加入」；底部註「＊價格為示意，請依實際定價調整。」
- 預設造型：URL `?planet=` ＞ 測驗結果 ＞ 第 1 顆。

### 購物車抽屜（全站）
- 右側 `min(440px,100%)`、遮罩可點關閉。步驟：
  1. **購物車**：品項（44px 球、名稱、副標、小計、− 數量 +；減到 0 移除）、空狀態「購物車空空的，去領養一隻寶寶吧。」、合計、「前往結帳 →」（空車 opacity .45 不可點）。
  2. **結帳**：收件人*、手機*、取貨方式（超商取貨／宅配到府／聚會現場取貨）、付款方式（信用卡／LINE Pay／ATM 轉帳）、合計、「確認下單」、「← 回購物車」。送出 → Server Action 用 DB 價格重新計算金額建立 `orders`+`order_items` → 金流。
  3. **完成**：金球、「寶寶出發囉！」、說明、「看近期聚會 →」。清空購物車。
- 購物車存 localStorage（key `twelve-planets-v1`，結構 `{result, cart, regs}`），登入後可同步到 DB。

### Footer
「十二星球 · 星球寶寶由芯宸農業燈泡植栽培育」｜「LINE · Instagram · Facebook」（連到芯宸官方帳號：LINE `https://liff.line.me/1645278921-kWRPP32q/?accountId=178aheop`、IG `https://www.instagram.com/sharlight_plantpet/`、FB `https://www.facebook.com/SharlightAgritechResearch`）。

---

## State
- 前端：`page`（路由取代）、`qi`、`answers[]`、`result`、`selectedPlanet`、`cart[]`、`registeredEventIds[]`、`cartOpen`、`checkoutStep: cart|form|done`、`registerEventId`、`registerDone`、`eventFilter`、`shopPlanet`、`shopPlant`、`justAdded`。
- 建議用 Zustand（persist 到 localStorage）管購物車與測驗結果。
- 所有金額一律以 server 端 DB 價格為準。

## Data
- `data/seed.json`：12 星球（含 tagline、描述、3 個超能力、小卡關、聚會角色、造型名、互助星球）、8 題測驗（選項與計分對應）、7 種植栽、3 個周邊、6 場示意活動。**文案請逐字使用。**
- `supabase/schema.sql`：資料表、view、RLS。

## Assets
- 無點陣圖。產品照、繪本插畫目前皆為斜紋佔位，之後上傳 Supabase Storage（`plants.image_url`、`products.image_url`）。產品來源：芯宸農業 http://sharlight-agritech.com/product.php?fn=product&no5=C
- 星球全部以 CSS 漸層繪製（見 tokens）。
- 不使用 emoji；「✦」「→」「✓」「✕」為文字符號。

## Files
- `design/Twelve Planets.dc.html` — 完整原型（所有畫面、樣式、互動、資料常數）
- `design/Mobile Preview.dc.html` — 手機框預覽
- `design/support.js` — 原型執行時，僅供本機預覽
- `data/seed.json` — 種子資料
- `supabase/schema.sql` — 資料庫

## 驗收清單
- [ ] 三種 Hero 與原型一致（桌機 1440 / 手機 390）
- [ ] 測驗計分結果與原型相同（同樣答案得同樣星球）
- [ ] 報名寫入 DB、座位數即時更新、已報名不可重複
- [ ] 下單金額由 server 計算；金流 webhook（Railway）回寫 paid
- [ ] 行前通知 cron 正常
- [ ] RLS：使用者只能看到自己的訂單與報名；「卡關的事」只有管理者可讀
