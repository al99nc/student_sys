"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getResults, recordQuizResult } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";

interface QuizMCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

export default function QuizPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const lectureId = parseInt(params.id as string);
  const fromConvId = searchParams.get("from");
  const countParam = searchParams.get("count");
  const questionLimit = countParam ? parseInt(countParam) : null;
  const backHref = fromConvId ? `/coach/${fromConvId}` : `/results/${lectureId}`;

  const [questions, setQuestions] = useState<QuizMCQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"quiz" | "result">("quiz");
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [questionTime, setQuestionTime] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    getResults(lectureId)
      .then(res => {
        const all: QuizMCQ[] = res.data.mcqs || [];
        setQuestions(questionLimit ? all.slice(0, questionLimit) : all);
      })
      .catch(() => router.push(`/results/${lectureId}`))
      .finally(() => setLoading(false));
  }, [lectureId, router]);

  // Per-question timer — resets on each new question, stops on reveal
  useEffect(() => {
    setQuestionTime(0);
    if (timerRef.current) clearInterval(timerRef.current);
    if (phase !== "quiz") return;
    timerRef.current = setInterval(() => setQuestionTime(t => t + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [currentQ, phase]);

  useEffect(() => {
    if (revealed && timerRef.current) clearInterval(timerRef.current);
  }, [revealed]);

  // Auto-redirect to coach if coming from there (when quiz completes)
  useEffect(() => {
    if (phase === "result" && fromConvId) {
      const timer = setTimeout(() => {
        const pct = Math.round((score / questions.length) * 100);
        router.push(`/coach/${fromConvId}?quiz_score=${score}&quiz_total=${questions.length}&quiz_pct=${pct}`);
      }, 2000); // 2 second delay to show results
      return () => clearTimeout(timer);
    }
  }, [phase, fromConvId, score, questions.length, router]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const handleSelect = (letter: string) => {
    if (revealed) return;
    setSelectedLetter(letter);
    setRevealed(true);
    if (letter === questions[currentQ]?.answer) setScore(s => s + 1);
  };

  const advance = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ(q => q + 1);
      setSelectedLetter(null);
      setRevealed(false);
    } else {
      // Save result to performance DB (fire-and-forget; score already updated by handleSelect)
      recordQuizResult(lectureId, score, questions.length, fromConvId ? "coach" : "quiz_page")
        .then(() => console.log(`Quiz result recorded: ${score}/${questions.length} from ${fromConvId ? "coach" : "quiz_page"}`))
        .catch(err => console.error("Failed to record quiz result:", err));
      setPhase("result");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0D0F1C" }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-container" />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ backgroundColor: "#0D0F1C" }}>
        <p className="text-white text-xl font-bold">No MCQs found.</p>
        <Link href={`/results/${lectureId}`} className="text-secondary underline">Back to Results</Link>
      </div>
    );
  }

  // ── End screen ──────────────────────────────────────────────────────────────
  if (phase === "result") {
    const pct = Math.round((score / questions.length) * 100);
    
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-8"
        style={{ backgroundColor: "#0D0F1C", backgroundImage: "radial-gradient(at 50% 0%, rgba(123,47,255,0.15) 0px, transparent 60%)" }}>
        <div className="grain-overlay" />
        <p className="text-xs font-bold tracking-[0.25em] uppercase text-secondary">Assessment Complete</p>
        <div className="relative">
          <div className="text-[7rem] font-black text-white leading-none">{score}</div>
          <div className="text-2xl font-bold text-on-surface-variant">/ {questions.length}</div>
        </div>
        <div className="glass-panel rounded-2xl px-8 py-4 flex flex-col gap-1 text-sm text-on-surface-variant">
          <span className="text-white font-bold text-lg">{pct}% accuracy</span>
          <span>{pct >= 70 ? "Well done — you're ready." : "Keep reviewing and try again."}</span>
        </div>
        {fromConvId && (
          <p className="text-xs text-on-surface-variant animate-pulse">
            Returning to coach in 2 seconds…
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <button
            onClick={() => { setCurrentQ(0); setSelectedLetter(null); setRevealed(false); setScore(0); setPhase("quiz"); }}
            className="flex-1 py-4 glass-panel text-white font-bold rounded-2xl hover:-translate-y-0.5 transition-transform flex items-center justify-center gap-2"
          >
            <span className="material-symbols-outlined text-sm">replay</span>
            Retake
          </button>
          <Link href={`/results/${lectureId}`}
            className="flex-1 py-4 synapse-gradient text-white font-bold rounded-2xl hover:-translate-y-0.5 transition-transform flex items-center justify-center gap-2 shadow-lg text-center">
            <span className="material-symbols-outlined text-sm">menu_book</span>
            Review
          </Link>
        </div>
        {fromConvId && (
          <Link
            href={`/coach/${fromConvId}?quiz_score=${score}&quiz_total=${questions.length}&quiz_pct=${pct}`}
            className="flex items-center gap-2 px-6 py-3 rounded-2xl text-sm font-bold text-white transition-all hover:-translate-y-0.5"
            style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}
          >
            <span className="material-symbols-outlined text-sm">smart_toy</span>
            Back to Coach with Results
          </Link>
        )}
      </div>
    );
  }

  // ── Quiz screen ──────────────────────────────────────────────────────────────
  const q = questions[currentQ];
  const progress = (currentQ / questions.length) * 100;

  return (
    <div className="relative min-h-screen flex flex-col text-on-surface select-none" style={{ backgroundColor: "#0D0F1C" }}>
      <div className="grain-overlay" />

      {/* Top progress bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-white/5 z-50">
        <div className="h-full synapse-gradient transition-all duration-500"
          style={{ width: `${progress}%`, boxShadow: "0 0 8px rgba(0,210,253,0.6)" }} />
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-40 pt-1">
        <div className="px-4 py-3 flex items-center justify-between">
          <Link href={backHref}
            className="flex items-center gap-1.5 text-on-surface-variant hover:text-white transition-colors text-sm font-bold">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            <span className="hidden sm:inline">{fromConvId ? "Back to Coach" : "Exit"}</span>
          </Link>

          {/* Timer pill — center */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-white/8 border border-white/10 backdrop-blur">
            <span className="material-symbols-outlined text-amber-400 text-base" style={{ fontVariationSettings: "'FILL' 1" }}>timer</span>
            <span className="text-white font-bold tracking-tight tabular-nums">{fmt(questionTime)}</span>
          </div>

          <span className="text-xs font-bold text-on-surface-variant">
            {currentQ + 1} <span className="text-outline-variant">/ {questions.length}</span>
          </span>
        </div>
        <p className="text-center text-[10px] font-bold tracking-[0.25em] uppercase text-secondary pb-1">
          Neural Assessment in Progress
        </p>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col pt-24 pb-36 px-5 max-w-2xl mx-auto w-full">
        {/* Question */}
        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-white leading-tight tracking-tight text-center mb-10">
            {q.question}
          </h1>

          {/* Options */}
          <div className="flex flex-col gap-3">
            {q.options.map((option, j) => {
              const letter = option.charAt(0);
              const isSelected = selectedLetter === letter;
              const isCorrect = letter === q.answer;

              let cls = "bg-white/5 border border-white/10 text-on-surface-variant hover:bg-white/10 hover:text-white cursor-pointer active:scale-[0.98]";
              if (revealed) {
                if (isCorrect) cls = "bg-emerald-500/20 border-2 border-emerald-400 text-white cursor-default";
                else if (isSelected) cls = "bg-error/20 border-2 border-error text-error cursor-default";
                else cls = "bg-white/3 border border-white/5 text-on-surface-variant/40 cursor-default";
              } else if (isSelected) {
                cls = "synapse-gradient border-0 text-white shadow-[0_4px_20px_rgba(123,47,255,0.4)] scale-[1.01]";
              }

              return (
                <button
                  key={j}
                  onClick={() => handleSelect(letter)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 flex items-center gap-4 ${cls}`}
                >
                  <span className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm
                    ${revealed && isCorrect ? "bg-emerald-400 text-black"
                      : revealed && isSelected && !isCorrect ? "bg-error text-white"
                      : !revealed && isSelected ? "bg-white/20 text-white"
                      : "bg-white/8 text-on-surface-variant"}`}>
                    {letter}
                  </span>
                  <span className="font-medium text-base leading-snug">
                    {option.replace(/^[A-D]\.\s*/, "")}
                  </span>
                  {revealed && isCorrect && (
                    <span className="material-symbols-outlined text-emerald-400 ml-auto flex-shrink-0">check_circle</span>
                  )}
                  {revealed && isSelected && !isCorrect && (
                    <span className="material-symbols-outlined text-error ml-auto flex-shrink-0">cancel</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {revealed && q.explanation && (
            <div className={`mt-5 p-4 rounded-2xl text-sm leading-relaxed border
              ${selectedLetter === q.answer
                ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-200"
                : "bg-primary/8 border-primary/20 text-primary-fixed-dim"}`}>
              <span className="font-bold">Answer {q.answer}:</span>{" "}
              {q.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
            </div>
          )}
        </div>
      </main>

      {/* Fixed bottom bar */}
      <div className="fixed bottom-0 left-0 w-full z-40 px-5 pb-8 pt-4 bg-gradient-to-t from-[#0D0F1C] via-[#0D0F1C]/90 to-transparent flex items-center justify-between gap-4 max-w-2xl mx-auto left-1/2 -translate-x-1/2 w-full">
        {!revealed ? (
          <button onClick={advance}
            className="text-on-surface-variant font-bold hover:text-white transition-colors text-sm px-4 py-3">
            Skip for now
          </button>
        ) : (
          <div />
        )}
        <button
          onClick={revealed ? advance : undefined}
          disabled={!revealed}
          className={`flex items-center gap-2 px-8 py-4 rounded-2xl font-bold text-base transition-all shadow-lg
            ${revealed
              ? "synapse-gradient text-white hover:-translate-y-0.5 shadow-[0_4px_24px_rgba(0,210,253,0.35)]"
              : "bg-white/5 text-on-surface-variant/40 cursor-default"}`}
        >
          {currentQ === questions.length - 1 ? "Finish" : "Next Question"}
          <span className="material-symbols-outlined text-base">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}
