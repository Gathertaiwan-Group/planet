import { describe, expect, it } from "vitest";
import { scorePlanet, seedPlanets, seedQuestions, type Letter } from "../src/index";

// ---- 以下逐字抄自原型 design/Twelve Planets.dc.html（0-based 星球 index）----
const PL_LEN = 12;
const Q: { o: [string, [number, number]][] }[] = [
  { o: [['揪一群人出去玩', [2, 0]], ['窩在家追劇看書', [7, 8]], ['去一個沒去過的地方', [5, 4]], ['把房間跟待辦清單整理好', [9, 1]]] },
  { o: [['先聽他說完，陪著就好', [6, 11]], ['直接幫他想解法', [1, 9]], ['約他明天去吃好吃的', [2, 3]], ['幫他換個角度看事情', [7, 10]]] },
  { o: [['大太陽！', [2, 0]], ['下雨天', [7, 6]], ['起霧的早晨', [4, 8]], ['有風的傍晚', [5, 10]]] },
  { o: [['點子王', [4, 5]], ['照顧大家的人', [3, 11]], ['把事情做完的人', [1, 9]], ['讓大家和好的人', [10, 6]]] },
  { o: [['先衝再說，邊做邊修', [0, 5]], ['冷靜想清楚哪裡出錯', [7, 9]], ['找信任的人聊聊', [6, 10]], ['給自己一點獨處時間', [8, 11]]] },
  { o: [['慢慢長，需要耐心', [11, 3]], ['長得很奇特，很有個性', [4, 8]], ['好照顧，超堅強', [1, 0]], ['漂亮療癒，看了就開心', [6, 2]]] },
  { o: [['好溫暖', [3, 11]], ['好有想法', [4, 7]], ['好可靠', [1, 3]], ['好自由', [8, 5]]] },
  { o: [['一群新朋友', [2, 10]], ['被理解的感覺', [6, 8]], ['實際能用的建議', [9, 1]], ['看事情的新角度', [7, 0]]] },
];
/** 原型 answer() 的計分邏輯，回傳 0-based index */
function prototypeScore(ans: number[]): number {
  const score = Array.from({ length: PL_LEN }, () => 0);
  ans.forEach((a, qi) => Q[qi].o[a][1].forEach((p, k) => { score[p] += k === 0 ? 2 : 1; }));
  let best = 0; score.forEach((v, k) => { if (v > score[best]) best = k; });
  return best;
}
// ----------------------------------------------------------------------

const LETTERS: Letter[] = ["A", "B", "C", "D"];
const ids = seedPlanets.map((p) => p.id);
const ours = (ans: number[]) => scorePlanet(ans.map((i) => LETTERS[i]), seedQuestions, ids);

describe("seed 與原型資料一致", () => {
  it("選項文字與計分對應相同", () => {
    expect(seedQuestions).toHaveLength(8);
    seedQuestions.forEach((q, qi) => {
      q.options.forEach((o, oi) => {
        expect(o.letter).toBe(LETTERS[oi]);
        expect(o.text).toBe(Q[qi].o[oi][0]);
        expect([o.primary_planet_id - 1, o.secondary_planet_id - 1]).toEqual(Q[qi].o[oi][1]);
      });
    });
  });
});

describe("scorePlanet 與原型計分相同", () => {
  const cases: [string, number[]][] = [
    ["全選 A", [0, 0, 0, 0, 0, 0, 0, 0]],
    ["全選 B", [1, 1, 1, 1, 1, 1, 1, 1]],
    ["全選 C", [2, 2, 2, 2, 2, 2, 2, 2]],
    ["全選 D", [3, 3, 3, 3, 3, 3, 3, 3]],
    ["混合 1", [0, 1, 2, 3, 0, 1, 2, 3]],
    ["混合 2", [3, 2, 1, 0, 3, 2, 1, 0]],
  ];
  it.each(cases)("%s", (_, ans) => {
    expect(ours(ans)).toBe(prototypeScore(ans) + 1);
  });

  const tieCases: [string, number[], number][] = [
    ["星塵星(9) 與 花園星(12) 同分 4 分 → 9", [1, 1, 2, 3, 3, 0, 0, 0], 9],
    ["晨光星(3)、燈塔星(4)、花園星(12) 三方同分 → 3", [1, 2, 3, 1, 3, 0, 1, 0], 3],
    ["霧林星(5) 與 深海星(8) 同分 5 分 → 5", [2, 3, 1, 1, 3, 1, 1, 0], 5],
  ];
  it.each(tieCases)("同分取 id 最小：%s", (_, ans, expected) => {
    const score = new Map<number, number>();
    ans.forEach((a, qi) => {
      const o = seedQuestions[qi].options[a];
      score.set(o.primary_planet_id, (score.get(o.primary_planet_id) ?? 0) + 2);
      score.set(o.secondary_planet_id, (score.get(o.secondary_planet_id) ?? 0) + 1);
    });
    const max = Math.max(...score.values());
    const tied = [...score.entries()].filter(([, v]) => v === max).map(([k]) => k);
    expect(tied.length).toBeGreaterThan(1); // 確實是同分案例
    expect(ours(ans)).toBe(expected);
    expect(ours(ans)).toBe(Math.min(...tied));
    expect(ours(ans)).toBe(prototypeScore(ans) + 1);
  });

  it("窮舉全部 4^8 = 65536 組答案皆一致（含所有同分情況）", () => {
    let mismatches = 0;
    let ties = 0;
    for (let n = 0; n < 4 ** 8; n++) {
      const ans = Array.from({ length: 8 }, (_, i) => Math.floor(n / 4 ** i) % 4);
      if (ours(ans) !== prototypeScore(ans) + 1) mismatches++;
      // 統計同分案例數，確認窮舉確實覆蓋 tie-break
      const s = Array.from({ length: 12 }, () => 0);
      ans.forEach((a, qi) => Q[qi].o[a][1].forEach((p, k) => { s[p] += k === 0 ? 2 : 1; }));
      const max = Math.max(...s);
      if (s.filter((v) => v === max).length > 1) ties++;
    }
    expect(mismatches).toBe(0);
    expect(ties).toBeGreaterThan(1000);
  });

  it("答案長度不符時丟錯", () => {
    expect(() => scorePlanet(["A"], seedQuestions, ids)).toThrow();
  });
});
