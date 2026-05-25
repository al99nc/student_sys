"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { coachGeneratePracticeEssays, EssayQuestion, EssayGradeResult } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-400";
  if (score >= 55) return "text-yellow-400";
  return "text-red-400";
}

function scoreBg(score: number) {
  if (score >= 80) return "bg-emerald-500/15 border-emerald-500/30";
  if (score >= 55) return "bg-yellow-500/15 border-yellow-500/30";
  return "bg-red-500/15 border-red-500/30";
}

export default function CoachPracticeEssayPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversationId = params.id as string;
  const topicParam = searchParams.get("topic");
  const countParam = searchParams.get("count");
  const count = countParam ? parseInt(countParam) : 3;

  const [questions, setQuestions] = useState<EssayQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(0);
  const [answer, setAnswer] = useState("");
  const [grading, setGrading] = useState(false);
  const [gradedAnswers, setGradedAnswers] = useState<(EssayGradeResult | null)[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }

    if (topicParam && conversationId) {
      coachGeneratePracticeEssays(conversationId, topicParam, count)
        .then((res) => {
          setQuestions(res.data.questions || []);
          setGradedAnswers(new Array((res.data.questions || []).length).fill(null));
        })
        .catch((err) => {
          console.error("Failed to generate essays:", err);
          setError("Failed to generate essay questions. Please try again.");
        })
        .finally(() => setLoading(false));
    } else {
      setError("No topic specified.");
      setLoading(false);
    }
  }, [topicParam, count, router]);

  const handleNext = () => {
    if (current < questions.length - 1) {
      setCurrent((c) => c + 1);
      setAnswer("");
    } else {
      setDone(true);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground animate-pulse">
        <div className="max-w-2xl mx-auto p-4">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-9 w-9 rounded-lg" />
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="mb-6 space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="w-full h-40 rounded-xl" />
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2">
            <Skeleton className="h-12 w-40 rounded-full" />
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

  if (done) {
    const avgScore = gradedAnswers.filter(Boolean).reduce((sum, g) => sum + (g?.score ?? 0), 0) / gradedAnswers.filter(Boolean).length;
    return (
      <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
        <div className="max-w-2xl mx-auto p-4 pt-8">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold mb-4">Practice Complete!</h1>
            {gradedAnswers.some(Boolean) ? (
              <div className={`text-4xl font-bold ${scoreColor(avgScore)} mb-2`}>
                {Math.round(avgScore)}%
              </div>
            ) : (
              <p className="text-muted-foreground">No grades available yet.</p>
            )}
          </div>

          <div className="flex gap-2 justify-center">
            <Link
              href={`/coach/${conversationId}`}
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

  const q = questions[current];

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      <div className="max-w-2xl mx-auto p-4">
        <div className="flex items-center justify-between mb-4">
          <Link href={`/coach/${conversationId}`} className="p-2 -ml-2">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="text-sm font-medium">
            {current + 1}/{questions.length}
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-lg font-semibold">{q.question}</h2>
          <p className="text-sm text-muted-foreground mt-2">
            Write 2-4 sentences answering this question.
          </p>
        </div>

        <textarea
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Type your answer here..."
          className="w-full h-40 p-4 rounded-xl border border-border bg-card resize-none focus:border-primary focus:ring-1 focus:ring-primary"
        />

        <button
          onClick={handleNext}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 px-6 py-3 rounded-full bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/25"
        >
          {current < questions.length - 1 ? (
            <>
              Next Question <ArrowRight className="w-4 h-4" />
            </>
          ) : (
            <>
              Finish <CheckCircle2 className="w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
