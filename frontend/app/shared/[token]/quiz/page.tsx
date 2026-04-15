"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getSharedResult } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  ArrowLeft,
  ArrowRight,
  Timer,
  CheckCircle2,
  XCircle,
  RotateCcw,
  BookOpen,
  CloudUpload,
  CloudOff
} from "lucide-react";

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
  const [showCliff, setShowCliff] = useState(false);
  const [cliffDismissed, setCliffDismissed] = useState(false);
  const [guestRetakeBlocked, setGuestRetakeBlocked] = useState(false);

  const pendingAdvanceRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setIsLoggedIn(isAuthenticated());
  }, []);

  useEffect(() => {
    getSharedResult(token)
      .then((res) => {
        setQuestions(res.data.mcqs || []);
        setTitle(res.data.lecture_title || "");
      })
      .catch(() => router.push(`/shared/${token}`))
      .finally(() => setLoading(false));
  }, [token, router]);

  useEffect(() => {
    setQuestionTime(0);
    if (timerRef.current) clearInterval(timerRef.current);
    if (phase !== "quiz") return;
    timerRef.current = setInterval(() => setQuestionTime((t) => t + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
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
    if (letter === questions[currentQ]?.answer) setScore((s) => s + 1);
  };

  const doAdvance = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedLetter(null);
      setRevealed(false);
    } else {
      setPhase("result");
    }
  };

  const advance = () => {
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
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background">
        <p className="text-foreground text-xl font-bold">No MCQs found.</p>
        <Link href={`/shared/${token}`} className="text-cyan-400 underline">
          Back to Materials
        </Link>
      </div>
    );
  }

  // Result screen
  if (phase === "result") {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-6 bg-background"
        style={{ backgroundImage: "radial-gradient(at 50% 0%, rgba(123,47,255,0.15) 0px, transparent 60%)" }}
      >
        <div className="grain-overlay" />
        <p className="text-xs font-bold tracking-[0.25em] uppercase text-cyan-400">Assessment Complete</p>
        <div className="relative">
          <div className="text-[7rem] font-black text-foreground leading-none">{score}</div>
          <div className="text-2xl font-bold text-muted-foreground">/ {questions.length}</div>
        </div>
        {title && <p className="text-muted-foreground text-sm max-w-xs truncate">{title}</p>}
        <Card className="glass-panel border-border/50">
          <CardContent className="px-8 py-4 flex flex-col gap-1 text-sm text-muted-foreground">
            <span className="text-foreground font-bold text-lg">{pct}% accuracy</span>
            <span>{pct >= 70 ? "Well done — you're ready." : "Keep reviewing and try again."}</span>
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          {guestRetakeBlocked ? (
            <Card className="flex-1 glass-panel border-cyan-500/30 text-left">
              <CardContent className="p-5">
                <p className="text-foreground font-bold text-sm mb-1">Sign up to retake</p>
                <p className="text-muted-foreground text-xs mb-3">Track improvement across unlimited retakes.</p>
                <Button asChild className="w-full synapse-gradient text-white rounded-xl text-sm">
                  <Link href="/">Sign up free</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Button variant="outline" onClick={handleRetake} className="flex-1 py-6 rounded-2xl">
              <RotateCcw className="w-4 h-4 mr-2" />
              Retake
            </Button>
          )}
          <Button asChild className="flex-1 py-6 synapse-gradient text-white rounded-2xl">
            <Link href={`/shared/${token}`}>
              <BookOpen className="w-4 h-4 mr-2" />
              Review
            </Link>
          </Button>
        </div>

        {/* Guest CTA */}
        {!isLoggedIn && (
          <Card className="glass-panel border-primary/20 max-w-xs w-full text-left">
            <CardContent className="p-6">
              <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest mb-2">Want more like this?</p>
              <p className="text-foreground font-bold mb-1">Upload your own lecture</p>
              <p className="text-muted-foreground text-xs mb-4 leading-relaxed">
                Generate MCQs from any PDF in 30 seconds. Free forever.
              </p>
              <Button asChild className="w-full synapse-gradient text-white rounded-xl text-sm">
                <Link href="/">Try cortexQ free</Link>
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  // Quiz screen
  const q = questions[currentQ];
  const progress = (currentQ / questions.length) * 100;
  const isWrong = revealed && selectedLetter !== null && selectedLetter !== q.answer;

  return (
    <div className="relative min-h-screen flex flex-col bg-background text-foreground select-none">
      <div className="grain-overlay" />

      {/* Cliff modal */}
      {showCliff && (
        <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center px-4 pb-4 sm:pb-0">
          <Card className="glass-panel border-primary/20 max-w-sm w-full text-center">
            <CardContent className="p-8">
              <div className="w-14 h-14 rounded-2xl synapse-gradient flex items-center justify-center mx-auto mb-5">
                <CloudUpload className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-xl font-bold text-foreground mb-2">{"Don't lose your progress"}</h2>
              <p className="text-muted-foreground text-sm mb-6 leading-relaxed">
                {"You've answered 5 questions. Sign up free to save your progress — or it's gone when you close this tab."}
              </p>
              <Button asChild className="w-full synapse-gradient text-white rounded-xl mb-3">
                <Link href={`/auth?redirect=/shared/${token}/quiz`}>Sign up free — save progress</Link>
              </Button>
              <Button variant="ghost" onClick={dismissCliff} className="w-full rounded-xl text-muted-foreground">
                Continue without saving
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Progress bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-muted z-50">
        <div
          className="h-full synapse-gradient transition-all duration-500"
          style={{ width: `${progress}%`, boxShadow: "0 0 8px rgba(0,210,253,0.6)" }}
        />
      </div>

      {/* Header */}
      <header className="fixed top-0 left-0 w-full z-40 pt-1">
        <div className="px-4 py-3 flex items-center justify-between">
          <Link
            href={`/shared/${token}`}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Exit</span>
          </Link>

          {/* Timer pill */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-4 py-2 rounded-full bg-muted/50 border border-border/50 backdrop-blur">
            <Timer className="w-4 h-4 text-yellow-400" />
            <span className="text-foreground font-bold tracking-tight tabular-nums">{fmt(questionTime)}</span>
          </div>

          <span className="text-xs font-bold text-muted-foreground">
            {currentQ + 1} <span className="text-muted-foreground/50">/ {questions.length}</span>
          </span>
        </div>
        <p className="text-center text-[10px] font-bold tracking-[0.25em] uppercase text-cyan-400 pb-1">
          Neural Assessment in Progress
        </p>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col pt-24 pb-36 px-5 max-w-2xl mx-auto w-full">
        <div className="flex-1 flex flex-col justify-center">
          <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-foreground leading-tight tracking-tight text-center mb-10">
            {q.question}
          </h1>

          {/* Options */}
          <div className="flex flex-col gap-3">
            {q.options.map((option, j) => {
              const letter = option.charAt(0);
              const isSelected = selectedLetter === letter;
              const isCorrect = letter === q.answer;

              let cls =
                "bg-muted/50 border border-border/50 text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer active:scale-[0.98]";
              if (revealed) {
                if (isCorrect)
                  cls = "bg-emerald-500/20 border-2 border-emerald-400 text-foreground cursor-default";
                else if (isSelected)
                  cls = "bg-destructive/20 border-2 border-destructive text-destructive cursor-default";
                else cls = "bg-muted/30 border border-border/30 text-muted-foreground/40 cursor-default";
              } else if (isSelected) {
                cls = "synapse-gradient border-0 text-white shadow-[0_4px_20px_rgba(123,47,255,0.4)] scale-[1.01]";
              }

              return (
                <button
                  key={j}
                  onClick={() => handleSelect(letter)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all duration-200 flex items-center gap-4 ${cls}`}
                >
                  <span
                    className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 font-bold text-sm ${
                      revealed && isCorrect
                        ? "bg-emerald-400 text-black"
                        : revealed && isSelected && !isCorrect
                        ? "bg-destructive text-white"
                        : !revealed && isSelected
                        ? "bg-white/20 text-white"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {letter}
                  </span>
                  <span className="font-medium text-base leading-snug">{option.replace(/^[A-D]\.\s*/, "")}</span>
                  {revealed && isCorrect && <CheckCircle2 className="w-5 h-5 text-emerald-400 ml-auto flex-shrink-0" />}
                  {revealed && isSelected && !isCorrect && (
                    <XCircle className="w-5 h-5 text-destructive ml-auto flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Explanation */}
          {revealed && q.explanation && (
            <div
              className={`mt-5 p-4 rounded-2xl text-sm leading-relaxed border ${
                !isWrong
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : "bg-primary/10 border-primary/20 text-primary"
              }`}
            >
              <span className="font-bold">Answer {q.answer}:</span>{" "}
              {q.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
            </div>
          )}

          {/* Wrong answer nudge for guests */}
          {revealed && isWrong && !isLoggedIn && (
            <div className="mt-3 flex items-center justify-between px-1">
              <span className="text-xs text-muted-foreground/60">Track your weak spots</span>
              <Link
                href={`/auth?redirect=/shared/${token}/quiz`}
                className="text-xs font-bold text-cyan-400 hover:text-foreground transition-colors flex items-center gap-1"
              >
                Sign up free
                <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>
      </main>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 w-full z-40 px-5 pb-8 pt-4 bg-gradient-to-t from-background via-background/90 to-transparent flex items-center justify-between gap-4 max-w-2xl mx-auto left-1/2 -translate-x-1/2 w-full">
        {!revealed ? (
          <button onClick={advance} className="text-muted-foreground font-bold hover:text-foreground transition-colors text-sm px-4 py-3">
            Skip for now
          </button>
        ) : !isLoggedIn ? (
          <Link
            href={`/auth?redirect=/shared/${token}/quiz`}
            className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl glass-panel text-muted-foreground hover:text-foreground transition-colors border border-border/50"
          >
            <CloudUpload className="w-4 h-4" />
            Save progress
          </Link>
        ) : (
          <div />
        )}

        <Button
          onClick={revealed ? advance : undefined}
          disabled={!revealed}
          className={`flex items-center gap-2 px-8 py-6 rounded-2xl font-bold text-base transition-all shadow-lg ${
            revealed
              ? "synapse-gradient text-white hover:-translate-y-0.5 shadow-[0_4px_24px_rgba(0,210,253,0.35)]"
              : "bg-muted text-muted-foreground/40 cursor-default"
          }`}
        >
          {currentQ === questions.length - 1 ? "Finish" : "Next Question"}
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
