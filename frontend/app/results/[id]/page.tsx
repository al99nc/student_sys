"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  getResults, processLecture, createShareLink, getActiveViewers,
  getQuizSession, saveQuizSession, retakeQuizSession,
  getPerformanceQuestions, savePerformanceQuestions,
  startPerformanceSession, submitPerformanceAnswer, completePerformanceSession,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { api } from "@/lib/api";
import { StepNav } from "@/components/step-nav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Share2, Shuffle, RefreshCw, Check, X,
  ChevronRight, Home, BarChart3, Zap, BookOpen, Lightbulb,
  Brain, Target, TrendingUp, AlertTriangle, Calendar,
  CheckCircle2, XCircle, Cloud, CloudOff, Loader2,
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

const CONFIDENCE_OPTIONS: { value: Confidence; label: string }[] = [
  { value: "guessed",   label: "Guessed"   },
  { value: "unsure",    label: "Unsure"    },
  { value: "confident", label: "Confident" },
];

const CONF_CLASS: Record<Confidence, string> = {
  guessed:   "bg-orange-400/10 border-orange-400/30 text-orange-400",
  unsure:    "bg-yellow-400/10 border-yellow-400/30 text-yellow-400",
  confident: "bg-emerald-400/10 border-emerald-400/30 text-emerald-400",
};

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
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [startRef]);
  const m = Math.floor(elapsed / 60).toString().padStart(2, "0");
  const s = (elapsed % 60).toString().padStart(2, "0");
  return <span className="font-mono text-[13px] text-muted-foreground tabular-nums">{m}:{s}</span>;
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

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [results, setResults]       = useState<Results | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [processing, setProcessing] = useState(false);

  const [answers, setAnswers]           = useState<Record<number, AnswerEntry>>({});
  const [pendingAnswer, setPendingAnswer] = useState<{ globalIndex: number; letter: string } | null>(null);
  const [score, setScore]               = useState(0);
  const [shuffleMode, setShuffleMode]   = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [shuffledMcqs, setShuffledMcqs]   = useState<Array<MCQ & { _index: number }>>([]);
  const [activeTab, setActiveTab]       = useState<ActiveTab>("mcqs");
  const [shareToken, setShareToken]     = useState<string | null>(null);
  const [copied, setCopied]             = useState(false);
  const [activeViewers, setActiveViewers] = useState(0);
  const [totalViews, setTotalViews]     = useState(0);
  const [sharing, setSharing]           = useState(false);
  const [saveStatus, setSaveStatus]     = useState<"idle" | "saving" | "saved">("idle");
  const [retakeCount, setRetakeCount]   = useState(0);

  const [weakPoints, setWeakPoints]   = useState<WeakPoint[]>([]);
  const [readiness, setReadiness]     = useState<Readiness | null>(null);
  const [nextAction, setNextAction]   = useState<NextAction | null>(null);
  const [weeklyQuiz, setWeeklyQuiz]   = useState<WeeklyQuiz | null>(null);
  const [aiInsight, setAiInsight]     = useState<AiInsight | null>(null);
  const [aiInsightStatus, setAiInsightStatus] = useState<"loading" | "fresh" | "stale" | "no_data" | "error">("loading");
  const [insightTab, setInsightTab]   = useState<"next" | "insight" | "plan" | "quiz">("next");

  const sessionStartRef     = useRef<number>(Date.now());
  const viewerPollRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasScrolledToResume = useRef(false);
  const perfSessionId       = useRef<string | null>(null);
  const perfQuestionMap     = useRef<Record<string, string>>({});
  const questionStartTime   = useRef<number>(Date.now());
  const confidenceStartTime = useRef<number>(Date.now());
  const firstAnswerTime     = useRef<number | null>(null);
  const firstAnswerLetter   = useRef<string | null>(null);
  const hoverStartRef       = useRef<{ letter: string; at: number } | null>(null);
  const liveTimelineRef     = useRef<LiveTimeline>({
    time_on_option_a: 0, time_on_option_b: 0,
    time_on_option_c: 0, time_on_option_d: 0,
    second_choice: null, re_read_question: false, re_read_count: 0,
  });
  const nextQueueRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    fetchResults();
  }, [lectureId, router]);

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
      setWeakPoints(wp); setReadiness(rd); setNextAction(na);
    } catch {}
  }, []);

  useEffect(() => {
    if (loading || hasScrolledToResume.current || !results || Object.keys(answers).length === 0 || shuffleMode) return;
    const firstUnanswered = results.mcqs.findIndex((_, i) => answers[i] === undefined);
    if (firstUnanswered === -1) return;
    hasScrolledToResume.current = true;
    setTimeout(() => {
      document.getElementById(`mcq-${firstUnanswered}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 300);
  }, [answers, results, shuffleMode, loading]);

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

  const fetchResults = async () => {
    try {
      const res = await getResults(lectureId);
      if (res.data.has_essays && !(res.data.mcqs?.length)) {
        router.replace(`/quiz/solved/${lectureId}`);
        return;
      }
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
    if (hoverStartRef.current) handleOptionHoverEnd(hoverStartRef.current.letter);
    setPendingAnswer({ globalIndex, letter });
    confidenceStartTime.current = Date.now();
    setTimeout(() => {
      document.getElementById(`confidence-${globalIndex}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
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
    const displayOrder = shuffleMode
      ? shuffledMcqs.map(m => m._index)
      : Object.values(groupByTopic(results.mcqs)).flatMap(mcqs =>
          (mcqs as Array<MCQ & { _index: number }>).map(m => m._index)
        );
    const currentPos = displayOrder.indexOf(globalIndex);
    const nextVisualIdx = displayOrder.slice(currentPos + 1).find(idx => updated[idx] === undefined);
    if (nextVisualIdx !== undefined) {
      setTimeout(() => {
        document.getElementById(`mcq-${nextVisualIdx}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    }
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
          await submitPerformanceAnswer(perfSessionId.current!, questionId, letter, mcq.answer, timeSpent, {
            pre_answer_confidence: CONFIDENCE_TO_INT[confidence],
            time_to_confidence: timeToConfidence,
            answer_changed: answerChanged,
            original_answer: originalAnswer,
            time_to_first_change: timeToFirstChange,
            answer_timeline: {
              time_on_option_a: timeline.time_on_option_a, time_on_option_b: timeline.time_on_option_b,
              time_on_option_c: timeline.time_on_option_c, time_on_option_d: timeline.time_on_option_d,
              second_choice: timeline.second_choice, re_read_question: timeline.re_read_question,
              re_read_count: timeline.re_read_count,
            },
          });
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
  }, [pendingAnswer, answers, results, lectureId, shuffleMode, shuffledMcqs, prefetchNextQuestion, refreshSidebarAfterAnswer, resetLiveTimeline]);

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
      const data = await perfGet<{ status: string; insight: AiInsight | null }>("/students/me/ai-insight?force=true");
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

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────────

  if (error === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="max-w-sm w-full bg-card rounded-2xl border border-border p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-6">
            <AlertTriangle className="w-7 h-7 text-muted-foreground" />
          </div>
          <h2 className="text-[22px] font-extrabold tracking-tight text-foreground mb-2">Not Processed Yet</h2>
          <p className="text-sm text-muted-foreground mb-7 leading-relaxed">
            Generate study materials for this lecture to get started.
          </p>
          <Button onClick={handleProcess} disabled={processing} size="lg" className="w-full">
            {processing
              ? <><Loader2 className="w-4 h-4 animate-spin" />Processing...</>
              : "Generate Study Materials"}
          </Button>
        </div>
      </div>
    );
  }

  if (!results) return null;

  const answeredCount = Object.keys(answers).length;
  const totalCount    = results.mcqs.length;
  const grouped       = groupByTopic(results.mcqs);
  const scorePercent  = totalCount > 0 ? Math.round((score / totalCount) * 100) : 0;

  // ── MCQ List ─────────────────────────────────────────────────────────────────

  const MCQList = ({ mcqs }: { mcqs: Array<MCQ & { _index: number }> }) => (
    <div className="flex flex-col gap-3.5">
      {mcqs.map((mcq, displayIdx) => {
        const globalIdx  = mcq._index;
        const answered   = answers[globalIdx];
        const isPending  = pendingAnswer?.globalIndex === globalIdx;
        const isAnswered = answered !== undefined;
        const isCorrect  = answered?.letter === mcq.answer;

        return (
          <div
            key={globalIdx}
            id={`mcq-${globalIdx}`}
            className={cn(
              "bg-muted/5 border border-border rounded-2xl px-[22px] py-5 scroll-mt-[72px] transition-colors",
              isAnswered && isCorrect  && "border-l-[3px] border-l-emerald-400",
              isAnswered && !isCorrect && "border-l-[3px] border-l-red-400",
              isPending  && !isAnswered && "border-l-[3px] border-l-violet-500"
            )}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-3.5">
              <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40 px-2.5 py-1 bg-muted/20 border border-border rounded-[7px]">
                Q{String(displayIdx + 1).padStart(2, "0")}
              </span>
              {isAnswered && (
                <span className={cn(
                  "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border",
                  isCorrect
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                    : "bg-red-500/10 text-red-400 border-red-500/25"
                )}>
                  {isCorrect ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {isCorrect ? "Correct" : "Incorrect"}
                </span>
              )}
            </div>

            {/* Question */}
            <p
              className="text-sm font-medium text-foreground mb-4 leading-relaxed"
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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {mcq.options.map((option, j) => {
                const letter = option.charAt(0);
                const isThisSelected = answered?.letter === letter || (isPending && pendingAnswer?.letter === letter);
                const isThisCorrect  = letter === mcq.answer;

                return (
                  <button
                    key={j}
                    onClick={() => !isAnswered && !isPending && handleSelectAnswer(globalIdx, letter)}
                    onMouseEnter={() => { if (!isAnswered) handleOptionHoverStart(letter); }}
                    onMouseLeave={() => { if (!isAnswered) handleOptionHoverEnd(letter); }}
                    disabled={isAnswered || isPending}
                    className={cn(
                      "px-3.5 py-2.5 rounded-xl text-[13px] text-left transition-all border flex justify-between items-center gap-2 leading-snug",
                      isAnswered ? (
                        isThisCorrect
                          ? "bg-emerald-500/10 border-emerald-500/30 text-foreground cursor-default"
                          : isThisSelected
                            ? "bg-red-500/10 border-red-500/30 text-muted-foreground cursor-default"
                            : "bg-muted/10 border-border text-muted-foreground/30 cursor-default"
                      ) : isPending ? (
                        isThisSelected
                          ? "bg-violet-600/10 border-violet-500/35 text-foreground cursor-default"
                          : "bg-muted/10 border-border text-muted-foreground cursor-default"
                      ) : "bg-muted/15 border-border text-muted-foreground hover:bg-violet-600/10 hover:border-violet-500/30 hover:text-violet-300 cursor-pointer"
                    )}
                  >
                    <span>{option}</span>
                    {isAnswered && isThisCorrect   && <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                    {isAnswered && isThisSelected && !isThisCorrect && <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Confidence prompt */}
            {isPending && (
              <div id={`confidence-${globalIdx}`} className="mt-4 rounded-xl border border-violet-600/25 bg-violet-600/5 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Brain className="w-3.5 h-3.5 text-violet-500" />
                  <p className="text-sm font-semibold text-foreground">How confident were you?</p>
                </div>
                <p className="text-xs text-muted-foreground mb-3.5">Your answer is locked in — this helps track your learning.</p>
                <div className="flex gap-2 flex-wrap">
                  {CONFIDENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleConfidence(opt.value)}
                      className={cn("px-4 py-1.5 rounded-[10px] text-[13px] font-semibold cursor-pointer transition-opacity hover:opacity-80 border", CONF_CLASS[opt.value])}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Explanation */}
            {isAnswered && mcq.explanation && (
              <div className={cn(
                "mt-3.5 p-3.5 rounded-xl border text-sm",
                isCorrect
                  ? "bg-emerald-500/5 border-emerald-500/20"
                  : "bg-violet-600/5 border-violet-600/20"
              )}>
                <p className="text-muted-foreground leading-relaxed mb-2">
                  <span className="font-semibold text-foreground">Answer: {mcq.answer}</span>
                  {" — "}{mcq.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
                </p>
                {answered.confidence && (
                  <span className={cn("inline-block px-2.5 py-1 rounded-[7px] text-[11px] font-semibold border", CONF_CLASS[answered.confidence])}>
                    {CONFIDENCE_OPTIONS.find(o => o.value === answered.confidence)?.label}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Performance Sidebar ───────────────────────────────────────────────────────

  const PerformanceSidebar = () => (
    <Card className="overflow-hidden p-0">
      {/* Tabs */}
      <div className="flex border-b border-border">
        {(["next", "insight", "plan", "quiz"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setInsightTab(t)}
            className={cn(
              "flex-1 py-2.5 text-[11px] font-bold uppercase tracking-wider border-0 border-b-2 cursor-pointer transition-all",
              insightTab === t
                ? "bg-violet-600/10 border-b-violet-500 text-violet-300"
                : "border-b-transparent text-muted-foreground/40 hover:text-muted-foreground"
            )}
          >
            {t === "next" ? "Next" : t === "insight" ? "AI" : t === "plan" ? "Plan" : "Quiz"}
          </button>
        ))}
      </div>

      <div className="p-4 flex flex-col gap-3.5">

        {/* NEXT tab */}
        {insightTab === "next" && (
          <div className="flex flex-col gap-3.5">
            {readiness && (
              <div className="rounded-xl bg-muted/20 border border-border p-3.5">
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs text-muted-foreground">Readiness Score</span>
                  <span className="text-2xl font-extrabold text-foreground leading-none">{Math.round(readiness.readiness_score)}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-2.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-400 transition-all duration-700"
                    style={{ width: `${readiness.readiness_score}%` }}
                  />
                </div>
                <div className="flex justify-between text-[11px] text-muted-foreground/50">
                  <span>{readiness.weak_topics_count} weak</span>
                  <span>{readiness.strong_topics_count} strong</span>
                  <span>{readiness.total_questions_answered} answered</span>
                </div>
              </div>
            )}

            {nextAction ? (
              <div className="flex flex-col gap-2.5">
                <div className="rounded-xl bg-violet-600/5 border border-violet-600/20 p-3.5">
                  <p className="text-[11px] font-bold text-violet-400 uppercase tracking-widest mb-1.5">Recommended Now</p>
                  <p className={cn("text-[13px] font-semibold text-foreground", nextAction.topic && "mb-2.5")}>{nextAction.next_step}</p>
                  {nextAction.topic && (
                    <Badge variant="secondary" className="text-[11px]">{nextAction.topic}</Badge>
                  )}
                </div>
                {nextAction.reason.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {nextAction.reason.map((r, i) => (
                      <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                        <ChevronRight className="w-3 h-3 text-violet-500 mt-0.5 flex-shrink-0" />{r}
                      </p>
                    ))}
                  </div>
                )}
                {nextAction.confidence_gap_alert && (
                  <div className="rounded-[9px] bg-orange-400/10 border border-orange-400/25 px-3 py-2 text-xs text-orange-400 flex items-center gap-2">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    Overconfidence pattern detected
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50">Complete a session to get your next action.</p>
            )}

            {weakPoints.length > 0 && (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-2.5">Weak Topics</p>
                <div className="flex flex-col gap-2">
                  {weakPoints.slice(0, 4).map((wp) => (
                    <div key={wp.topic} className="flex items-center gap-2">
                      <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", wp.dangerous_misconception ? "bg-red-400" : "bg-orange-400")} />
                      <span className="text-xs text-muted-foreground flex-1 truncate">{wp.topic}</span>
                      <span className="text-xs font-semibold text-foreground">{Math.round((wp.accuracy_rate || 0) * 100)}%</span>
                      {wp.accuracy_trend !== undefined && wp.accuracy_trend !== null && (
                        <TrendingUp className={cn("w-3 h-3 flex-shrink-0", wp.accuracy_trend >= 0 ? "text-emerald-400" : "text-red-400 rotate-180")} />
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
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">AI Insight</p>
              <Button variant="outline" size="sm" onClick={handleRefreshInsight} className="h-7 text-xs gap-1.5">
                <RefreshCw className="w-3 h-3" />Refresh
              </Button>
            </div>
            {aiInsightStatus === "loading" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />Generating insight...
              </div>
            )}
            {aiInsightStatus === "no_data"  && <p className="text-xs text-muted-foreground/50">Complete at least one session to unlock AI insights.</p>}
            {aiInsightStatus === "error"    && <p className="text-xs text-red-400">Could not load insight. Try refreshing.</p>}
            {aiInsight && (aiInsightStatus === "fresh" || aiInsightStatus === "stale") && (
              <div className="flex flex-col gap-3">
                <span className={cn(
                  "inline-block px-3 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider border w-fit",
                  aiInsight.urgency_level === "critical" ? "bg-red-500/10 text-red-400 border-red-500/25"
                  : aiInsight.urgency_level === "elevated" ? "bg-orange-400/10 text-orange-400 border-orange-400/25"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                )}>
                  {aiInsight.urgency_level}
                </span>
                <div className="rounded-xl bg-violet-600/5 border border-violet-600/20 p-3.5">
                  <p className="text-[13px] text-foreground leading-relaxed">{aiInsight.personalized_message}</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">Study Now</p>
                  <p className="text-[13px] text-muted-foreground">{aiInsight.next_topic_to_study}</p>
                </div>
                {aiInsight.critical_insight && (
                  <div className="rounded-[10px] bg-muted/20 border border-border p-3">
                    <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-1.5">Hidden Pattern</p>
                    <p className="text-[13px] text-muted-foreground">{aiInsight.critical_insight}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* PLAN tab */}
        {insightTab === "plan" && (
          <div className="flex flex-col gap-3.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40">3-Day Study Plan</p>
            {aiInsight?.daily_plan && aiInsight.daily_plan.length > 0 ? (
              <div className="flex flex-col gap-2">
                {aiInsight.daily_plan.map((day) => (
                  <div key={day.day} className="rounded-xl border border-border bg-muted/10 p-3.5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[13px] font-semibold text-foreground">Day {day.day}</span>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border",
                          day.priority === "critical" ? "bg-red-500/10 text-red-400 border-red-500/20"
                          : day.priority === "high"   ? "bg-orange-400/10 text-orange-400 border-orange-400/20"
                          :                             "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                        )}>
                          {day.priority}
                        </span>
                        <span className="text-[11px] text-muted-foreground">{day.question_count}q</span>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{day.focus}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground/50">Complete a session to generate your personalized plan.</p>
            )}
          </div>
        )}

        {/* QUIZ tab */}
        {insightTab === "quiz" && (
          <div className="flex flex-col gap-3.5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40">Weekly Review Quiz</p>
            {weeklyQuiz?.assignment_id ? (
              <div className="rounded-xl border border-border bg-muted/10 p-4 flex flex-col gap-3">
                <p className="text-[13px] font-semibold text-foreground">{weeklyQuiz.questions.length} questions ready</p>
                {weeklyQuiz.weak_topics.length > 0 && (
                  <p className="text-xs text-muted-foreground">Covering: {weeklyQuiz.weak_topics.slice(0, 3).join(", ")}</p>
                )}
                <div className="flex gap-2">
                  <Button asChild className="flex-1" size="sm">
                    <Link href={`/quiz/${lectureId}?weekly=${weeklyQuiz.assignment_id}`}>Start Quiz</Link>
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDismissQuiz}>Dismiss</Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <Target className="w-7 h-7 text-muted-foreground/40 mx-auto mb-2.5" />
                <p className="text-xs text-muted-foreground/50">Answer 3+ questions in weak topics to unlock your weekly quiz.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className={cn("min-h-screen bg-background text-foreground", isMobile ? "pb-[120px]" : "pb-12")}>

      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
            <div className="w-8 h-8 rounded-[10px] bg-violet-600 flex items-center justify-center text-[11px] font-black text-white flex-shrink-0">
              cQ
            </div>
            {!isMobile && <span className="text-foreground font-bold text-sm">CortexQ</span>}
          </Link>

          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl border border-border bg-muted/20 flex items-center justify-center">
              {saveStatus === "saving" && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
              {saveStatus === "saved"  && <Cloud    className="w-[18px] h-[18px] text-emerald-400" />}
              {saveStatus === "idle"   && <CloudOff className="w-[18px] h-[18px] text-muted-foreground" />}
            </div>
          </div>
        </div>
        <StepNav steps={[{ label: "Dashboard", href: "/dashboard" }, { label: `Lecture #${lectureId}` }]} />
      </header>

      <main className={cn("max-w-7xl mx-auto", isMobile ? "px-3.5 py-5" : "px-5 py-7")}>

        {/* Title */}
        <div className="mb-6">
          <h1 className={cn("font-extrabold tracking-tight text-foreground mb-3", isMobile ? "text-[22px]" : "text-[28px]")}>
            Study Materials
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <BookOpen className="w-3 h-3" />{totalCount} MCQs
            </Badge>
            <Badge variant="outline" className="gap-1.5 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />{new Date(results.created_at).toLocaleDateString()}
            </Badge>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-muted/10 border border-border rounded-xl w-fit mb-6">
          {(["mcqs", "summary", "concepts"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-1.5 rounded-[9px] text-[13px] font-semibold border-0 cursor-pointer transition-all",
                activeTab === tab
                  ? "bg-violet-600/15 text-violet-300"
                  : "bg-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {tab === "mcqs" ? "MCQs" : tab === "summary" ? "Summary" : "Key Concepts"}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && error !== "not_found" && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl px-4 py-3 text-[13px]">
            {error}
          </div>
        )}

        {/* Content grid */}
        <div className={cn("grid gap-5 items-start", isMobile ? "grid-cols-1" : "grid-cols-[300px_1fr]")}>

          {/* Sidebar */}
          <div className="flex flex-col gap-4">

            {/* Score panel */}
            <Card>
              <CardHeader className="pb-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40">Performance</p>
              </CardHeader>
              <CardContent className="pt-2">
                <div className="flex items-baseline gap-2 mb-3.5">
                  <span className="text-5xl font-extrabold text-foreground leading-none">{score}</span>
                  <span className="text-lg text-muted-foreground">/ {totalCount}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-400 transition-all duration-700"
                    style={{ width: `${totalCount > 0 ? (score / totalCount) * 100 : 0}%` }}
                  />
                </div>
                {answeredCount > 0 && (
                  <p className="text-[13px] text-muted-foreground mb-1">{scorePercent}% accuracy — {answeredCount}/{totalCount} answered</p>
                )}
                {retakeCount > 0 && (
                  <p className="text-xs text-muted-foreground/40 mb-3.5">{retakeCount} retake{retakeCount !== 1 ? "s" : ""} completed</p>
                )}

                {confirmRetake && (
                  <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-3.5 mb-3.5">
                    <p className="text-[13px] font-semibold text-foreground mb-1">Clear all answers?</p>
                    <p className="text-xs text-muted-foreground mb-3">Your current progress will be lost.</p>
                    <div className="flex gap-2">
                      <Button onClick={handleReset} variant="destructive" size="sm" className="flex-1">Yes, retake</Button>
                      <Button onClick={() => setConfirmRetake(false)} variant="outline" size="sm" className="flex-1">Cancel</Button>
                    </div>
                  </div>
                )}

                <div className={cn("flex gap-2.5", confirmRetake ? "" : "mt-3.5")}>
                  <Button
                    onClick={() => answeredCount > 0 ? setConfirmRetake(true) : handleReset()}
                    size="sm"
                    className="flex-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />Retake
                  </Button>
                  <Button
                    onClick={handleToggleShuffle}
                    variant={shuffleMode ? "default" : "outline"}
                    size="sm"
                    className="w-10 px-0"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </CardContent>
            </Card>

            <PerformanceSidebar />

            {results.key_concepts.length > 0 && (
              <Card>
                <CardHeader className="pb-0">
                  <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40">Key Concepts</p>
                </CardHeader>
                <CardContent className="pt-3">
                  <div className="flex flex-wrap gap-1.5">
                    {results.key_concepts.slice(0, 6).map((concept, i) => (
                      <Badge key={i} variant="secondary" className="text-xs">{concept}</Badge>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Main content */}
          <div className="flex flex-col gap-4">

            {activeTab === "mcqs" && (
              shuffleMode
                ? <MCQList mcqs={shuffledMcqs} />
                : Object.entries(grouped).map(([topic, mcqs]) => (
                    <div key={topic}>
                      <div className="flex items-center gap-2.5 mb-3">
                        <h3 className="text-sm font-bold text-muted-foreground">{topic}</h3>
                        <Badge variant="outline" className="text-[11px] text-muted-foreground/50">
                          {mcqs.length} questions
                        </Badge>
                      </div>
                      <MCQList mcqs={mcqs as Array<MCQ & { _index: number }>} />
                    </div>
                  ))
            )}

            {activeTab === "summary" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2.5 text-base">
                    <BookOpen className="w-[17px] h-[17px] text-violet-500" />Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-[1.75]">{results.summary}</p>
                </CardContent>
              </Card>
            )}

            {activeTab === "concepts" && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2.5 text-base">
                    <Lightbulb className="w-[17px] h-[17px] text-violet-500" />High-Yield Key Concepts
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2.5">
                    {results.key_concepts.map((concept, i) => (
                      <span key={i} className="px-4 py-1.5 rounded-[10px] text-[13px] bg-violet-600/10 border border-violet-600/20 text-violet-300">
                        {concept}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Score banner */}
            {answeredCount === totalCount && totalCount > 0 && activeTab === "mcqs" && (
              <div className={cn(
                "bg-muted/5 border border-border border-l-[3px] rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap",
                scorePercent >= 70 ? "border-l-emerald-400" : "border-l-orange-400"
              )}>
                <div>
                  <p className="font-bold text-[15px] text-foreground mb-1">
                    {scorePercent >= 70 ? "Great work!" : "Keep studying!"} — {score}/{totalCount} ({scorePercent}%)
                  </p>
                  <p className="text-[13px] text-muted-foreground">
                    {scorePercent >= 70 ? "You're well-prepared for this topic." : "Review the explanations for questions you missed."}
                  </p>
                </div>
                <Button onClick={() => setConfirmRetake(true)} size="sm" className="flex-shrink-0">
                  Retake
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile tools bar */}
      {isMobile && (
        <div className="fixed bottom-14 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur flex justify-around items-center px-4 py-2.5 gap-2">
          <Button asChild variant="secondary" size="sm" className="gap-1.5 text-violet-300 bg-violet-600/10 border-violet-600/25 hover:bg-violet-600/15">
            <Link href={`/quiz/${lectureId}`}>
              <Zap className="w-3.5 h-3.5" />Quiz
            </Link>
          </Button>
          <Button
            onClick={handleToggleShuffle}
            variant={shuffleMode ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
          >
            <Shuffle className="w-3.5 h-3.5" />
            {shuffleMode ? "Sectioned" : "Shuffle"}
          </Button>
          <Button
            onClick={shareToken ? handleCopyLink : handleShare}
            disabled={sharing}
            variant={copied ? "default" : "outline"}
            size="sm"
            className="gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Share"}
          </Button>
        </div>
      )}

      {/* Mobile nav */}
      {isMobile && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background flex justify-around items-center px-4 pb-[max(10px,env(safe-area-inset-bottom))] pt-2.5">
          <Link href="/dashboard" className="flex flex-col items-center gap-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors no-underline">
            <Home className="w-5 h-5" /><span className="text-[11px]">Home</span>
          </Link>
          <div className="flex flex-col items-center gap-1 text-violet-500">
            <BookOpen className="w-5 h-5" /><span className="text-[11px]">Study</span>
          </div>
          <Link href="/analytics" className="flex flex-col items-center gap-1 text-muted-foreground/40 hover:text-muted-foreground transition-colors no-underline">
            <BarChart3 className="w-5 h-5" /><span className="text-[11px]">Stats</span>
          </Link>
        </nav>
      )}
    </div>
  );
}
