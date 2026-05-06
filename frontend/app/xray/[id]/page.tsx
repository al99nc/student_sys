"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getXrayQuestions, XrayQuestion } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, ArrowRight, CheckCircle2, XCircle, BookOpen, Brain } from "lucide-react";

interface TopicResult {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
}

export default function XrayPage() {
  const params = useParams();
  const router = useRouter();
  const lectureId = parseInt(params.id as string);

  const [questions, setQuestions] = useState<XrayQuestion[]>([]);
  const [topicCount, setTopicCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Quiz state
  const [phase, setPhase] = useState<"intro" | "quiz" | "results">("intro");
  const [currentQ, setCurrentQ] = useState(0);
  const [selectedLetter, setSelectedLetter] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    getXrayQuestions(lectureId)
      .then((res) => {
        setQuestions(res.data.questions);
        setTopicCount(res.data.topic_count);
      })
      .catch(() => setError("No questions available. Process this lecture first."))
      .finally(() => setLoading(false));
  }, [lectureId, router]);

  const handleSelect = (letter: string) => {
    if (revealed) return;
    setSelectedLetter(letter);
    setRevealed(true);
    setAnswers((prev) => ({ ...prev, [currentQ]: letter }));
  };

  const advance = () => {
    if (currentQ < questions.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedLetter(null);
      setRevealed(false);
    } else {
      setPhase("results");
    }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error || questions.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-background text-foreground px-4">
        <Brain className="h-12 w-12 text-muted-foreground" />
        <p className="text-lg font-bold">{error || "No questions found"}</p>
        <Link href={`/results/${lectureId}`} className="text-primary underline text-sm">
          Back to Results
        </Link>
      </div>
    );
  }

  // ── Intro ────────────────────────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
          <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
            <Link href="/dashboard" className="text-xl font-bold text-foreground">cortexQ</Link>
            <Link href={`/results/${lectureId}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
          </div>
        </header>
        <main className="max-w-xl mx-auto px-4 py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-6">
            <Brain className="w-8 h-8 text-primary" />
          </div>
          <Badge variant="outline" className="mb-4 text-xs tracking-wider uppercase">Knowledge X-Ray</Badge>
          <h1 className="text-3xl font-bold text-foreground mb-3">What do you already know?</h1>
          <p className="text-muted-foreground mb-8 leading-relaxed">
            {questions.length} quick questions — one per topic. CortexQ will map exactly
            what you know and what you don&apos;t before you spend a single minute studying.
          </p>
          <div className="flex gap-3 justify-center flex-wrap text-sm text-muted-foreground mb-8">
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border">
              {questions.length} questions
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border">
              {topicCount} topics mapped
            </span>
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted/50 border border-border">
              ~{questions.length * 30}s total
            </span>
          </div>
          <Button size="lg" onClick={() => setPhase("quiz")} className="px-8">
            Start X-Ray
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </main>
      </div>
    );
  }

  // ── Results ──────────────────────────────────────────────────────────────────
  if (phase === "results") {
    const topicResults: TopicResult[] = [];
    const topicMap: Record<string, { correct: number; total: number }> = {};

    questions.forEach((q, i) => {
      const chosen = answers[i];
      if (!topicMap[q.topic]) topicMap[q.topic] = { correct: 0, total: 0 };
      topicMap[q.topic].total += 1;
      if (chosen === q.answer) topicMap[q.topic].correct += 1;
    });

    for (const [topic, data] of Object.entries(topicMap)) {
      topicResults.push({
        topic,
        ...data,
        accuracy: data.total > 0 ? Math.round((data.correct / data.total) * 100) : 0,
      });
    }

    topicResults.sort((a, b) => a.accuracy - b.accuracy);

    const weak = topicResults.filter((t) => t.accuracy < 60);
    const ok = topicResults.filter((t) => t.accuracy >= 60 && t.accuracy < 85);
    const strong = topicResults.filter((t) => t.accuracy >= 85);
    const overallCorrect = Object.values(answers).filter((ans, i) => ans === questions[i]?.answer).length;

    return (
      <div className="min-h-screen bg-background text-foreground pb-24">
        <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
          <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
            <Link href="/dashboard" className="text-xl font-bold text-foreground">cortexQ</Link>
            <Link href={`/results/${lectureId}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" /> Back to Results
            </Link>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
          <div className="text-center mb-8">
            <Badge variant="outline" className="mb-3 text-xs tracking-wider uppercase">X-Ray Complete</Badge>
            <h1 className="text-2xl font-bold text-foreground mb-2">Your Knowledge Map</h1>
            <p className="text-sm text-muted-foreground">
              {overallCorrect}/{questions.length} correct across {topicResults.length} topics
            </p>
          </div>

          {/* Summary bar */}
          <Card className="mb-6">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-muted-foreground">Overall baseline</span>
                <span className="text-sm font-bold text-foreground">
                  {Math.round((overallCorrect / questions.length) * 100)}%
                </span>
              </div>
              <Progress value={Math.round((overallCorrect / questions.length) * 100)} className="h-2 mb-4" />
              <div className="grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-lg bg-destructive/10 border border-destructive/20 py-2">
                  <p className="text-base font-bold text-destructive">{weak.length}</p>
                  <p className="text-muted-foreground">Need work</p>
                </div>
                <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 py-2">
                  <p className="text-base font-bold text-yellow-600 dark:text-yellow-400">{ok.length}</p>
                  <p className="text-muted-foreground">Getting there</p>
                </div>
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 py-2">
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{strong.length}</p>
                  <p className="text-muted-foreground">Strong</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Topic breakdown */}
          <div className="space-y-2 mb-8">
            {topicResults.map((t) => {
              const isWeak = t.accuracy < 60;
              const isStrong = t.accuracy >= 85;
              return (
                <div
                  key={t.topic}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
                    isWeak
                      ? "bg-destructive/5 border-destructive/20"
                      : isStrong
                      ? "bg-emerald-500/5 border-emerald-500/20"
                      : "bg-yellow-500/5 border-yellow-500/20"
                  }`}
                >
                  {isStrong ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  ) : (
                    <XCircle className={`w-4 h-4 flex-shrink-0 ${isWeak ? "text-destructive" : "text-yellow-500"}`} />
                  )}
                  <span className="text-sm font-medium text-foreground flex-1 min-w-0 truncate">{t.topic}</span>
                  <span className={`text-sm font-bold flex-shrink-0 ${
                    isWeak ? "text-destructive" : isStrong ? "text-emerald-500" : "text-yellow-600 dark:text-yellow-400"
                  }`}>
                    {t.accuracy}%
                  </span>
                </div>
              );
            })}
          </div>

          {/* CTA */}
          <div className="space-y-3">
            {weak.length > 0 && (
              <Card className="border-destructive/30">
                <CardContent className="p-5">
                  <p className="text-sm font-bold text-foreground mb-1">Start with your weak spots</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Focus on {weak.map((t) => t.topic).join(", ")} first — that&apos;s where you&apos;ll gain the most.
                  </p>
                  <Button asChild size="sm">
                    <Link href={`/quiz/${lectureId}`}>
                      <BookOpen className="w-4 h-4 mr-2" />
                      Practice now
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            )}
            <Button variant="outline" className="w-full" asChild>
              <Link href={`/results/${lectureId}`}>View all questions</Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // ── Quiz phase ───────────────────────────────────────────────────────────────
  const q = questions[currentQ];
  const progress = ((currentQ + (revealed ? 1 : 0)) / questions.length) * 100;

  return (
    <div className="min-h-screen bg-background text-foreground pb-32">
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="text-xl font-bold text-foreground">cortexQ</Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground tabular-nums">{currentQ + 1} / {questions.length}</span>
            <Link href={`/results/${lectureId}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Exit</span>
            </Link>
          </div>
        </div>
        <Progress value={progress} className="h-0.5 rounded-none" />
      </header>

      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        <Badge variant="secondary" className="mb-4 text-xs">{q.topic}</Badge>
        <h1 className="text-xl sm:text-2xl font-bold text-foreground leading-snug mb-8">{q.question}</h1>

        <div className="space-y-3 mb-6">
          {q.options.map((option) => {
            const letter = option.charAt(0);
            const isSelected = selectedLetter === letter;
            const isCorrect = letter === q.answer;

            let cls = "border text-left transition-all";
            if (revealed) {
              if (isCorrect) cls += " bg-emerald-500/10 border-emerald-500/40 text-foreground";
              else if (isSelected) cls += " bg-destructive/10 border-destructive/40 text-foreground";
              else cls += " bg-muted/30 border-border text-muted-foreground";
            } else if (isSelected) {
              cls += " bg-primary/10 border-primary/60 text-foreground";
            } else {
              cls += " bg-card border-border text-foreground hover:bg-accent hover:border-accent-foreground/20 cursor-pointer";
            }

            return (
              <button
                key={letter}
                onClick={() => handleSelect(letter)}
                className={`w-full p-4 rounded-xl flex items-center gap-4 ${cls}`}
              >
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-bold text-sm ${
                  revealed && isCorrect ? "bg-emerald-500 text-white"
                  : revealed && isSelected && !isCorrect ? "bg-destructive text-white"
                  : isSelected ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
                }`}>{letter}</span>
                <span className="font-medium text-sm leading-snug flex-1">
                  {option.replace(/^[A-D]\.\s*/, "")}
                </span>
                {revealed && isCorrect && <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />}
                {revealed && isSelected && !isCorrect && <XCircle className="w-4 h-4 text-destructive shrink-0" />}
              </button>
            );
          })}
        </div>

        {revealed && q.explanation && (
          <div className={`p-4 rounded-xl text-sm border leading-relaxed ${
            selectedLetter === q.answer
              ? "bg-emerald-500/5 border-emerald-500/20 text-foreground"
              : "bg-primary/5 border-primary/20 text-foreground"
          }`}>
            <span className="font-semibold">Answer {q.answer}:</span>{" "}
            {q.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
          </div>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-end">
          <Button onClick={revealed ? advance : undefined} disabled={!revealed} className="flex items-center gap-2 px-6">
            {currentQ === questions.length - 1 ? "See Results" : "Next"}
            <ArrowRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
