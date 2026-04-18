"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getEssayResults,
  gradeEssayAnswer,
  EssayQuestion,
  EssayGradeResult,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft, Brain, CheckCircle2, XCircle, Loader2,
  ChevronRight, Home, BarChart3, BookOpen, Target,
} from "lucide-react";

interface GradedAnswer {
  studentAnswer: string;
  grade: EssayGradeResult;
}

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

function scoreLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Great";
  if (score >= 65) return "Good";
  if (score >= 50) return "Needs Work";
  return "Needs Review";
}

export default function EssayQuizPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const lectureId = parseInt(id);

  const [questions, setQuestions]   = useState<EssayQuestion[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [current, setCurrent]       = useState(0);
  const [answer, setAnswer]         = useState("");
  const [grading, setGrading]       = useState(false);
  const [gradeError, setGradeError] = useState("");
  const [gradedAnswers, setGradedAnswers] = useState<(GradedAnswer | null)[]>([]);
  const [showIdeal, setShowIdeal]   = useState(false);
  const [done, setDone]             = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    getEssayResults(lectureId)
      .then((res) => {
        setQuestions(res.data.questions);
        setGradedAnswers(new Array(res.data.questions.length).fill(null));
      })
      .catch(() => setError("Failed to load essay questions."))
      .finally(() => setLoading(false));
  }, [lectureId, router]);

  const currentQ = questions[current];
  const currentGrade = gradedAnswers[current];

  const handleGrade = async () => {
    if (!answer.trim()) return;
    setGrading(true);
    setGradeError("");
    setShowIdeal(false);
    try {
      const res = await gradeEssayAnswer(lectureId, current, answer.trim(), currentQ.ideal_answer);
      const updated = [...gradedAnswers];
      updated[current] = { studentAnswer: answer.trim(), grade: res.data };
      setGradedAnswers(updated);
      setShowIdeal(true);
    } catch {
      setGradeError("Grading failed — please try again.");
    } finally {
      setGrading(false);
    }
  };

  const handleNext = () => {
    if (current + 1 < questions.length) {
      setCurrent((c) => c + 1);
      setAnswer("");
      setShowIdeal(false);
      setGradeError("");
    } else {
      setDone(true);
    }
  };

  const totalScore = gradedAnswers.reduce((sum, g) => sum + (g?.grade.score ?? 0), 0);
  const answeredCount = gradedAnswers.filter(Boolean).length;
  const avgScore = answeredCount > 0 ? Math.round(totalScore / answeredCount) : 0;

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="grain-overlay" />
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-4">
        <div className="grain-overlay" />
        <XCircle className="w-12 h-12 text-destructive" />
        <p className="text-destructive font-semibold">{error}</p>
        <Link href="/lectures">
          <Button variant="outline">Go to Dashboard</Button>
        </Link>
      </div>
    );
  }

  // ── Final Results Screen ─────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4 relative">
        <div className="grain-overlay" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-violet-500/15 rounded-full blur-[120px] pointer-events-none" />
        <Card className="relative z-10 glass-panel border-border/50 max-w-md w-full">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-20 h-20 rounded-2xl bg-violet-500/20 flex items-center justify-center mx-auto">
              <Target className="w-10 h-10 text-violet-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-1">Essay Quiz Done!</h2>
              <p className="text-muted-foreground text-sm">
                You answered {answeredCount} of {questions.length} questions
              </p>
            </div>

            {/* Score circle */}
            <div className={`inline-flex flex-col items-center justify-center w-36 h-36 rounded-full border-4 mx-auto ${scoreBg(avgScore)}`}>
              <span className={`text-5xl font-extrabold ${scoreColor(avgScore)}`}>{avgScore}</span>
              <span className="text-xs text-muted-foreground mt-1">/ 100 avg</span>
            </div>

            <p className={`text-lg font-bold ${scoreColor(avgScore)}`}>{scoreLabel(avgScore)}</p>

            {/* Per-question breakdown */}
            <div className="space-y-2 text-left">
              {gradedAnswers.map((g, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground truncate max-w-[200px]">
                    Q{i + 1}: {questions[i]?.topic || `Question ${i + 1}`}
                  </span>
                  {g ? (
                    <span className={`font-bold ${scoreColor(g.grade.score)}`}>{g.grade.score}/100</span>
                  ) : (
                    <span className="text-muted-foreground/50 text-xs">Skipped</span>
                  )}
                </div>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <Link href="/lectures" className="flex-1">
                <Button variant="outline" className="w-full gap-2">
                  <BookOpen className="w-4 h-4" />View MCQs
                </Button>
              </Link>
              <Link href="/lectures" className="flex-1">
                <Button className="w-full synapse-gradient text-white gap-2">
                  <Home className="w-4 h-4" />Dashboard
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Quiz Screen ──────────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      <div className="grain-overlay" />

      {/* Header */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-card/80 backdrop-blur-xl z-50 border-b border-border/50">
        <div className="flex items-center gap-4">
          <Link href="/lectures" className="text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <span className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">
            cortexQ
          </span>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Brain className="w-4 h-4 text-violet-400" />
          <span className="font-semibold text-violet-400">Essay Mode</span>
          <span>· Q{current + 1}/{questions.length}</span>
        </div>
      </header>

      <main className="flex-grow flex flex-col items-center justify-start px-4 sm:px-6 max-w-3xl mx-auto w-full pt-24 pb-32 space-y-6">

        {/* Progress bar */}
        <div className="w-full space-y-1">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Question {current + 1} of {questions.length}</span>
            {answeredCount > 0 && (
              <span className={scoreColor(avgScore)}>Avg: {avgScore}/100</span>
            )}
          </div>
          <Progress value={((current) / questions.length) * 100} className="h-1.5" />
        </div>

        {/* Topic badge */}
        {currentQ?.topic && (
          <div className="self-start px-3 py-1 rounded-full bg-violet-500/15 border border-violet-500/30 text-xs text-violet-400 font-semibold">
            {currentQ.topic}
          </div>
        )}

        {/* Question card */}
        <Card className="w-full glass-panel border-border/50">
          <CardContent className="p-6 space-y-5">
            <p className="text-lg font-bold text-foreground leading-relaxed">{currentQ?.question}</p>

            {/* Student answer input — locked after grading */}
            {!currentGrade ? (
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                disabled={grading}
                placeholder="Write your answer here…"
                className="w-full min-h-[160px] resize-none bg-muted/30 border border-border/40 rounded-xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60 transition-colors leading-relaxed disabled:opacity-60"
              />
            ) : (
              <div className="rounded-xl bg-muted/20 border border-border/30 px-4 py-3 text-sm text-foreground leading-relaxed">
                {currentGrade.studentAnswer}
              </div>
            )}

            {/* Grade error */}
            {gradeError && (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <XCircle className="w-4 h-4 flex-shrink-0" />{gradeError}
              </div>
            )}

            {/* Grade result */}
            {currentGrade && (
              <div className="space-y-4">
                {/* Score */}
                <div className={`flex items-center justify-between px-5 py-4 rounded-xl border ${scoreBg(currentGrade.grade.score)}`}>
                  <div>
                    <p className="text-xs text-muted-foreground mb-0.5">Your Score</p>
                    <p className={`text-3xl font-extrabold ${scoreColor(currentGrade.grade.score)}`}>
                      {currentGrade.grade.score}<span className="text-base font-normal text-muted-foreground">/100</span>
                    </p>
                    <p className={`text-sm font-semibold mt-0.5 ${scoreColor(currentGrade.grade.score)}`}>
                      {scoreLabel(currentGrade.grade.score)}
                    </p>
                  </div>
                  <div className={`w-14 h-14 rounded-full border-4 flex items-center justify-center ${scoreBg(currentGrade.grade.score)}`}>
                    {currentGrade.grade.score >= 55
                      ? <CheckCircle2 className={`w-7 h-7 ${scoreColor(currentGrade.grade.score)}`} />
                      : <XCircle className={`w-7 h-7 ${scoreColor(currentGrade.grade.score)}`} />
                    }
                  </div>
                </div>

                {/* Feedback */}
                <div className="rounded-xl bg-muted/20 border border-border/30 px-4 py-3 text-sm text-foreground leading-relaxed">
                  <p className="text-xs text-muted-foreground font-semibold mb-1">Feedback</p>
                  {currentGrade.grade.feedback}
                </div>

                {/* Key points covered */}
                {currentGrade.grade.key_points_covered.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-emerald-400">Points covered</p>
                    {currentGrade.grade.key_points_covered.map((pt, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />{pt}
                      </div>
                    ))}
                  </div>
                )}

                {/* Key points missed */}
                {currentGrade.grade.key_points_missed.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-red-400">Points missed</p>
                    {currentGrade.grade.key_points_missed.map((pt, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />{pt}
                      </div>
                    ))}
                  </div>
                )}

                {/* Ideal Answer toggle */}
                <button
                  onClick={() => setShowIdeal((v) => !v)}
                  className="w-full text-xs font-semibold text-primary hover:text-primary/80 transition-colors py-1"
                >
                  {showIdeal ? "Hide ideal answer" : "Show ideal answer"}
                </button>

                {showIdeal && (
                  <div className="rounded-xl bg-primary/5 border border-primary/20 px-4 py-3 text-sm text-foreground leading-relaxed">
                    <p className="text-xs text-primary font-semibold mb-1">Ideal Answer (100/100)</p>
                    {currentQ.ideal_answer}
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              {!currentGrade ? (
                <Button
                  onClick={handleGrade}
                  disabled={grading || !answer.trim()}
                  className="flex-1 synapse-gradient text-white font-bold py-5 rounded-xl disabled:opacity-50"
                >
                  {grading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />Grading…
                    </span>
                  ) : "Submit Answer"}
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  className="flex-1 synapse-gradient text-white font-bold py-5 rounded-xl gap-2"
                >
                  {current + 1 < questions.length ? (
                    <><ChevronRight className="w-4 h-4" />Next Question</>
                  ) : (
                    <><Target className="w-4 h-4" />See Final Score</>
                  )}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-card/95 backdrop-blur-lg rounded-t-3xl border-t border-border/50">
        <Link href="/lectures" className="flex flex-col items-center text-muted-foreground">
          <Home className="w-6 h-6" />
          <span className="text-[10px] uppercase tracking-widest mt-1">Home</span>
        </Link>
        <Link href="/lectures" className="flex flex-col items-center text-muted-foreground">
          <BookOpen className="w-6 h-6" />
          <span className="text-[10px] uppercase tracking-widest mt-1">Results</span>
        </Link>
        <Link href="/analytics" className="flex flex-col items-center text-muted-foreground">
          <BarChart3 className="w-6 h-6" />
          <span className="text-[10px] uppercase tracking-widest mt-1">Stats</span>
        </Link>
      </nav>

      {/* Background blobs */}
      <div className="fixed top-1/4 -left-20 w-80 h-80 bg-violet-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-1/4 -right-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
    </div>
  );
}
