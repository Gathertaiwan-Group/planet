import type { Metadata } from "next";
import { Quiz } from "@/components/Quiz";
import { getCatalog } from "@/lib/data";

export const revalidate = 60;
export const metadata: Metadata = { title: "心理測驗 · 十二星球" };

export default async function QuizPage() {
  const { questions, planets } = await getCatalog();
  return <Quiz questions={questions} planetIds={planets.map((p) => p.id)} />;
}
