import type { Letter, QuizQuestion } from "./types";

/**
 * 星球計分：每題所選選項 primary +2、secondary +1；加總最高者勝出，同分取 id 最小。
 * @param answers 依題目順序的選項字母（長度須等於題數）
 * @param questions 題目（依 id 排序）
 * @param planetIds 所有星球 id
 */
export function scorePlanet(answers: readonly Letter[], questions: readonly QuizQuestion[], planetIds: readonly number[]): number {
  if (answers.length !== questions.length) throw new Error("answers length mismatch");
  const scores = new Map<number, number>();
  for (const id of planetIds) scores.set(id, 0);
  answers.forEach((letter, qi) => {
    const opt = questions[qi].options.find((o) => o.letter === letter);
    if (!opt) throw new Error(`invalid answer ${letter} for question ${questions[qi].id}`);
    scores.set(opt.primary_planet_id, (scores.get(opt.primary_planet_id) ?? 0) + 2);
    scores.set(opt.secondary_planet_id, (scores.get(opt.secondary_planet_id) ?? 0) + 1);
  });
  let best = -1;
  let bestScore = -Infinity;
  for (const id of [...scores.keys()].sort((a, b) => a - b)) {
    const s = scores.get(id)!;
    if (s > bestScore) {
      best = id;
      bestScore = s;
    }
  }
  return best;
}

export function isLetter(x: unknown): x is Letter {
  return x === "A" || x === "B" || x === "C" || x === "D";
}
