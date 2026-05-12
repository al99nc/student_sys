"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getDailyTest, DailyTestQuestion } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  CheckCircle2,
  XCircle,
  ArrowRight,
  Brain,
  Zap,
  BarChart3,
  BookOpen,
  RotateCcw,
  Home,
} from "lucide-react";

type AnswerState = "idle" | "correct" | "wrong";

interface QuestionResult {
  question: DailyTestQuestion;
  selected: string;
  correct: boolean;
}

export default function DailyTestPage() {
  const router = useRouter();
  const [questions, setQuestions] = useState<DailyTestQuestion[]>([]);
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Quiz state
  const [current, setCurrent] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [answerState, setAnswerState] = useState<AnswerState>("idle");
  const [results, setResults] = useState<QuestionResult[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    getDailyTest()
      .then((res) => {
        if (res?.data?.has_questions) {
          setQuestions(res.data.questions);
          setTopic(res.data.topic);
        } else {
          setError("No questions available for today. Upload and process a lecture first.");
        }
      })
      .catch(() => setError("Failed to load today's test. Please try again."))
      .finally(() => setLoading(false));
  }, [router]);

  const q = questions[current];
  const progress = questions.length > 0 ? ((current) / questions.length) * 100 : 0;
  const correctCount = results.filter((r) => r.correct).length;

  const handleSelect = (letter: string) => {
    if (answerState !== "idle") return;
    setSelected(letter);
    const isCorrect = letter === q.correct_answer;
    setAnswerState(isCorrect ? "correct" : "wrong");
  };

  const handleNext = () => {
    if (!selected) return;
    const isCorrect = selected === q.correct_answer;
    setResults((prev) => [...prev, { question: q, selected, correct: isCorrect }]);

    if (current + 1 >= questions.length) {
      setDone(true);
    } else {
      setCurrent((c) => c + 1);
      setSelected(null);
      setAnswerState("idle");
    }
  };

  const handleRestart = () => {
    setCurrent(0);
    setSelected(null);
    setAnswerState("idle");
    setResults([]);
    setDone(false);
  };

  const optionLabel = (letter: string) => {
    switch (letter) {
      case "A": return q.option_a;
      case "B": return q.option_b;
      case "C": return q.option_c;
      case "D": return q.option_d;
      default: return "";
    }
  };

  const getOptionClass = (letter: string) => {
    const base =
      "flex items-start gap-3 w-full px-4 py-3 rounded-xl border text-left transition-all duration-150 cursor-pointer";
    if (answerState === "idle") {
      return selected === letter
        ? `${base} border-primary bg-primary/10 text-foreground`
        : `${base} border-border bg-card hover:border-primary/40 hover:bg-muted/30 text-foreground`;
    }
    if (letter === q.correct_answer) {
      return `${base} border-emerald-500 bg-emerald-500/10 text-foreground`;
    }
    if (letter === selected && selected !== q.correct_answer) {
      return `${base} border-destructive bg-destructive/10 text-foreground`;
    }
    return `${base} border-border bg-card text-muted-foreground opacity-60`;
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppHeader activePage="Daily Test" />
        <main className="max-w-2xl mx-auto px-4 py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-2 bg-muted rounded-full" />
            <div className="h-32 bg-muted rounded-xl" />
            {[1,2,3,4].map(i => <div key={i} className="h-12 bg-muted rounded-xl" />)}
          </div>
        </main>
      </div>
    );
  }

  // ── Error / no questions ───────────────────────────────────────────────────
  if (error || questions.length === 0) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppHeader activePage="Daily Test" />
        <main className="max-w-2xl mx-auto px-4 py-12 flex flex-col items-center text-center gap-4">
          <BookOpen className="h-12 w-12 text-muted-foreground" />
          <h2 className="text-xl font-bold text-foreground">No test available today</h2>
          <p className="text-sm text-muted-foreground max-w-sm">
            {error || "Upload and process at least one lecture so the AI can build your daily test."}
          </p>
          <Button asChild>
            <Link href="/upload" prefetch={false}>Upload a Lecture</Link>
          </Button>
        </main>
      </div>
    );
  }

  // ── Results screen ─────────────────────────────────────────────────────────
  if (done) {
    const accuracy = Math.round((correctCount / questions.length) * 100);
    const isPassing = accuracy >= 70;
    return (
      <div className="min-h-screen bg-background text-foreground pb-20">
        <AppHeader activePage="Daily Test" />
        <style>{`
          @keyframes flicker {
            0%,100% { transform: scale(1) rotate(-2deg); filter: brightness(1); }
            33%      { transform: scale(1.12) rotate(2deg); filter: brightness(1.2); }
            66%      { transform: scale(0.94) rotate(-1deg); filter: brightness(0.88); }
          }
          @keyframes rise {
            0%,100% { transform: translateY(0) scale(1); opacity: 1; }
            50%      { transform: translateY(-7px) scale(1.06); opacity: 0.8; }
          }
          @keyframes streak-glow {
            0%,100% { box-shadow: 0 0 14px 4px rgba(249,115,22,0.25); }
            50%      { box-shadow: 0 0 28px 10px rgba(249,115,22,0.45); }
          }
          .flame-center { animation: flicker 1.3s ease-in-out infinite; display:inline-block; }
          .flame-left   { animation: rise 1.7s ease-in-out infinite; display:inline-block; }
          .flame-right  { animation: rise 2.0s ease-in-out infinite; display:inline-block; }
          .streak-badge { animation: streak-glow 2.4s ease-in-out infinite; }
        `}</style>
        <main className="max-w-2xl mx-auto px-4 py-10">

          {/* Fire streak header */}
          <div className="text-center mb-7">
            <div className="flex items-end justify-center gap-0.5 mb-3">
              <span className="flame-left text-4xl" style={{ animationDelay: "0.4s" }}>🔥</span>
              <span className="flame-center text-6xl leading-none">🔥</span>
              <span className="flame-right text-4xl" style={{ animationDelay: "0.8s" }}>🔥</span>
            </div>
            <div className="streak-badge inline-flex items-center gap-2 bg-orange-500/10 border border-orange-500/30 rounded-full px-5 py-1.5 mb-5">
              <span className="text-orange-400 font-bold text-xs tracking-widest uppercase">Daily Streak</span>
            </div>

            {/* Score ring */}
            <div className="relative inline-flex items-center justify-center mb-4">
              <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
                <circle cx="56" cy="56" r="46" fill="none" stroke="hsl(var(--border))" strokeWidth="8" />
                <circle
                  cx="56" cy="56" r="46" fill="none"
                  stroke={isPassing ? "rgb(34 197 94)" : "hsl(var(--primary))"}
                  strokeWidth="8"
                  strokeDasharray={`${2 * Math.PI * 46}`}
                  strokeDashoffset={`${2 * Math.PI * 46 * (1 - accuracy / 100)}`}
                  strokeLinecap="round"
                  className="transition-all duration-700"
                />
              </svg>
              <div className="absolute flex flex-col items-center">
                <span className="text-3xl font-bold text-foreground">{accuracy}%</span>
                <span className="text-xs text-muted-foreground">accuracy</span>
              </div>
            </div>

            <h2 className="text-2xl font-bold text-foreground mb-1">
              {accuracy === 100 ? "Perfect!" : isPassing ? "Well done!" : "Keep going!"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {correctCount} of {questions.length} correct · Topic: {topic}
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-3 gap-3 mb-8">
            {[
              { label: "Correct", value: correctCount, color: "text-emerald-500" },
              { label: "Wrong", value: questions.length - correctCount, color: "text-destructive" },
              { label: "Total", value: questions.length, color: "text-foreground" },
            ].map((s) => (
              <Card key={s.label}>
                <CardContent className="p-4 text-center">
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-xs text-muted-foreground mt-1">{s.label}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Review breakdown */}
          <Card className="mb-6">
            <CardContent className="p-5">
              <p className="text-sm font-semibold text-foreground mb-3">Question Review</p>
              <div className="space-y-3">
                {results.map((r, i) => (
                  <div key={i} className="flex items-start gap-3">
                    {r.correct
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                      : <XCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground line-clamp-2">{r.question.question_text}</p>
                      {!r.correct && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Correct: <span className="font-semibold text-emerald-500">{r.question.correct_answer}</span>
                          {" · "}
                          {r.question.correct_answer === "A" ? r.question.option_a
                            : r.question.correct_answer === "B" ? r.question.option_b
                            : r.question.correct_answer === "C" ? r.question.option_c
                            : r.question.option_d}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={handleRestart}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Retake
            </Button>
            <Button className="flex-1" asChild>
              <Link href="/dashboard" prefetch={false}>
                <Home className="h-4 w-4 mr-2" />
                Dashboard
              </Link>
            </Button>
            <Button variant="outline" className="flex-1" asChild>
              <Link href="/analytics" prefetch={false}>
                <BarChart3 className="h-4 w-4 mr-2" />
                Analytics
              </Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // ── Quiz screen ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <AppHeader activePage="Daily Test" />

      <main className="max-w-2xl mx-auto px-4 py-6">

        {/* Progress header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-xs font-bold uppercase tracking-wide text-primary">Daily Test</span>
              <Badge variant="secondary" className="text-[10px]">{topic}</Badge>
            </div>
            <span className="text-xs text-muted-foreground font-medium">
              {current + 1} / {questions.length}
            </span>
          </div>
          <Progress value={progress} className="h-1.5" />
        </div>

        {/* Question card */}
        <Card className="mb-4">
          <CardContent className="p-6">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className="text-[10px] px-2">
                <Zap className="h-2.5 w-2.5 mr-1 text-primary" />
                {q.topic}
              </Badge>
              <Badge variant="secondary" className="text-[10px] px-2 capitalize">
                {q.difficulty_type}
              </Badge>
            </div>
            <p className="text-base sm:text-lg font-semibold text-foreground leading-snug">
              {q.question_text}
            </p>
          </CardContent>
        </Card>

        {/* Options */}
        <div className="space-y-2.5 mb-5">
          {(["A", "B", "C", "D"] as const).map((letter) => (
            <button
              key={letter}
              onClick={() => handleSelect(letter)}
              disabled={answerState !== "idle"}
              className={getOptionClass(letter)}
            >
              <span className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold bg-muted text-muted-foreground flex-shrink-0 mt-0.5">
                {letter}
              </span>
              <span className="text-sm leading-snug">{optionLabel(letter)}</span>
              {answerState !== "idle" && letter === q.correct_answer && (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto flex-shrink-0 mt-0.5" />
              )}
              {answerState !== "idle" && letter === selected && selected !== q.correct_answer && (
                <XCircle className="h-4 w-4 text-destructive ml-auto flex-shrink-0 mt-0.5" />
              )}
            </button>
          ))}
        </div>

        {/* Explanation (shown after answering) */}
        {answerState !== "idle" && (
          <Card className={`mb-5 border ${answerState === "correct" ? "border-emerald-500/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                {answerState === "correct"
                  ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                  : <XCircle className="h-4 w-4 text-destructive" />}
                <span className="text-sm font-semibold text-foreground">
                  {answerState === "correct" ? "Correct!" : `Wrong — the answer is ${q.correct_answer}`}
                </span>
              </div>
              {q.explanation && (
                <p className="text-sm text-muted-foreground leading-relaxed">{q.explanation}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Next button */}
        {answerState !== "idle" && (
          <Button className="w-full" onClick={handleNext}>
            {current + 1 >= questions.length ? "See Results" : "Next Question"}
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        )}
      </main>
    </div>
  );
}
