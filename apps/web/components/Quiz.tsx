"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { scorePlanet, type Letter, type QuizQuestion } from "@planet/shared";
import { saveQuizResult } from "@/app/actions";
import { useStore } from "@/lib/store";
import { sx } from "@/lib/sx";

const LETTERS: Letter[] = ["A", "B", "C", "D"];

export function Quiz({ questions, planetIds }: { questions: QuizQuestion[]; planetIds: number[] }) {
  const router = useRouter();
  const [qi, setQi] = useState(0);
  const [ans, setAns] = useState<Letter[]>([]);
  const q = questions[qi];
  const total = questions.length;

  const toTop = () => window.scrollTo({ top: 0 });

  function answer(letter: Letter) {
    const next = ans.slice(0, qi);
    next[qi] = letter;
    if (qi < total - 1) {
      setAns(next);
      setQi(qi + 1);
      toTop();
      return;
    }
    const planetId = scorePlanet(next, questions, planetIds);
    const st = useStore.getState();
    st.setResult(planetId);
    // 寫入 quiz_results（server 端會用 DB 題目重新計分）；不阻塞導頁
    saveQuizResult({ answers: next, anonId: st.ensureAnonId() }).catch(() => {});
    router.push("/me");
    toTop();
  }

  function back() {
    if (qi === 0) router.push("/");
    else setQi(qi - 1);
  }

  return (
    <section
      data-screen-label="Quiz"
      className="gutter"
      style={sx("max-width:760px;margin:0 auto;padding:clamp(32px,6vw,72px) clamp(16px,4vw,40px);display:flex;flex-direction:column;gap:28px")}
    >
      <div style={sx("display:flex;justify-content:space-between;align-items:center;gap:12px")}>
        <button type="button" onClick={back} className="h-text-gold tap" style={sx("background:none;border:0;color:#aeb0c6;font-size:15px;cursor:pointer;padding:6px 0")}>
          ← {qi === 0 ? "回首頁" : "上一題"}
        </button>
        <span style={sx("font-size:15px;font-weight:600;color:#f0c96e")} aria-live="polite">
          第 {qi + 1} / {total} 題
        </span>
      </div>
      <div role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={qi + 1} style={sx("height:8px;border-radius:999px;background:#222b4f;overflow:hidden")}>
        <div style={sx("height:100%;background:#f0c96e;border-radius:999px;transition:width .3s", { width: `${((qi + 1) / total) * 100}%` })} />
      </div>
      <h2 className="wk" style={sx("margin:12px 0 0;font-size:clamp(30px,4.6vw,46px);line-height:1.3;font-weight:700")}>{q.text}</h2>
      <div style={sx("display:flex;flex-direction:column;gap:12px")}>
        {q.options.map((o, i) => {
          const on = ans[qi] === o.letter;
          return (
            <button
              key={o.letter}
              type="button"
              onClick={() => answer(o.letter)}
              aria-pressed={on}
              className="h-border-gold"
              style={sx("display:flex;align-items:center;gap:16px;width:100%;text-align:left;border-radius:20px;padding:18px 20px;font-size:18px;font-weight:500;cursor:pointer", {
                background: on ? "#f0c96e" : "#19213f",
                color: on ? "#10162e" : "#f6f0e1",
                border: `1.5px solid ${on ? "#f0c96e" : "#2a3358"}`,
              })}
            >
              <span style={sx("flex:0 0 36px;height:36px;border-radius:50%;background:#2a3358;color:#f0c96e;display:flex;align-items:center;justify-content:center;font-weight:700")}>{LETTERS[i]}</span>
              <span>{o.text}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
