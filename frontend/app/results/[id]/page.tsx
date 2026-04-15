"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getResults,
  processLecture,
  createShareLink,
  getActiveViewers,
  getQuizSession,
  saveQuizSession,
  retakeQuizSession,
  getPerformanceQuestions,
  savePerformanceQuestions,
  startPerformanceSession,
  submitPerformanceAnswer,
  completePerformanceSession,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Clock,
  Eye,
  Users,
  Share2,
  Shuffle,
  RefreshCw,
  Check,
  X,
  ChevronRight,
  Home,
  Upload,
  BarChart3,
  Zap,
  BookOpen,
  Lightbulb,
  Brain,
  Target,
  TrendingUp,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  XCircle,
  Cloud,
  CloudOff,
  Loader2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface MCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

interface Results {
  id: number;
  lecture_id: number;
  summary: string;
  key_concepts: string[];
  mcqs: MCQ[];
  created_at: string;
  share_token?: string;
  view_count?: number;
}

type Confidence = "guessed" | "unsure" | "confident";

const CONFIDENCE_TO_INT: Record<Confidence, number> = {
  guessed: 1,
  unsure: 2,
  confident: 3,
};

interface AnswerEntry {
  letter: string;
  confidence: Confidence;
}

interface LiveTimeline {
  time_on_option_a: number;
  time_on_option_b: number;
  time_on_option_c: number;
  time_on_option_d: number;
  second_choice: string | null;
  re_read_question: boolean;
  re_read_count: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByTopic(mcqs: MCQ[]): Record<string, MCQ[]> {
  return mcqs.reduce((acc, mcq, idx) => {
    const topic = mcq.topic || "General";
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push({ ...mcq, _index: idx } as MCQ & { _index: number });
    return acc;
  }, {} as Record<string, MCQ[]>);
}

type ActiveTab = "mcqs" | "summary" | "concepts";

const CONFIDENCE_OPTIONS: { value: Confidence; label: string; color: string }[] = [
  { value: "guessed", label: "Guessed", color: "border-orange-500/40 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20" },
  { value: "unsure", label: "Unsure", color: "border-yellow-500/40 bg-yellow-500/10 text-yellow-400 hover:bg-yellow-500/20" },
  { value: "confident", label: "Confident", color: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20" },
];

const LETTER_TO_OPTION: Record<string, keyof LiveTimeline> = {
  A: "time_on_option_a",
  B: "time_on_option_b",
  C: "time_on_option_c",
  D: "time_on_option_d",
};

// ─── Timer ────────────────────────────────────────────────────────────────────

function TimerDisplay({ startRef }: { startRef: React.MutableRefObject<number> }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startRef]);
  const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const s = (elapsed % 60).toString().padStart(2, "0");
  return (
    <span className="font-mono text-sm text-muted-foreground tabular-nums">{m}:{s}</span>
  );
}

// ─── Performance types ────────────────────────────────────────────────────────

interface WeakPoint {
  topic: string;
  accuracy_rate: number;
  total_attempts: number;
  consecutive_failures: number;
  flagged_as_weak: boolean;
  dangerous_misconception: boolean;
  accuracy_trend?: number;
}

interface Readiness {
  readiness_score: number;
  total_questions_answered: number;
  weak_topics_count: number;
  strong_topics_count: number;
  last_session_at: string | null;
}

interface NextAction {
  action_type: string;
  topic: string | null;
  next_step: string;
  reason: string[];
  confidence_gap_alert: boolean;
  short_message: string;
  predicted_readiness_24h: number | null;
}

interface WeeklyQuiz {
  assignment_id: string | null;
  questions: unknown[];
  weak_topics: string[];
}

interface AiInsight {
  next_topic_to_study: string;
  intervention_type: string;
  personalized_message: string;
  predicted_readiness_7d: number | null;
  critical_insight: string | null;
  daily_plan: { day: number; focus: string; question_count: number; priority: string }[];
  behavioral_warning: string | null;
  strongest_topic: string | null;
  decay_alert: string | null;
  urgency_level: string;
}

const BASE = "/api/v1/performance";

async function perfGet<T>(path: string): Promise<T> {
  const res = await api.get<T>(`${BASE}${path}`);
  return res.data;
}

