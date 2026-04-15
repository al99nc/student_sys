"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getResults, recordQuizResult, coachGeneratePractice, FreshMCQ } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  Timer,
  CheckCircle2,
  XCircle,
  RotateCcw,
  BookOpen,
  Bot
} from "lucide-react";

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
  const freshMode = searchParams.get("fresh") === "true";
  const freshTopic = searchParams.get("topic") ?? "";
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
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }

    if (freshMode && freshTopic) {
      const count = questionLimit ?? 5;
      coachGeneratePractice(freshTopic, count)
        .then((res) => {
          const qs: QuizMCQ[] = (res.data.questions as FreshMCQ[]).map((q) => ({
            question: q.question,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
            topic: q.topic ?? freshTopic,
          }));
          setQuestions(qs);
        })
        .catch(() => {
          getResults(lectureId)
            .then((res) => {
              const all: QuizMCQ[] = res.data.mcqs || [];
              setQuestions(questionLimit ? all.slice(0, questionLimit) : all);
            })
            .catch(() => router.push(`/results/${lectureId}`));
        })
        .finally(() => setLoading(false));
    } else {
      getResults(lectureId)
        .then((res) => {
          const all: QuizMCQ[] = res.data.mcqs || [];
          setQuestions(questionLimit ? all.slice(0, questionLimit) : all);
        })
        .catch(() => router.push(`/results/${lectureId}`))
        .finally(() => setLoading(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lectureId, router, freshMode, freshTopic]);

  // Per-question timer
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

  // Auto-redirect to coach
  useEffect(() => {
    if (phase === "result" && fromConvId) {
      const timer = setTimeout(() => {
        const pct = Math.round((score / questions.length) * 100);
        const topicParam = freshTopic ? `&quiz_topic=${encodeURIComponent(freshTopic)}` : "";
        router.push(`/coach/${fromConvId}?quiz_score=${score}&quiz_total=${questions.length}&quiz_pct=${pct}${topicParam}`);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [phase, fromConvId, score, questions.length, router, freshTopic]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const handleSelect = (letter: string) => {
    if (revealed) return;
    setSelectedLetter(letter);
    setRevealed(true);
    if (letter === questions[currentQ]?.answer) setScore((s) => s + 1);
  };

  const advance = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedLetter(null);
      setRevealed(false);
    } else {
      recordQuizResult(lectureId, score, questions.length, fromConvId ? "coach" : "quiz_page").catch(() => {});
      setPhase("result");
    }
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
        <Link href={`/results/${lectureId}`} className="text-cyan-400 underline">
          Back to Results
        </Link>
      </div>
    );
  }

  // Result screen
  if (phase === "result") {
    const pct = Math.round((score / questions.length) * 100);

    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center px-6 text-center gap-8 bg-background"
        style={{ backgroundImage: "radial-gradient(at 50% 0%, rgba(123,47,255,0.15) 0px, transparent 60%)" }}
      >
        <div className="grain-overlay" />
        <p className="text-xs font-bold tracking-[0.25em] uppercase text-cyan-400">Assessment Complete</p>
        <div className="relative">
          <div className="text-[7rem] font-black text-foreground leading-none">{score}</div>
          <div className="text-2xl font-bold text-muted-foreground">/ {questions.length}</div>
        </div>
        <Card className="glass-panel border-border/50">
          <CardContent className="px-8 py-4 flex flex-col gap-1 text-sm text-muted-foreground">
            <span className="text-foreground font-bold text-lg">{pct}% accuracy</span>
            <span>{pct >= 70 ? "Well done — you're ready." : "Keep reviewing and try again."}</span>
          </CardContent>
        </Card>
        {fromConvId && (
          <p className="text-xs text-muted-foreground animate-pulse">Returning to coach in 2 seconds...</p>
        )}
        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
          <Button
            variant="outline"
            onClick={() => {
              setCurrentQ(0);
              setSelectedLetter(null);
              setRevealed(false);
              setScore(0);
              setPhase("quiz");
            }}
            className="flex-1 py-6 rounded-2xl"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Retake
          </Button>
          <Button asChild className="flex-1 py-6 synapse-gradient text-white rounded-2xl">
            <Link href={`/results/${lectureId}`}>
              <BookOpen className="w-4 h-4 mr-2" />
              Review
            </Link>
          </Button>
        </div>
        {fromConvId && (
          <Button asChild className="synapse-gradient text-white rounded-2xl">
            <Link href={`/coach/${fromConvId}?quiz_score=${score}&quiz_total=${questions.length}&quiz_pct=${pct}`}>
              <Bot className="w-4 h-4 mr-2" />
              Back to Coach with Results
            </Link>
          </Button>
        )}
      </div>
    );
  }

  // Quiz screen
  const q = questions[currentQ];
  const progress = (currentQ / questions.length) * 100;

  return (
    <div className="relative min-h-screen flex flex-col bg-background text-foreground select-none">
      <div className="grain-overlay" />

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
            href={backHref}
            className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">{fromConvId ? "Back to Coach" : "Exit"}</span>
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
                selectedLetter === q.answer
                  ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-300"
                  : "bg-primary/10 border-primary/20 text-primary"
              }`}
            >
              <span className="font-bold">Answer {q.answer}:</span>{" "}
              {q.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
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
