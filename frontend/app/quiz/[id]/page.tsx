"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getResults, recordQuizResult, coachGeneratePractice, FreshMCQ } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  ArrowRight,
  Timer,
  XCircle,
  RotateCcw,
  BookOpen,
  Bot,
  Check,
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
  const [sessionTime, setSessionTime] = useState(0);
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

  // Session timer — starts once, never resets between questions
  useEffect(() => {
    if (phase !== "quiz") return;
    timerRef.current = setInterval(() => setSessionTime((t) => t + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground">
        <p className="text-xl font-bold">No MCQs found.</p>
        <Link href={`/results/${lectureId}`} className="text-primary underline text-sm">
          Back to Results
        </Link>
      </div>
    );
  }

  // ── Result screen ────────────────────────────────────────────────────────────
  if (phase === "result") {
    const pct = Math.round((score / questions.length) * 100);

    return (
      <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
        {/* Header */}
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
            <Link href="/dashboard" className="text-xl font-bold text-foreground">
              cortexQ
            </Link>
            <Link
              href={backHref}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              {fromConvId ? "Back to Coach" : "Back to Results"}
            </Link>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
            <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
            <span>/</span>
            <Link href={`/results/${lectureId}`} className="hover:text-foreground transition-colors">Results</Link>
            <span>/</span>
            <span className="text-foreground">Quiz Complete</span>
          </nav>

          {/* Score */}
          <div className="flex flex-col items-center justify-center py-12 gap-6">
            <Badge variant="outline" className="text-xs font-medium tracking-wider uppercase">
              Assessment Complete
            </Badge>

            <div className="text-center">
              <div className="text-8xl font-bold text-foreground leading-none">{score}</div>
              <div className="text-2xl font-medium text-muted-foreground mt-1">/ {questions.length}</div>
            </div>

            <Card className="w-full max-w-sm">
              <CardContent className="p-6 text-center space-y-3">
                <p className="text-2xl font-bold text-foreground">{pct}%</p>
                <Progress value={pct} className="h-2" />
                <p className="text-sm text-muted-foreground">
                  {pct >= 70 ? "Well done — you're ready." : "Keep reviewing and try again."}
                </p>
              </CardContent>
            </Card>

            {fromConvId && (
              <p className="text-xs text-muted-foreground animate-pulse">Returning to coach in 2 seconds…</p>
            )}

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-sm">
              <Button
                variant="outline"
                onClick={() => {
                  setCurrentQ(0);
                  setSelectedLetter(null);
                  setRevealed(false);
                  setScore(0);
                  setPhase("quiz");
                }}
                className="flex-1"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Retake
              </Button>
              <Button asChild className="flex-1">
                <Link href={`/results/${lectureId}`}>
                  <BookOpen className="w-4 h-4 mr-2" />
                  Review
                </Link>
              </Button>
            </div>

            {fromConvId && (
              <Button variant="outline" asChild>
                <Link href={`/coach/${fromConvId}?quiz_score=${score}&quiz_total=${questions.length}&quiz_pct=${pct}`}>
                  <Bot className="w-4 h-4 mr-2" />
                  Back to Coach with Results
                </Link>
              </Button>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Quiz screen ──────────────────────────────────────────────────────────────
  const q = questions[currentQ];
  const progress = ((currentQ + (revealed ? 1 : 0)) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      {/* Header — same as results page */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="text-xl font-bold text-foreground">
            cortexQ
          </Link>

          {/* Centered timer */}
          <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
            <Timer className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-bold tabular-nums text-foreground">{fmt(sessionTime)}</span>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">
              {currentQ + 1} / {questions.length}
            </span>
            <Link
              href={backHref}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">{fromConvId ? "Back to Coach" : "Exit"}</span>
            </Link>
          </div>
        </div>
        {/* Progress bar — sits flush under the header border */}
        <Progress value={progress} className="h-0.5 rounded-none" />
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <span>/</span>
          <Link href={`/results/${lectureId}`} className="hover:text-foreground transition-colors">Results</Link>
          <span>/</span>
          <span className="text-foreground">Quiz</span>
        </nav>

        {/* Question */}
        <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-snug tracking-tight mb-8">
          {q.question}
        </h1>

        {/* Options */}
        <div className="space-y-3 mb-6">
          {q.options.map((option, j) => {
            const letter = option.charAt(0);
            const isSelected = selectedLetter === letter;
            const isCorrect = letter === q.answer;

            let cls = "border text-left transition-all";
            if (revealed) {
              if (isCorrect)
                cls += " bg-emerald-500/10 border-emerald-500/40 text-foreground";
              else if (isSelected)
                cls += " bg-destructive/10 border-destructive/40 text-foreground";
              else
                cls += " bg-muted/30 border-border text-muted-foreground";
            } else if (isSelected) {
              cls += " bg-primary/10 border-primary/60 text-foreground";
            } else {
              cls += " bg-card border-border text-foreground hover:bg-accent hover:border-accent-foreground/20 cursor-pointer";
            }

            return (
              <button
                key={j}
                onClick={() => handleSelect(letter)}
                className={`w-full p-4 rounded-xl flex items-center gap-4 ${cls}`}
              >
                <span
                  className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-sm ${
                    revealed && isCorrect
                      ? "bg-emerald-500 text-white"
                      : revealed && isSelected && !isCorrect
                      ? "bg-destructive text-white"
                      : isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {letter}
                </span>
                <span className="font-medium text-sm leading-snug flex-1">
                  {option.replace(/^[A-D]\.\s*/, "")}
                </span>
                {revealed && isCorrect && <Check className="w-4 h-4 text-emerald-500 shrink-0" />}
                {revealed && isSelected && !isCorrect && (
                  <XCircle className="w-4 h-4 text-destructive shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Explanation */}
        {revealed && q.explanation && (
          <div
            className={`p-4 rounded-xl text-sm border leading-relaxed ${
              selectedLetter === q.answer
                ? "bg-emerald-500/5 border-emerald-500/20 text-foreground"
                : "bg-primary/5 border-primary/20 text-foreground"
            }`}
          >
            <span className="font-semibold">Answer {q.answer}:</span>{" "}
            {q.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
          </div>
        )}
      </main>

      {/* Bottom bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-4">
          {!revealed ? (
            <button
              onClick={advance}
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Skip
            </button>
          ) : (
            <div />
          )}
          <Button
            onClick={revealed ? advance : undefined}
            disabled={!revealed}
            className="flex items-center gap-2 px-6"
          >
            {currentQ === questions.length - 1 ? "Finish" : "Next"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