async function perfPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.post<T>(`${BASE}${path}`, body);
  return res.data;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const lectureId = parseInt(params.id as string);

  // Core state
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  const [answers, setAnswers] = useState<Record<number, AnswerEntry>>({});
  const [pendingAnswer, setPendingAnswer] = useState<{ globalIndex: number; letter: string } | null>(null);
  const [score, setScore] = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [shuffledMcqs, setShuffledMcqs] = useState<Array<MCQ & { _index: number }>>([]);
  const [activeTab, setActiveTab] = useState<ActiveTab>("mcqs");
  const [shareToken, setShareToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [activeViewers, setActiveViewers] = useState(0);
  const [totalViews, setTotalViews] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [retakeCount, setRetakeCount] = useState(0);

  // Performance sidebar state
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [nextAction, setNextAction] = useState<NextAction | null>(null);
  const [weeklyQuiz, setWeeklyQuiz] = useState<WeeklyQuiz | null>(null);
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [aiInsightStatus, setAiInsightStatus] = useState<"loading" | "fresh" | "stale" | "no_data" | "error">("loading");
  const [insightTab, setInsightTab] = useState<"next" | "insight" | "plan" | "quiz">("next");

  // Refs
  const sessionStartRef = useRef<number>(Date.now());
  const viewerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasScrolledToResume = useRef(false);

  const perfSessionId = useRef<string | null>(null);
  const perfQuestionMap = useRef<Record<string, string>>({});
  const questionStartTime = useRef<number>(Date.now());
  const confidenceStartTime = useRef<number>(Date.now());
  const firstAnswerTime = useRef<number | null>(null);
  const firstAnswerLetter = useRef<string | null>(null);

  const hoverStartRef = useRef<{ letter: string; at: number } | null>(null);
  const liveTimelineRef = useRef<LiveTimeline>({
    time_on_option_a: 0, time_on_option_b: 0,
    time_on_option_c: 0, time_on_option_d: 0,
    second_choice: null, re_read_question: false, re_read_count: 0,
  });

  const nextQueueRef = useRef<string | null>(null);

  // Auth & load
  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    fetchResults();
  }, [lectureId, router]);

  // Load performance sidebar
  useEffect(() => {
    if (!results) return;
    loadPerformanceSidebar();
  }, [results]);

  const loadPerformanceSidebar = async () => {
    await Promise.allSettled([
      perfGet<WeakPoint[]>("/students/me/weak-points").then(setWeakPoints).catch(() => {}),
      perfGet<Readiness>("/students/me/readiness").then(setReadiness).catch(() => {}),
      perfGet<NextAction>("/students/me/next-action").then(setNextAction).catch(() => {}),
      perfGet<WeeklyQuiz>("/weekly-quiz/pending").then(setWeeklyQuiz).catch(() => {}),
      perfGet<{ status: string; insight: AiInsight | null }>("/students/me/ai-insight")
        .then((data) => {
          setAiInsightStatus(data.status as typeof aiInsightStatus);
          if (data.insight) setAiInsight(data.insight);
        })
        .catch(() => setAiInsightStatus("error")),
    ]);
  };

  const refreshSidebarAfterAnswer = useCallback(async () => {
    try {
      const [wp, rd, na] = await Promise.all([
        perfGet<WeakPoint[]>("/students/me/weak-points"),
        perfGet<Readiness>("/students/me/readiness"),
        perfGet<NextAction>("/students/me/next-action"),
      ]);
      setWeakPoints(wp);
      setReadiness(rd);
      setNextAction(na);
    } catch {}
  }, []);

  // Auto-scroll to resume
  useEffect(() => {
    if (loading || hasScrolledToResume.current || !results || Object.keys(answers).length === 0 || shuffleMode) return;
    const firstUnanswered = results.mcqs.findIndex((_, i) => answers[i] === undefined);
    if (firstUnanswered === -1) return;
    hasScrolledToResume.current = true;
    setTimeout(() => {
      document.getElementById(`mcq-${firstUnanswered}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }, [answers, results, shuffleMode, loading]);

  // Viewer polling
  useEffect(() => {
    if (!shareToken) return;
    const poll = async () => {
      try {
        const res = await getActiveViewers(lectureId);
        setActiveViewers(res.data.active_viewers);
        setTotalViews(res.data.view_count);
      } catch {}
    };
    poll();
    viewerPollRef.current = setInterval(poll, 10000);
    return () => { if (viewerPollRef.current) clearInterval(viewerPollRef.current); };
  }, [shareToken, lectureId]);

  // Fetch results
  const fetchResults = async () => {
    try {
      const res = await getResults(lectureId);
      setResults(res.data);
      if (res.data.share_token) {
        setShareToken(res.data.share_token);
        setTotalViews(res.data.view_count || 0);
      }

      try {
        let pqRes = await getPerformanceQuestions(lectureId);
        if (!pqRes.data || pqRes.data.length === 0) {
          await savePerformanceQuestions(lectureId, "highyield", res.data.mcqs || []);
          pqRes = await getPerformanceQuestions(lectureId);
        }
        const map: Record<string, string> = {};
        for (const q of pqRes.data) map[q.question_text] = q.id;
        perfQuestionMap.current = map;
      } catch {}

      try {
        const sessionRes = await getQuizSession(lectureId);
        const saved = sessionRes.data.answers || {};
        setRetakeCount(sessionRes.data.retake_count || 0);
        if (Object.keys(saved).length > 0) {
          const restored: Record<number, AnswerEntry> = {};
          Object.entries(saved).forEach(([k, v]) => {
            const idx = parseInt(k);
            restored[idx] = typeof v === "string"
              ? { letter: v as string, confidence: "unsure" }
              : v as AnswerEntry;
          });
          setAnswers(restored);
          const correct = res.data.mcqs.filter((mcq: MCQ, i: number) => restored[i]?.letter === mcq.answer).length;
          setScore(correct);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 1500);
        }
      } catch {}
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      setError(axiosErr.response?.status === 404 ? "not_found" : "Failed to load results");
    } finally {
      setLoading(false);
    }
  };

  const prefetchNextQuestion = useCallback(async () => {
    if (!perfSessionId.current) return;
    try {
      const data = await perfGet<{ question: { id: string } | null; reason: string }>(
        `/sessions/${perfSessionId.current}/next-question`
      );
      nextQueueRef.current = data.question?.id ?? null;
    } catch {}
  }, []);

  const copyToClipboard = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement("textarea");
      el.value = text; el.style.position = "fixed"; el.style.opacity = "0";
      document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
    }
  };

  const handleShare = async () => {
    setSharing(true);
    try {
      const res = await createShareLink(lectureId);
      const token = res.data.share_token;
      setShareToken(token);
      await copyToClipboard(`${window.location.origin}/shared/${token}`);
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch { setError("Failed to create share link"); }
    finally { setSharing(false); }
  };

  const handleCopyLink = async () => {
    if (!shareToken) return;
    await copyToClipboard(`${window.location.origin}/shared/${shareToken}`);
    setCopied(true); setTimeout(() => setCopied(false), 2500);
  };

  const handleProcess = async () => {
    setProcessing(true); setError("");
    try {
      await processLecture(lectureId);
      setAnswers({}); setScore(0);
      try { await saveQuizSession(lectureId, {}); } catch {}
      await fetchResults();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const detail = axiosErr.response?.data?.detail;
      if (typeof detail === "string") setError(detail);
      else if (Array.isArray(detail)) setError(detail.map((d: { msg?: string }) => d?.msg ?? String(d)).join("; "));
      else setError("Processing failed");
    } finally { setProcessing(false); }
  };

  const handleOptionHoverStart = useCallback((letter: string) => {
    hoverStartRef.current = { letter, at: Date.now() };
  }, []);

  const handleOptionHoverEnd = useCallback((letter: string) => {
    if (!hoverStartRef.current || hoverStartRef.current.letter !== letter) return;
    const elapsed = Math.round((Date.now() - hoverStartRef.current.at) / 1000);
    const key = LETTER_TO_OPTION[letter];
    if (key) {
      (liveTimelineRef.current as unknown as Record<string, number>)[key as string] =
        ((liveTimelineRef.current as unknown as Record<string, number>)[key as string] ?? 0) + elapsed;
    }
    hoverStartRef.current = null;
  }, []);

  const resetLiveTimeline = useCallback(() => {
    liveTimelineRef.current = {
      time_on_option_a: 0, time_on_option_b: 0,
      time_on_option_c: 0, time_on_option_d: 0,
      second_choice: null, re_read_question: false, re_read_count: 0,
    };
    hoverStartRef.current = null;
    firstAnswerTime.current = null;
    firstAnswerLetter.current = null;
  }, []);

  const handleSelectAnswer = useCallback((globalIndex: number, letter: string) => {
    if (answers[globalIndex] !== undefined) return;

    if (pendingAnswer?.globalIndex === globalIndex) {
      liveTimelineRef.current.second_choice = pendingAnswer.letter;
      if (firstAnswerTime.current === null) {
        firstAnswerTime.current = Date.now();
        firstAnswerLetter.current = pendingAnswer.letter;
      }
      setPendingAnswer({ globalIndex, letter });
      return;
    }

    if (hoverStartRef.current) {
      handleOptionHoverEnd(hoverStartRef.current.letter);
    }

    setPendingAnswer({ globalIndex, letter });
    confidenceStartTime.current = Date.now();
  }, [answers, pendingAnswer, handleOptionHoverEnd]);

  const handleConfidence = useCallback(async (confidence: Confidence) => {
    if (!pendingAnswer || !results) return;
    const { globalIndex, letter } = pendingAnswer;

    const timeSpent = Math.max(1, Math.round((Date.now() - questionStartTime.current) / 1000));
    const timeToConfidence = Math.max(1, Math.round((Date.now() - confidenceStartTime.current) / 1000));

    const answerChanged = firstAnswerLetter.current !== null && firstAnswerLetter.current !== letter;
    const originalAnswer = answerChanged ? firstAnswerLetter.current : null;
    const timeToFirstChange = answerChanged && firstAnswerTime.current
      ? Math.round((firstAnswerTime.current - questionStartTime.current) / 1000)
      : null;

    const entry: AnswerEntry = { letter, confidence };
    const updated = { ...answers, [globalIndex]: entry };
    const correct = results.mcqs.filter((mcq, i) => updated[i]?.letter === mcq.answer).length;

    setScore(correct);
    setAnswers(updated);
    setPendingAnswer(null);

    const timeline = { ...liveTimelineRef.current };
    resetLiveTimeline();
    questionStartTime.current = Date.now();

    const mcq = results.mcqs[globalIndex];
    const questionId = perfQuestionMap.current[mcq.question];
    if (questionId) {
      (async () => {
        try {
          if (!perfSessionId.current) {
            const res = await startPerformanceSession(lectureId, "highyield", results.mcqs.length);
            perfSessionId.current = res.data.session_id;
          }

          await submitPerformanceAnswer(
            perfSessionId.current!,
            questionId,
            letter,
            mcq.answer,
            timeSpent,
            {
              pre_answer_confidence: CONFIDENCE_TO_INT[confidence],
              time_to_confidence: timeToConfidence,
              answer_changed: answerChanged,
              original_answer: originalAnswer,
              time_to_first_change: timeToFirstChange,
              answer_timeline: {
                time_on_option_a: timeline.time_on_option_a,
                time_on_option_b: timeline.time_on_option_b,
                time_on_option_c: timeline.time_on_option_c,
                time_on_option_d: timeline.time_on_option_d,
                second_choice: timeline.second_choice,
                re_read_question: timeline.re_read_question,
                re_read_count: timeline.re_read_count,
              },
            }
          );

          prefetchNextQuestion();

          if (Object.keys(updated).length === results.mcqs.length && perfSessionId.current) {
            await completePerformanceSession(perfSessionId.current);
            perfSessionId.current = null;
            await loadPerformanceSidebar();
          } else {
            refreshSidebarAfterAnswer();
          }
        } catch {}
      })();
    }

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveStatus("saving");
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const answersToSave = Object.entries(updated).reduce((acc, [k, v]) => {
          acc[parseInt(k)] = v.letter;
          return acc;
        }, {} as Record<number, string>);
        await saveQuizSession(lectureId, answersToSave);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch { setSaveStatus("idle"); }
    }, 800);
  }, [pendingAnswer, answers, results, lectureId, prefetchNextQuestion, refreshSidebarAfterAnswer, resetLiveTimeline]);

  const handleDismissQuiz = async () => {
    if (!weeklyQuiz?.assignment_id) return;
    try {
      await perfPost(`/weekly-quiz/${weeklyQuiz.assignment_id}/dismiss`);
      setWeeklyQuiz(null);
    } catch {}
  };

  const handleRefreshInsight = async () => {
    setAiInsightStatus("loading");
    try {
      const data = await perfGet<{ status: string; insight: AiInsight | null }>(
        "/students/me/ai-insight?force=true"
      );
      setAiInsightStatus(data.status as typeof aiInsightStatus);
      if (data.insight) setAiInsight(data.insight);
    } catch { setAiInsightStatus("error"); }
  };

  const handleReset = async () => {
    setConfirmRetake(false);
    try {
      const res = await retakeQuizSession(lectureId);
      setRetakeCount(res.data.retake_count);
    } catch {}
    setAnswers({}); setPendingAnswer(null); setScore(0); setSaveStatus("idle");
    perfSessionId.current = null;
    sessionStartRef.current = Date.now();
    hasScrolledToResume.current = false;
    questionStartTime.current = Date.now();
    resetLiveTimeline();
  };

  const handleToggleShuffle = () => {
    if (!shuffleMode && results) {
      const indexed = results.mcqs.map((mcq, i) => ({ ...mcq, _index: i }));
      setShuffledMcqs([...indexed].sort(() => Math.random() - 0.5));
      setShuffleMode(true);
    } else {
      setShuffleMode(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not found state
  if (error === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="h-8 w-8 text-muted-foreground" />
            </div>
            <h2 className="text-2xl font-semibold text-foreground mb-2">Not Processed Yet</h2>
            <p className="text-muted-foreground mb-8">Generate study materials for this lecture to get started.</p>
            <Button onClick={handleProcess} disabled={processing} size="lg" className="w-full">
              {processing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Processing...
                </>
              ) : (
                "Generate Study Materials"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!results) return null;

  const answeredCount = Object.keys(answers).length;
  const totalCount = results.mcqs.length;
  const grouped = groupByTopic(results.mcqs);
  const scorePercent = totalCount > 0 ? Math.round((score / totalCount) * 100) : 0;

  // MCQ List Component
  const MCQList = ({ mcqs }: { mcqs: Array<MCQ & { _index: number }> }) => (
    <div className="space-y-4">
      {mcqs.map((mcq, displayIdx) => {
        const globalIdx = mcq._index;
        const answered = answers[globalIdx];
        const isPending = pendingAnswer?.globalIndex === globalIdx;
        const isAnswered = answered !== undefined;
        const isCorrect = answered?.letter === mcq.answer;

        return (
          <Card
            key={globalIdx}
            id={`mcq-${globalIdx}`}
            className={`transition-all duration-200 ${
              isAnswered
                ? isCorrect ? "border-l-4 border-l-emerald-500" : "border-l-4 border-l-destructive"
                : isPending ? "border-l-4 border-l-primary ring-1 ring-primary/20" : "hover:border-border/80"
            }`}
          >
            <CardContent className="p-6">
              {/* Header */}
              <div className="flex justify-between items-start mb-4">
                <Badge variant="secondary" className="text-xs font-medium">
                  Question {String(displayIdx + 1).padStart(2, "0")}
                </Badge>
                {isAnswered && (
                  <Badge variant={isCorrect ? "default" : "destructive"} className="gap-1">
                    {isCorrect ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {isCorrect ? "Correct" : "Incorrect"}
                  </Badge>
                )}
              </div>

              {/* Question */}
              <p
                className="text-base font-medium text-foreground mb-6 leading-relaxed"
                onPointerEnter={() => {
                  if (!isAnswered && isPending) {
                    liveTimelineRef.current.re_read_question = true;
                    liveTimelineRef.current.re_read_count += 1;
                  }
                }}
              >
                {mcq.question}
              </p>

              {/* Options */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {mcq.options.map((option, j) => {
                  const letter = option.charAt(0);
                  const isThisSelected = answered?.letter === letter || (isPending && pendingAnswer?.letter === letter);
                  const isThisCorrect = letter === mcq.answer;

                  let optionClass = "";
                  if (isAnswered) {
                    if (isThisCorrect) {
                      optionClass = "bg-emerald-500/10 border-emerald-500/40 text-foreground";
                    } else if (isThisSelected) {
                      optionClass = "bg-destructive/10 border-destructive/40 text-foreground";
                    } else {
                      optionClass = "bg-muted/50 border-border text-muted-foreground";
                    }
                  } else if (isPending) {
                    if (isThisSelected) {
                      optionClass = "bg-primary/10 border-primary/40 text-foreground";
                    } else {
                      optionClass = "bg-muted/50 border-border text-muted-foreground";
                    }
                  } else {
                    optionClass = "bg-card border-border text-foreground hover:bg-accent hover:border-accent-foreground/20 cursor-pointer";
                  }

                  return (
                    <button
                      key={j}
                      onClick={() => !isAnswered && !isPending && handleSelectAnswer(globalIdx, letter)}
                      onPointerEnter={() => !isAnswered && handleOptionHoverStart(letter)}
                      onPointerLeave={() => !isAnswered && handleOptionHoverEnd(letter)}
                      disabled={isAnswered || isPending}
                      className={`p-4 rounded-xl text-sm text-left transition-all border flex justify-between items-center gap-2 ${optionClass}`}
                    >
                      <span className="leading-relaxed">{option}</span>
                      {isAnswered && isThisCorrect && <Check className="h-4 w-4 text-emerald-500 shrink-0" />}
                      {isAnswered && isThisSelected && !isThisCorrect && <X className="h-4 w-4 text-destructive shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Confidence prompt */}
              {isPending && (
                <div className="mt-6 rounded-xl border border-primary/30 bg-primary/5 p-5">
                  <div className="flex items-center gap-2 mb-1">
                    <Brain className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium text-foreground">How confident were you?</p>
                  </div>
                  <p className="text-xs text-muted-foreground mb-4">Your answer is locked in - this helps track your learning.</p>
                  <div className="flex gap-3 flex-wrap">
                    {CONFIDENCE_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => handleConfidence(opt.value)}
                        className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all hover:-translate-y-0.5 ${opt.color}`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Explanation */}
              {isAnswered && mcq.explanation && (
                <div className={`mt-4 p-4 rounded-xl text-sm ${isCorrect ? "bg-emerald-500/5 border border-emerald-500/20" : "bg-primary/5 border border-primary/20"}`}>
                  <p className="text-foreground leading-relaxed">
                    <span className="font-medium">Answer: {mcq.answer}</span> - {mcq.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
                  </p>
                  {answered.confidence && (() => {
                    const c = CONFIDENCE_OPTIONS.find(o => o.value === answered.confidence);
                    return c ? (
                      <Badge variant="outline" className={`mt-2 ${c.color}`}>
                        {c.label}
                      </Badge>
                    ) : null;
                  })()}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  // Performance Sidebar
  const PerformanceSidebar = () => (
    <Card className="overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b">
        {(["next", "insight", "plan", "quiz"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setInsightTab(t)}
            className={`flex-1 py-3 text-xs font-medium transition-colors border-b-2 ${
              insightTab === t
                ? "border-primary text-foreground bg-muted/50"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "next" ? "Next" : t === "insight" ? "AI" : t === "plan" ? "Plan" : "Quiz"}
          </button>
        ))}
      </div>

      <CardContent className="p-5 space-y-4">
        {/* NEXT ACTION tab */}
        {insightTab === "next" && (
          <div className="space-y-4">
            {readiness && (
              <div className="rounded-xl bg-muted p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-muted-foreground">Readiness Score</span>
                  <span className="text-2xl font-bold text-foreground">{Math.round(readiness.readiness_score)}%</span>
                </div>
                <Progress value={readiness.readiness_score} className="h-2" />
                <div className="flex justify-between mt-3 text-xs text-muted-foreground">
                  <span>{readiness.weak_topics_count} weak</span>
                  <span>{readiness.strong_topics_count} strong</span>
                  <span>{readiness.total_questions_answered} answered</span>
                </div>
              </div>
            )}

            {nextAction ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
                  <p className="text-xs font-medium text-primary mb-1">Recommended Now</p>
                  <p className="text-sm font-medium text-foreground mb-2">{nextAction.next_step}</p>
                  {nextAction.topic && (
                    <Badge variant="secondary" className="text-xs">
                      {nextAction.topic}
                    </Badge>
                  )}
                </div>

                {nextAction.reason.length > 0 && (
                  <div className="space-y-1">
                    {nextAction.reason.map((r, i) => (
                      <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <ChevronRight className="h-3 w-3 text-primary mt-0.5 shrink-0" />{r}
                      </p>
                    ))}
                  </div>
                )}

                {nextAction.confidence_gap_alert && (
                  <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-3 py-2 text-xs text-orange-600 dark:text-orange-400 flex items-center gap-2">
                    <AlertTriangle className="h-3 w-3" />
                    Overconfidence pattern detected
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Complete a session to get your next action.</p>
            )}

            {weakPoints.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Weak Topics</p>
                <div className="space-y-2">
                  {weakPoints.slice(0, 4).map((wp) => (
                    <div key={wp.topic} className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${wp.dangerous_misconception ? "bg-destructive" : "bg-orange-500"}`} />
                      <span className="text-xs text-muted-foreground flex-1 truncate">{wp.topic}</span>
                      <span className="text-xs font-medium text-foreground">{Math.round((wp.accuracy_rate || 0) * 100)}%</span>
                      {wp.accuracy_trend !== undefined && wp.accuracy_trend !== null && (
                        <TrendingUp className={`h-3 w-3 ${wp.accuracy_trend >= 0 ? "text-emerald-500" : "text-destructive rotate-180"}`} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* AI INSIGHT tab */}
        {insightTab === "insight" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">AI Insight</p>
              <Button variant="ghost" size="sm" onClick={handleRefreshInsight} className="h-auto py-1 px-2 text-xs">
                <RefreshCw className="h-3 w-3 mr-1" />
                Refresh
              </Button>
            </div>

            {aiInsightStatus === "loading" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Generating insight...
              </div>
            )}

            {aiInsightStatus === "no_data" && (
              <p className="text-xs text-muted-foreground">Complete at least one session to unlock AI insights.</p>
            )}

            {aiInsightStatus === "error" && (
              <p className="text-xs text-destructive">Could not load insight. Try refreshing.</p>
            )}

            {aiInsight && (aiInsightStatus === "fresh" || aiInsightStatus === "stale") && (
              <div className="space-y-3">
                <Badge variant={aiInsight.urgency_level === "critical" ? "destructive" : aiInsight.urgency_level === "elevated" ? "secondary" : "outline"}>
                  {aiInsight.urgency_level}
                </Badge>

                <div className="rounded-xl bg-primary/5 border border-primary/20 p-4">
                  <p className="text-sm text-foreground leading-relaxed">{aiInsight.personalized_message}</p>
                </div>

                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">Study Now</p>
                  <p className="text-xs text-foreground">{aiInsight.next_topic_to_study}</p>
                </div>

                {aiInsight.critical_insight && (
                  <div className="rounded-lg bg-muted px-3 py-2">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Hidden Pattern</p>
                    <p className="text-xs text-foreground">{aiInsight.critical_insight}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* DAILY PLAN tab */}
        {insightTab === "plan" && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground">3-Day Study Plan</p>
            {aiInsight?.daily_plan && aiInsight.daily_plan.length > 0 ? (
              <div className="space-y-3">
                {aiInsight.daily_plan.map((day) => (
                  <div key={day.day} className="rounded-xl border p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-foreground">Day {day.day}</span>
                      <div className="flex items-center gap-2">
                        <Badge variant={day.priority === "critical" ? "destructive" : day.priority === "high" ? "secondary" : "outline"} className="text-xs">
                          {day.priority}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{day.question_count}q</span>
                      </div>
                    </div>
                    <p className="text-sm text-muted-foreground">{day.focus}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Complete a session to generate your personalized plan.</p>
            )}
          </div>
        )}

        {/* WEEKLY QUIZ tab */}
        {insightTab === "quiz" && (
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground">Weekly Review Quiz</p>
            {weeklyQuiz?.assignment_id ? (
              <div className="rounded-xl border p-4 space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {weeklyQuiz.questions.length} questions ready
                </p>
                {weeklyQuiz.weak_topics.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Covering: {weeklyQuiz.weak_topics.slice(0, 3).join(", ")}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button asChild className="flex-1" size="sm">
                    <Link href={`/quiz/${lectureId}?weekly=${weeklyQuiz.assignment_id}`}>
                      Start Quiz
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDismissQuiz}>
                    Dismiss
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <Target className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  Answer 3+ questions in weak topics to unlock your weekly quiz.
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="text-xl font-bold text-foreground">
            cortexQ
          </Link>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <TimerDisplay startRef={sessionStartRef} />
            </div>

            {shareToken && (totalViews > 0 || activeViewers > 0) && (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted">
                {totalViews > 0 && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Eye className="h-3 w-3" />{totalViews}
                  </span>
                )}
                {activeViewers > 0 && (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-500">
                    <Users className="h-3 w-3" />
                    {activeViewers} live
                  </span>
                )}
              </div>
            )}

            <div className="hidden md:flex items-center gap-2">
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                {saveStatus === "saving" && <Loader2 className="h-3 w-3 animate-spin" />}
                {saveStatus === "saved" && <Cloud className="h-3 w-3 text-emerald-500" />}
                {saveStatus === "idle" && <CloudOff className="h-3 w-3" />}
              </div>
              
              <Button variant="outline" size="sm" asChild>
                <Link href={`/quiz/${lectureId}`}>
                  <Zap className="h-4 w-4" />
                  Quiz Mode
                </Link>
              </Button>
              
              <Button
                variant={copied ? "default" : "outline"}
                size="sm"
                onClick={shareToken ? handleCopyLink : handleShare}
                disabled={sharing}
              >
                {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
                {copied ? "Copied!" : "Share"}
              </Button>
              
              <Button
                variant={shuffleMode ? "default" : "outline"}
                size="sm"
                onClick={handleToggleShuffle}
              >
                <Shuffle className="h-4 w-4" />
              </Button>
              
              <Button variant="ghost" size="sm" onClick={handleProcess} disabled={processing}>
                <RefreshCw className={`h-4 w-4 ${processing ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <ChevronRight className="h-4 w-4" />
          <span className="text-foreground">Lecture #{lectureId}</span>
        </nav>

        {/* Title */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-3">Study Materials</h1>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                <BookOpen className="h-3 w-3 mr-1" />
                {totalCount} MCQs
              </Badge>
              <Badge variant="outline">
                <Calendar className="h-3 w-3 mr-1" />
                {new Date(results.created_at).toLocaleDateString()}
              </Badge>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ActiveTab)} className="mb-8">
          <TabsList>
            <TabsTrigger value="mcqs">MCQs</TabsTrigger>
            <TabsTrigger value="summary">Summary</TabsTrigger>
            <TabsTrigger value="concepts">Key Concepts</TabsTrigger>
          </TabsList>
        </Tabs>

        {error && error !== "not_found" && (
          <div className="mb-6 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar */}
          <div className="lg:col-span-4 space-y-6">
            {/* Score panel */}
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground mb-2">Performance</p>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-5xl font-bold text-foreground">{score}</span>
                  <span className="text-xl text-muted-foreground">/ {totalCount}</span>
                </div>
                <Progress value={totalCount > 0 ? (score / totalCount) * 100 : 0} className="h-2 mb-4" />
                
                {answeredCount > 0 && (
                  <p className="text-sm text-muted-foreground mb-2">
                    {scorePercent}% accuracy - {answeredCount}/{totalCount} answered
                  </p>
                )}
                {retakeCount > 0 && (
                  <p className="text-xs text-muted-foreground mb-4">
                    {retakeCount} retake{retakeCount !== 1 ? "s" : ""} completed
                  </p>
                )}

                {confirmRetake ? (
                  <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-4 mb-4">
                    <p className="text-sm font-medium text-foreground mb-1">Clear all answers?</p>
                    <p className="text-xs text-muted-foreground mb-3">Your current progress will be lost.</p>
                    <div className="flex gap-2">
                      <Button variant="destructive" size="sm" className="flex-1" onClick={handleReset}>
                        Yes, retake
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" onClick={() => setConfirmRetake(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-3">
                  <Button
                    className="flex-1"
                    onClick={() => answeredCount > 0 ? setConfirmRetake(true) : handleReset()}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Retake
                  </Button>
                  <Button
                    variant={shuffleMode ? "default" : "outline"}
                    size="icon"
                    onClick={handleToggleShuffle}
                  >
                    <Shuffle className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <PerformanceSidebar />

            {results.key_concepts.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-medium">Key Concepts</CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-2">
                    {results.key_concepts.slice(0, 6).map((concept, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">
                        {concept}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Main content */}
          <div className="lg:col-span-8 space-y-6">
            {activeTab === "mcqs" && (
              shuffleMode ? (
                <MCQList mcqs={shuffledMcqs} />
              ) : (
                Object.entries(grouped).map(([topic, mcqs]) => (
                  <div key={topic}>
                    <div className="flex items-center gap-3 mb-4">
                      <h3 className="font-semibold text-foreground">{topic}</h3>
                      <Badge variant="outline" className="text-xs">{mcqs.length} questions</Badge>
                    </div>
                    <MCQList mcqs={mcqs as Array<MCQ & { _index: number }>} />
                  </div>
                ))
              )
            )}

            {activeTab === "summary" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-primary" />
                    Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-relaxed">{results.summary}</p>
                </CardContent>
              </Card>
            )}

            {activeTab === "concepts" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Lightbulb className="h-5 w-5 text-primary" />
                    High-Yield Key Concepts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-3">
                    {results.key_concepts.map((concept, i) => (
                      <Badge key={i} variant="secondary" className="px-4 py-2 text-sm">
                        {concept}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Score banner */}
            {answeredCount === totalCount && totalCount > 0 && activeTab === "mcqs" && (
              <Card className={`border-l-4 ${scorePercent >= 70 ? "border-l-emerald-500" : "border-l-orange-500"}`}>
                <CardContent className="p-6 flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-foreground text-lg">
                      {scorePercent >= 70 ? "Great work!" : "Keep studying!"} - {score}/{totalCount} ({scorePercent}%)
                    </p>
                    <p className="text-muted-foreground text-sm mt-1">
                      {scorePercent >= 70 ? "You&apos;re well-prepared for this topic." : "Review the explanations for questions you missed."}
                    </p>
                  </div>
                  <Button onClick={() => setConfirmRetake(true)}>
                    Retake
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      {/* Mobile tools bar */}
      <div className="md:hidden fixed bottom-14 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur">
        <div className="flex justify-around items-center py-2 px-4">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/quiz/${lectureId}`}>
              <Zap className="h-4 w-4" />
              Quiz
            </Link>
          </Button>
          <Button
            variant={shuffleMode ? "default" : "outline"}
            size="sm"
            onClick={handleToggleShuffle}
          >
            <Shuffle className="h-4 w-4" />
            {shuffleMode ? "Sectioned" : "Shuffle"}
          </Button>
          <Button
            variant={copied ? "default" : "outline"}
            size="sm"
            onClick={shareToken ? handleCopyLink : handleShare}
            disabled={sharing}
          >
            {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
            {copied ? "Copied" : "Share"}
          </Button>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background">
        <div className="flex justify-around items-center py-3 px-4">
          <Link href="/dashboard" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <Home className="h-5 w-5" />
            <span className="text-xs">Home</span>
          </Link>
          <div className="flex flex-col items-center gap-1 text-primary">
            <Upload className="h-5 w-5" />
            <span className="text-xs">Upload</span>
          </div>
          <Link href="/analytics" className="flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
            <BarChart3 className="h-5 w-5" />
            <span className="text-xs">Stats</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}
