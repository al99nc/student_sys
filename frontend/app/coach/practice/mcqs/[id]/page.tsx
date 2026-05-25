"use client";
import { useState, useEffect, useRef } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { coachGeneratePracticeMCQs, FreshMCQ } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import {
  ArrowLeft,
  ArrowRight,
  Timer,
  XCircle,
  CheckCircle2,
  Brain,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface QuizMCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

export default function CoachPracticeMCQPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = params.id as string;
  const topicParam = searchParams.get("topic");
  const countParam = searchParams.get("count");
  const count = countParam ? parseInt(countParam) : 5;

  const [questions, setQuestions] = useState<QuizMCQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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

    if (topicParam && conversationId) {
      coachGeneratePracticeMCQs(conversationId, topicParam, count)
        .then((res) => {
          const qs: QuizMCQ[] = (res.data.questions as FreshMCQ[]).map((q) => ({
            question: q.question,
            options: q.options,
            answer: q.answer,
            explanation: q.explanation,
            topic: q.topic ?? topicParam,
          }));
          setQuestions(qs);
        })
        .catch((err) => {
          console.error("Failed to generate MCQs:", err);
          setError("Failed to generate questions. Please try again.");
        })
        .finally(() => setLoading(false));
    } else {
      setError("No topic specified.");
      setLoading(false);
    }
  }, [topicParam, count, router]);

  useEffect(() => {
    if (phase !== "quiz") return;
    timerRef.current = setInterval(() => setSessionTime((t) => t + 1), 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase]);

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

  const advance = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedLetter(null);
      setRevealed(false);
    } else {
      setPhase("result");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground animate-pulse">
        <div className="max-w-2xl mx-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-4 w-24 mb-2" />
          <Skeleton className="h-16 w-full rounded-xl mb-6" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error || questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground p-4">
        <Brain className="w-12 h-12 text-muted-foreground" />
        <p className="text-xl font-bold">{error || "No questions generated."}</p>
        <Link href={`/coach/${conversationId}`} className="text-primary underline text-sm">
          Back to Coach
        </Link>
      </div>
    );
  }

  if (phase === "result") {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
        <div className="max-w-2xl mx-auto p-4 pt-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">
              {pct >= 80 ? "Excellent!" : pct >= 55 ? "Good work!" : "Keep practicing!"}
            </h1>
            <p className="text-muted-foreground">{score}/{questions.length} correct ({pct}%)</p>
            <p className="text-sm text-muted-foreground mt-2">Time: {fmt(sessionTime)}</p>
          </div>

          <div className="flex gap-2 justify-center">
            <Link
              href={`/coach/${conversationId}?quiz_score=${score}&quiz_total=${questions.length}&quiz_pct=${pct}`}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium"
            >
              <Brain className="w-4 h-4" />
              Back to Coach
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const q = questions[currentQ];
  const letters = ["A", "B", "C", "D"];

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <Link href={`/coach/${conversationId}`} className="p-2 -ml-2">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Timer className="w-4 h-4" />
            {fmt(sessionTime)}
          </div>
          <div className="text-sm font-medium">
            {currentQ + 1}/{questions.length}
          </div>
        </div>

        {q.topic && (
          <div className="text-xs text-primary mb-2 uppercase tracking-wide">
            {q.topic}
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-lg font-semibold leading-relaxed">{q.question}</h2>
        </div>

        <div className="space-y-3">
          {letters.map((letter, i) => {
            const isSelected = selectedLetter === letter;
            const isCorrect = q.answer === letter;
            const showCorrect = revealed && isCorrect;
            const showWrong = revealed && isSelected && !isCorrect;

            return (
              <button
                key={letter}
                onClick={() => handleSelect(letter)}
                disabled={revealed}
                className={`w-full flex items-center gap-3 p-4 rounded-xl border transition-all text-left ${
                  showCorrect
                    ? "border-green-500 bg-green-500/10"
                    : showWrong
                    ? "border-red-500 bg-red-500/10"
                    : isSelected
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <span
                  className={`w-8 h-8 flex items-center justify-center rounded-lg font-bold text-sm ${
                    showCorrect
                      ? "bg-green-500 text-white"
                      : showWrong
                      ? "bg-red-500 text-white"
                      : isSelected
                      ? "bg-primary text-white"
                      : "bg-muted"
                  }`}
                >
                  {showCorrect ? (
                    <CheckCircle2 className="w-5 h-5" />
                  ) : showWrong ? (
                    <XCircle className="w-5 h-5" />
                  ) : (
                    letter
                  )}
                </span>
                <span className="flex-1">{q.options[i]}</span>
              </button>
            );
          })}
        </div>

        {revealed && q.explanation && (
          <div className="mt-4 p-4 rounded-xl bg-muted/50 border border-border">
            <p className="text-sm text-muted-foreground">{q.explanation}</p>
          </div>
        )}

        <button
          onClick={advance}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/25"
        >
          {currentQ < questions.length - 1 ? (
            <>
              Next <ArrowRight className="w-4 h-4" />
            </>
          ) : (
            <>
              See Results <CheckCircle2 className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
