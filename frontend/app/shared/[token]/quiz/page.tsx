"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getSharedResult } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";

interface QuizMCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

export default function SharedQuizPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [questions, setQuestions] = useState<QuizMCQ[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<"quiz" | "result">("quiz");
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [score, setScore] = useState(0);
  const [questionTime, setQuestionTime] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  // Feature 1: progress cliff
  const [showCliff, setShowCliff] = useState(false);
  const [cliffDismissed, setCliffDismissed] = useState(false);
  const pendingAdvanceRef = useRef(false);

  // Feature 6: guest retake gate
  const [guestRetakeBlocked, setGuestRetakeBlocked] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setIsLoggedIn(isAuthenticated());
  }, []);

  useEffect(() => {
    getSharedResult(token)
      .then(res => {
        setQuestions(res.data.mcqs || []);
        setTitle(res.data.lecture_title || "");
      })
      .catch(() => router.push(`/shared/${token}`))
      .finally(() => setLoading(false));
  }, [token, router]);

  // Per-question timer
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

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const handleSelect = (letter: string) => {
    if (revealed) return;
    setSelectedLetter(letter);
    setRevealed(true);
    if (letter === questions[currentQ]?.answer) setScore(s => s + 1);
  };

  const doAdvance = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ(q => q + 1);
      setSelectedLetter(null);
      setRevealed(false);
    } else {
      setPhase("result");
    }
  };

  const advance = () => {
    // Feature 1: show cliff after question 5 for guests
    if (!isLoggedIn && !cliffDismissed && currentQ === 4) {
      pendingAdvanceRef.current = true;
      setShowCliff(true);
      return;
    }
    doAdvance();
  };

  const dismissCliff = () => {
    setCliffDismissed(true);
    setShowCliff(false);
    if (pendingAdvanceRef.current) {
      pendingAdvanceRef.current = false;
      doAdvance();
    }
  };

  // Feature 6: retake with guest gate
  const handleRetake = () => {
    if (!isLoggedIn) {
      const key = `cortexq_guest_retakes_${token}`;
      const count = parseInt(localStorage.getItem(key) || "0");
      if (count >= 1) {
        setGuestRetakeBlocked(true);
        return;
      }
      localStorage.setItem(key, String(count + 1));
    }
    setCurrentQ(0);
    setSelectedLetter(null);
    setRevealed(false);
    setScore(0);
    setPhase("quiz");
    setGuestRetakeBlocked(false);
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
        <Link href={`/shared/${token}`} className="text-secondary underline">Back to Materials</Link>
      </div>
    );
  }

  // ── End screen ──────────────────────────────────────────────────────────────
  if (phase === "result") {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-6"
        style={{ backgroundColor: "#0D0F1C", backgroundImage: "radial-gradient(at 50% 0%, rgba(123,47,255,0.15) 0px, transparent 60%)" }}>
        <div className="grain-overlay" />
        <p className="text-xs font-bold tracking-[0.25em] uppercase text-secondary">Assessment Complete</p>
        <div className="relative">
          <div className="text-[7rem] font-black text-white leading-none">{score}</div>
          <div className="text-2xl font-bold text-on-surface-variant">/ {questions.length}</div>
        </div>
        {title && <p className="text-on-surface-variant text-sm max-w-xs truncate">{title}</p>}
        <div className="glass-panel rounded-2xl px-8 py-4 flex flex-col gap-1 text-sm text-on-surface-variant">
          <span className="text-white font-bold text-lg">{pct}% accuracy</span>
          <span>{pct >= 70 ? "Well done — you're ready." : "Keep reviewing and try again."}</span>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          {guestRetakeBlocked ? (
            <div className="flex-1 glass-panel rounded-2xl px-5 py-4 border border-secondary/30 text-left">
              <p className="text-white font-bold text-sm mb-1">Sign up to retake</p>
              <p className="text-on-surface-variant text-xs mb-3">Track improvement across unlimited retakes.</p>
              <Link href="/" className="block text-center synapse-gradient text-white font-bold py-2 rounded-xl text-sm hover:-translate-y-0.5 transition-transform">
                Sign up free
              </Link>
            </div>
          ) : (
            <button
              onClick={handleRetake}
              className="flex-1 py-4 glass-panel text-white font-bold rounded-2xl hover:-translate-y-0.5 transition-transform flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">replay</span>
              Retake
            </button>
          )}
          <Link href={`/shared/${token}`}
            className="flex-1 py-4 synapse-gradient text-white font-bold rounded-2xl hover:-translate-y-0.5 transition-transform flex items-center justify-center gap-2 shadow-lg text-center">
            <span className="material-symbols-outlined text-sm">menu_book</span>
            Review
          </Link>
        </div>

        {/* Feature 4: Upload CTA for guests */}
        {!isLoggedIn && (
          <div className="glass-panel rounded-2xl px-6 py-5 max-w-xs w-full text-left border border-primary/20">
            <p className="text-[10px] font-bold text-secondary uppercase tracking-widest mb-2">Want more like this?</p>
            <p className="text-white font-bold mb-1">Upload your own lecture</p>
            <p className="text-on-surface-variant text-xs mb-4 leading-relaxed">
              Generate MCQs from any PDF in 30 seconds. Free forever.
            </p>
            <Link href="/" className="block text-center synapse-gradient text-white font-bold py-2.5 rounded-xl text-sm hover:-translate-y-0.5 transition-transform">
              Try cortexQ free
            </Link>
          </div>
        )}
      </div>
    );
  }

  // ── Quiz screen ──────────────────────────────────────────────────────────────
  const q = questions[currentQ];
  const progress = (currentQ / questions.length) * 100;
  const isWrong = revealed && selectedLetter !== null && selectedLetter !== q.answer;

  return (
    <div className="relative min-h-screen flex flex-col text-on-surface select-none" style={{ backgroundColor: "#0D0F1C" }}>
      <div className="grain-overlay" />

      {/* Feature 1: Progress cliff modal */}
      {showCliff && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
          <div className="glass-panel rounded-3xl p-8 max-w-sm w-full text-center border border-primary/20 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl synapse-gradient flex items-center justify-center mx-auto mb-5">
              <span className="material-symbols-outlined text-white text-2xl">cloud_upload</span>
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Don&apos;t lose your progress</h2>
            <p className="text-on-surface-variant text-sm mb-6 leading-relaxed">
              You&apos;ve answered 5 questions. Sign up free to save your progress — or it&apos;s gone when you close this tab.
            </p>
            <Link
              href={`/auth?redirect=/shared/${token}/quiz`}
              className="block w-full py-3.5 synapse-gradient text-white font-bold rounded-xl mb-3 hover:-translate-y-0.5 transition-transform shadow-lg"
            >
              Sign up free — save progress
            </Link>
            <button
              onClick={dismissCliff}
              className="w-full py-3 glass-panel text-on-surface-variant font-bold rounded-xl text-sm hover:text-white transition-colors"
            >
              Continue without saving
            </button>
          </div>
        </div>
      )}

      {/* Top progress bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-white/5 z-50">
        <div className="h-full synapse-gradient transition-all duration-500"
          style={{ width: `${progress}%`, boxShadow: "0 0 8px rgba(0,210,253,0.6)" }} />
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-40 pt-1">
        <div className="px-4 py-3 flex items-center justify-between">
          <Link href={`/shared/${token}`}
            className="flex items-center gap-1.5 text-on-surface-variant hover:text-white transition-colors text-sm font-bold">
            <span className="material-symbols-outlined text-base">arrow_back</span>
            <span className="hidden sm:inline">Exit</span>
          </Link>

          {/* Timer pill */}
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
              ${!isWrong
                ? "bg-emerald-500/8 border-emerald-500/20 text-emerald-200"
                : "bg-primary/8 border-primary/20 text-primary-fixed-dim"}`}>
              <span className="font-bold">Answer {q.answer}:</span>{" "}
              {q.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
            </div>
          )}

          {/* Feature 3: wrong answer nudge for guests */}
          {revealed && isWrong && !isLoggedIn && (
            <div className="mt-3 flex items-center justify-between px-1">
              <span className="text-xs text-on-surface-variant/60">Track your weak spots</span>
              <Link
                href={`/auth?redirect=/shared/${token}/quiz`}
                className="text-xs font-bold text-secondary hover:text-white transition-colors flex items-center gap-1"
              >
                Sign up free
                <span className="material-symbols-outlined text-xs">arrow_forward</span>
              </Link>
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
        ) : !isLoggedIn ? (
          /* Feature 5: save to account button */
          <Link
            href={`/auth?redirect=/shared/${token}/quiz`}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl glass-panel text-on-surface-variant hover:text-white transition-colors border border-white/10"
          >
            <span className="material-symbols-outlined text-sm">cloud_upload</span>
            Save progress
          </Link>
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
