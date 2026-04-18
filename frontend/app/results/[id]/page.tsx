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
import {
  Clock, Eye, Users, Share2, Shuffle, RefreshCw, Check, X,
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
  { value: "guessed", label: "Guessed" },
  { value: "unsure",  label: "Unsure"  },
  { value: "confident", label: "Confident" },
];

const CONF_STYLE: Record<Confidence, { bg: string; border: string; color: string }> = {
  guessed:   { bg: "rgba(251,146,60,0.1)",  border: "rgba(251,146,60,0.3)",  color: "#fb923c" },
  unsure:    { bg: "rgba(250,204,21,0.1)",  border: "rgba(250,204,21,0.3)",  color: "#facc15" },
  confident: { bg: "rgba(74,222,128,0.1)",  border: "rgba(74,222,128,0.3)",  color: "#4ade80" },
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
  return (
    <span style={{ fontFamily: "monospace", fontSize: 13, color: "#64748b", fontVariantNumeric: "tabular-nums" }}>
      {m}:{s}
    </span>
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

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [results, setResults]         = useState<Results | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState("");
  const [processing, setProcessing]   = useState(false);

  const [answers, setAnswers]         = useState<Record<number, AnswerEntry>>({});
  const [pendingAnswer, setPendingAnswer] = useState<{ globalIndex: number; letter: string } | null>(null);
  const [score, setScore]             = useState(0);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [shuffledMcqs, setShuffledMcqs]   = useState<Array<MCQ & { _index: number }>>([]);
  const [activeTab, setActiveTab]     = useState<ActiveTab>("mcqs");
  const [shareToken, setShareToken]   = useState<string | null>(null);
  const [copied, setCopied]           = useState(false);
  const [activeViewers, setActiveViewers] = useState(0);
  const [totalViews, setTotalViews]   = useState(0);
  const [sharing, setSharing]         = useState(false);
  const [saveStatus, setSaveStatus]   = useState<"idle" | "saving" | "saved">("idle");
  const [retakeCount, setRetakeCount] = useState(0);

  const [weakPoints, setWeakPoints]   = useState<WeakPoint[]>([]);
  const [readiness, setReadiness]     = useState<Readiness | null>(null);
  const [nextAction, setNextAction]   = useState<NextAction | null>(null);
  const [weeklyQuiz, setWeeklyQuiz]   = useState<WeeklyQuiz | null>(null);
  const [aiInsight, setAiInsight]     = useState<AiInsight | null>(null);
  const [aiInsightStatus, setAiInsightStatus] = useState<"loading" | "fresh" | "stale" | "no_data" | "error">("loading");
  const [insightTab, setInsightTab]   = useState<"next" | "insight" | "plan" | "quiz">("next");

  const sessionStartRef   = useRef<number>(Date.now());
  const viewerPollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasScrolledToResume = useRef(false);
  const perfSessionId     = useRef<string | null>(null);
  const perfQuestionMap   = useRef<Record<string, string>>({});
  const questionStartTime = useRef<number>(Date.now());
  const confidenceStartTime = useRef<number>(Date.now());
  const firstAnswerTime   = useRef<number | null>(null);
  const firstAnswerLetter = useRef<string | null>(null);
  const hoverStartRef     = useRef<{ letter: string; at: number } | null>(null);
  const liveTimelineRef   = useRef<LiveTimeline>({
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
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0d0f1c" }}>
        <div style={{ width: 32, height: 32, borderRadius: "50%", border: "2px solid rgba(123,47,255,0.2)", borderTopColor: "#7B2FFF", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────────

  if (error === "not_found") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#0d0f1c", padding: 16 }}>
        <div style={{ maxWidth: 420, width: "100%", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 20, padding: 32, textAlign: "center" }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px" }}>
            <AlertTriangle size={28} style={{ color: "#64748b" }} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#e2e8f0", margin: "0 0 8px", letterSpacing: "-0.01em" }}>Not Processed Yet</h2>
          <p style={{ color: "#64748b", marginBottom: 28, lineHeight: 1.6 }}>Generate study materials for this lecture to get started.</p>
          <button
            onClick={handleProcess}
            disabled={processing}
            style={{ width: "100%", padding: "13px 0", borderRadius: 14, background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "white", fontWeight: 700, fontSize: 15, border: "none", cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.7 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit" }}
          >
            {processing ? <><Loader2 size={16} style={{ animation: "spin 0.8s linear infinite" }} /> Processing...</> : "Generate Study Materials"}
          </button>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {mcqs.map((mcq, displayIdx) => {
        const globalIdx = mcq._index;
        const answered  = answers[globalIdx];
        const isPending = pendingAnswer?.globalIndex === globalIdx;
        const isAnswered = answered !== undefined;
        const isCorrect  = answered?.letter === mcq.answer;

        const cardBorderLeft = isAnswered
          ? isCorrect ? "3px solid #4ade80" : "3px solid #f87171"
          : isPending ? "3px solid #7B2FFF"
          : "1px solid rgba(255,255,255,0.07)";

        return (
          <div
            key={globalIdx}
            id={`mcq-${globalIdx}`}
            style={{
              background: "rgba(255,255,255,0.028)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderLeft: cardBorderLeft,
              borderRadius: 16,
              padding: "20px 22px",
              scrollMarginTop: 72,
              transition: "border-color 0.2s",
            }}
          >
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "#3a3f60", padding: "3px 10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 7 }}>
                Q{String(displayIdx + 1).padStart(2, "0")}
              </span>
              {isAnswered && (
                <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 8, background: isCorrect ? "rgba(74,222,128,0.1)" : "rgba(248,113,113,0.1)", color: isCorrect ? "#4ade80" : "#f87171", border: `1px solid ${isCorrect ? "rgba(74,222,128,0.25)" : "rgba(248,113,113,0.25)"}` }}>
                  {isCorrect ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                  {isCorrect ? "Correct" : "Incorrect"}
                </span>
              )}
            </div>

            {/* Question */}
            <p
              style={{ fontSize: 14, fontWeight: 500, color: "#e2e8f0", marginBottom: 18, lineHeight: 1.65 }}
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
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 8 }}>
              {mcq.options.map((option, j) => {
                const letter = option.charAt(0);
                const isThisSelected = answered?.letter === letter || (isPending && pendingAnswer?.letter === letter);
                const isThisCorrect  = letter === mcq.answer;

                let optBg: string, optBorder: string, optColor: string;
                if (isAnswered) {
                  if (isThisCorrect)       { optBg = "rgba(74,222,128,0.08)";  optBorder = "rgba(74,222,128,0.3)";  optColor = "#e2e8f0"; }
                  else if (isThisSelected) { optBg = "rgba(248,113,113,0.08)"; optBorder = "rgba(248,113,113,0.3)"; optColor = "#94a3b8"; }
                  else                     { optBg = "rgba(255,255,255,0.02)"; optBorder = "rgba(255,255,255,0.06)"; optColor = "#3a3f60"; }
                } else if (isPending) {
                  if (isThisSelected)      { optBg = "rgba(123,47,255,0.12)";  optBorder = "rgba(123,47,255,0.35)"; optColor = "#e2e8f0"; }
                  else                     { optBg = "rgba(255,255,255,0.02)"; optBorder = "rgba(255,255,255,0.06)"; optColor = "#64748b"; }
                } else {
                  optBg = "rgba(255,255,255,0.03)"; optBorder = "rgba(255,255,255,0.08)"; optColor = "#94a3b8";
                }

                return (
                  <button
                    key={j}
                    onClick={() => !isAnswered && !isPending && handleSelectAnswer(globalIdx, letter)}
                    onMouseEnter={(e) => {
                      if (!isAnswered) handleOptionHoverStart(letter);
                      if (!isAnswered && !isPending) {
                        e.currentTarget.style.background = "rgba(123,47,255,0.09)";
                        e.currentTarget.style.borderColor = "rgba(123,47,255,0.3)";
                        e.currentTarget.style.color = "#c4b5fd";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isAnswered) handleOptionHoverEnd(letter);
                      if (!isAnswered && !isPending) {
                        e.currentTarget.style.background = optBg;
                        e.currentTarget.style.borderColor = optBorder;
                        e.currentTarget.style.color = optColor;
                      }
                    }}
                    disabled={isAnswered || isPending}
                    style={{
                      padding: "11px 14px",
                      borderRadius: 11,
                      fontSize: 13,
                      textAlign: "left",
                      transition: "all 0.15s",
                      border: `1px solid ${optBorder}`,
                      background: optBg,
                      color: optColor,
                      cursor: isAnswered || isPending ? "default" : "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 8,
                      fontFamily: "inherit",
                      lineHeight: 1.5,
                    }}
                  >
                    <span>{option}</span>
                    {isAnswered && isThisCorrect  && <Check size={13} style={{ color: "#4ade80", flexShrink: 0 }} />}
                    {isAnswered && isThisSelected && !isThisCorrect && <X size={13} style={{ color: "#f87171", flexShrink: 0 }} />}
                  </button>
                );
              })}
            </div>

            {/* Confidence prompt */}
            {isPending && (
              <div id={`confidence-${globalIdx}`} style={{ marginTop: 18, borderRadius: 13, border: "1px solid rgba(123,47,255,0.25)", background: "rgba(123,47,255,0.06)", padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <Brain size={14} style={{ color: "#7B2FFF" }} />
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", margin: 0 }}>How confident were you?</p>
                </div>
                <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 14px" }}>Your answer is locked in — this helps track your learning.</p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" as const }}>
                  {CONFIDENCE_OPTIONS.map((opt) => {
                    const cs = CONF_STYLE[opt.value];
                    return (
                      <button
                        key={opt.value}
                        onClick={() => handleConfidence(opt.value)}
                        style={{ padding: "7px 16px", borderRadius: 10, border: `1px solid ${cs.border}`, background: cs.bg, color: cs.color, fontSize: 13, fontWeight: 600, cursor: "pointer", transition: "opacity 0.15s", fontFamily: "inherit" }}
                        onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
                        onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Explanation */}
            {isAnswered && mcq.explanation && (
              <div style={{ marginTop: 14, padding: "13px 15px", borderRadius: 11, background: isCorrect ? "rgba(74,222,128,0.05)" : "rgba(123,47,255,0.05)", border: `1px solid ${isCorrect ? "rgba(74,222,128,0.18)" : "rgba(123,47,255,0.18)"}` }}>
                <p style={{ color: "#94a3b8", lineHeight: 1.65, margin: "0 0 8px", fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: "#e2e8f0" }}>Answer: {mcq.answer}</span>
                  {" — "}{mcq.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
                </p>
                {answered.confidence && (() => {
                  const cs = CONF_STYLE[answered.confidence];
                  return (
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, background: cs.bg, border: `1px solid ${cs.border}`, color: cs.color }}>
                      {CONFIDENCE_OPTIONS.find(o => o.value === answered.confidence)?.label}
                    </span>
                  );
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Performance Sidebar ───────────────────────────────────────────────────────

  const PerformanceSidebar = () => (
    <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
        {(["next", "insight", "plan", "quiz"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setInsightTab(t)}
            style={{
              flex: 1, padding: "11px 0", fontSize: 11, fontWeight: 700,
              textTransform: "uppercase" as const, letterSpacing: "0.06em",
              background: insightTab === t ? "rgba(123,47,255,0.1)" : "transparent",
              border: "none", borderBottom: `2px solid ${insightTab === t ? "#7B2FFF" : "transparent"}`,
              color: insightTab === t ? "#c4b5fd" : "#3a3f60",
              cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit",
            }}
          >
            {t === "next" ? "Next" : t === "insight" ? "AI" : t === "plan" ? "Plan" : "Quiz"}
          </button>
        ))}
      </div>

      <div style={{ padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>

        {/* NEXT tab */}
        {insightTab === "next" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {readiness && (
              <div style={{ borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", padding: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <span style={{ fontSize: 12, color: "#64748b" }}>Readiness Score</span>
                  <span style={{ fontSize: 26, fontWeight: 800, color: "#e2e8f0", lineHeight: 1 }}>{Math.round(readiness.readiness_score)}%</span>
                </div>
                <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginBottom: 10 }}>
                  <div style={{ height: "100%", borderRadius: 999, width: `${readiness.readiness_score}%`, background: "linear-gradient(90deg, #7B2FFF, #00D2FD)", transition: "width 0.8s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#3a3f60" }}>
                  <span>{readiness.weak_topics_count} weak</span>
                  <span>{readiness.strong_topics_count} strong</span>
                  <span>{readiness.total_questions_answered} answered</span>
                </div>
              </div>
            )}

            {nextAction ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ borderRadius: 12, background: "rgba(123,47,255,0.07)", border: "1px solid rgba(123,47,255,0.2)", padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#a78bfa", textTransform: "uppercase" as const, letterSpacing: "0.08em", margin: "0 0 6px" }}>Recommended Now</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", margin: nextAction.topic ? "0 0 10px" : 0 }}>{nextAction.next_step}</p>
                  {nextAction.topic && (
                    <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}>
                      {nextAction.topic}
                    </span>
                  )}
                </div>
                {nextAction.reason.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                    {nextAction.reason.map((r, i) => (
                      <p key={i} style={{ fontSize: 12, color: "#64748b", display: "flex", alignItems: "flex-start", gap: 6, margin: 0 }}>
                        <ChevronRight size={12} style={{ color: "#7B2FFF", marginTop: 2, flexShrink: 0 }} />{r}
                      </p>
                    ))}
                  </div>
                )}
                {nextAction.confidence_gap_alert && (
                  <div style={{ borderRadius: 9, background: "rgba(251,146,60,0.08)", border: "1px solid rgba(251,146,60,0.25)", padding: "8px 12px", fontSize: 12, color: "#fb923c", display: "flex", alignItems: "center", gap: 8 }}>
                    <AlertTriangle size={12} />
                    Overconfidence pattern detected
                  </div>
                )}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "#3a3f60" }}>Complete a session to get your next action.</p>
            )}

            {weakPoints.length > 0 && (
              <div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "#3a3f60", margin: "0 0 10px" }}>Weak Topics</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {weakPoints.slice(0, 4).map((wp) => (
                    <div key={wp.topic} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0, background: wp.dangerous_misconception ? "#f87171" : "#fb923c" }} />
                      <span style={{ fontSize: 12, color: "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const }}>{wp.topic}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{Math.round((wp.accuracy_rate || 0) * 100)}%</span>
                      {wp.accuracy_trend !== undefined && wp.accuracy_trend !== null && (
                        <TrendingUp size={12} style={{ color: wp.accuracy_trend >= 0 ? "#4ade80" : "#f87171", transform: wp.accuracy_trend >= 0 ? "none" : "rotate(180deg)", flexShrink: 0 }} />
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
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>AI Insight</p>
              <button
                onClick={handleRefreshInsight}
                style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 8, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#64748b", fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}
              >
                <RefreshCw size={11} />Refresh
              </button>
            </div>
            {aiInsightStatus === "loading" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#64748b" }}>
                <Loader2 size={13} style={{ animation: "spin 0.8s linear infinite" }} />
                Generating insight...
              </div>
            )}
            {aiInsightStatus === "no_data"  && <p style={{ fontSize: 12, color: "#3a3f60" }}>Complete at least one session to unlock AI insights.</p>}
            {aiInsightStatus === "error"    && <p style={{ fontSize: 12, color: "#f87171" }}>Could not load insight. Try refreshing.</p>}
            {aiInsight && (aiInsightStatus === "fresh" || aiInsightStatus === "stale") && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span style={{
                  display: "inline-block", padding: "4px 12px", borderRadius: 8, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em",
                  background: aiInsight.urgency_level === "critical" ? "rgba(248,113,113,0.12)" : aiInsight.urgency_level === "elevated" ? "rgba(251,146,60,0.12)" : "rgba(74,222,128,0.1)",
                  color: aiInsight.urgency_level === "critical" ? "#f87171" : aiInsight.urgency_level === "elevated" ? "#fb923c" : "#4ade80",
                  border: `1px solid ${aiInsight.urgency_level === "critical" ? "rgba(248,113,113,0.25)" : aiInsight.urgency_level === "elevated" ? "rgba(251,146,60,0.25)" : "rgba(74,222,128,0.2)"}`,
                }}>
                  {aiInsight.urgency_level}
                </span>
                <div style={{ borderRadius: 12, background: "rgba(123,47,255,0.06)", border: "1px solid rgba(123,47,255,0.18)", padding: 14 }}>
                  <p style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.65, margin: 0 }}>{aiInsight.personalized_message}</p>
                </div>
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "#3a3f60", margin: "0 0 6px" }}>Study Now</p>
                  <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>{aiInsight.next_topic_to_study}</p>
                </div>
                {aiInsight.critical_insight && (
                  <div style={{ borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", padding: 12 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "#3a3f60", margin: "0 0 6px" }}>Hidden Pattern</p>
                    <p style={{ fontSize: 13, color: "#94a3b8", margin: 0 }}>{aiInsight.critical_insight}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* PLAN tab */}
        {insightTab === "plan" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "#3a3f60", margin: 0 }}>3-Day Study Plan</p>
            {aiInsight?.daily_plan && aiInsight.daily_plan.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {aiInsight.daily_plan.map((day) => {
                  const pc = day.priority === "critical" ? "#f87171" : day.priority === "high" ? "#fb923c" : "#4ade80";
                  const pb = day.priority === "critical" ? "rgba(248,113,113,0.1)" : day.priority === "high" ? "rgba(251,146,60,0.1)" : "rgba(74,222,128,0.08)";
                  return (
                    <div key={day.day} style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", padding: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>Day {day.day}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase" as const, background: pb, color: pc, border: `1px solid ${pc}30` }}>{day.priority}</span>
                          <span style={{ fontSize: 11, color: "#64748b" }}>{day.question_count}q</span>
                        </div>
                      </div>
                      <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>{day.focus}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "#3a3f60" }}>Complete a session to generate your personalized plan.</p>
            )}
          </div>
        )}

        {/* QUIZ tab */}
        {insightTab === "quiz" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.08em", color: "#3a3f60", margin: 0 }}>Weekly Review Quiz</p>
            {weeklyQuiz?.assignment_id ? (
              <div style={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", margin: 0 }}>{weeklyQuiz.questions.length} questions ready</p>
                {weeklyQuiz.weak_topics.length > 0 && (
                  <p style={{ fontSize: 12, color: "#64748b", margin: 0 }}>Covering: {weeklyQuiz.weak_topics.slice(0, 3).join(", ")}</p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <Link href={`/quiz/${lectureId}?weekly=${weeklyQuiz.assignment_id}`} style={{ flex: 1, padding: "9px 0", borderRadius: 10, background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "white", fontWeight: 700, fontSize: 13, textDecoration: "none", textAlign: "center", display: "block" }}>
                    Start Quiz
                  </Link>
                  <button onClick={handleDismissQuiz} style={{ padding: "9px 14px", borderRadius: 10, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                    Dismiss
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: "center", padding: "24px 0" }}>
                <Target size={28} style={{ color: "#3a3f60", margin: "0 auto 10px", display: "block" }} />
                <p style={{ fontSize: 12, color: "#3a3f60" }}>Answer 3+ questions in weak topics to unlock your weekly quiz.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0d0f1c", color: "#e2e8f0", paddingBottom: isMobile ? 120 : 48 }}>

      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, width: "100%", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(13,15,28,0.96)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}>
        <div style={{ maxWidth: 1280, margin: "0 auto", display: "flex", height: 56, alignItems: "center", justifyContent: "space-between", padding: "0 16px" }}>
          {/* Logo */}
          <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
            <div style={{ width: 32, height: 32, borderRadius: 10, background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 900, color: "white", flexShrink: 0 }}>
              cQ
            </div>
            {!isMobile && <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>CortexQ</span>}
          </Link>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* Timer */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 9, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <Clock size={13} style={{ color: "#64748b" }} />
              <TimerDisplay startRef={sessionStartRef} />
            </div>

            {/* Viewers */}
            {shareToken && (totalViews > 0 || activeViewers > 0) && !isMobile && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 11px", borderRadius: 9, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                {totalViews > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#64748b" }}><Eye size={12} />{totalViews}</span>}
                {activeViewers > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 600, color: "#4ade80" }}><Users size={12} />{activeViewers} live</span>}
              </div>
            )}

            {/* Save status */}
            {!isMobile && (
              <div style={{ display: "flex", alignItems: "center" }}>
                {saveStatus === "saving" && <Loader2 size={13} style={{ color: "#64748b", animation: "spin 0.8s linear infinite" }} />}
                {saveStatus === "saved"  && <Cloud    size={13} style={{ color: "#4ade80" }} />}
                {saveStatus === "idle"   && <CloudOff size={13} style={{ color: "#3a3f60" }} />}
              </div>
            )}

            {/* Quiz Mode */}
            <Link
              href={`/quiz/${lectureId}`}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 10, background: "rgba(123,47,255,0.12)", border: "1px solid rgba(123,47,255,0.25)", color: "#a78bfa", fontSize: 12, fontWeight: 600, textDecoration: "none", transition: "opacity 0.15s" }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <Zap size={13} />
              {!isMobile && "Quiz Mode"}
            </Link>

            {/* Share */}
            <button
              onClick={shareToken ? handleCopyLink : handleShare}
              disabled={sharing}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 13px", borderRadius: 10, background: copied ? "linear-gradient(135deg,#7B2FFF,#00D2FD)" : "rgba(255,255,255,0.05)", border: `1px solid ${copied ? "transparent" : "rgba(255,255,255,0.1)"}`, color: copied ? "white" : "#64748b", fontSize: 12, fontWeight: 600, cursor: sharing ? "not-allowed" : "pointer", opacity: sharing ? 0.6 : 1, fontFamily: "inherit", transition: "all 0.18s" }}
            >
              {copied ? <Check size={13} /> : <Share2 size={13} />}
              {!isMobile && (copied ? "Copied!" : "Share")}
            </button>

            {/* Shuffle */}
            <button
              onClick={handleToggleShuffle}
              title={shuffleMode ? "Sectioned view" : "Shuffle questions"}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, background: shuffleMode ? "linear-gradient(135deg,#7B2FFF,#00D2FD)" : "rgba(255,255,255,0.05)", border: `1px solid ${shuffleMode ? "transparent" : "rgba(255,255,255,0.1)"}`, color: shuffleMode ? "white" : "#64748b", cursor: "pointer", fontFamily: "inherit", transition: "all 0.18s" }}
            >
              <Shuffle size={14} />
            </button>

            {/* Reprocess */}
            <button
              onClick={handleProcess}
              disabled={processing}
              title="Reprocess lecture"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#64748b", cursor: processing ? "not-allowed" : "pointer", opacity: processing ? 0.6 : 1, fontFamily: "inherit" }}
            >
              <RefreshCw size={14} style={{ animation: processing ? "spin 0.8s linear infinite" : "none" }} />
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1280, margin: "0 auto", padding: isMobile ? "20px 14px" : "28px 20px" }}>

        {/* Breadcrumb */}
        <nav style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 22 }}>
          <Link href="/dashboard" style={{ color: "#64748b", textDecoration: "none", transition: "color 0.15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
            onMouseLeave={e => (e.currentTarget.style.color = "#64748b")}
          >Dashboard</Link>
          <ChevronRight size={13} style={{ color: "#3a3f60" }} />
          <span style={{ color: "#94a3b8" }}>Lecture #{lectureId}</span>
        </nav>

        {/* Title */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 28, fontWeight: 800, color: "#e2e8f0", letterSpacing: "-0.02em", margin: "0 0 12px" }}>Study Materials</h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 9, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", fontSize: 12, fontWeight: 600, color: "#94a3b8" }}>
              <BookOpen size={12} />{totalCount} MCQs
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 12px", borderRadius: 9, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", fontSize: 12, color: "#64748b" }}>
              <Calendar size={12} />{new Date(results.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 3, padding: "4px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, width: "fit-content", marginBottom: 24 }}>
          {(["mcqs", "summary", "concepts"] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{ padding: "7px 18px", borderRadius: 9, fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer", background: activeTab === tab ? "rgba(123,47,255,0.18)" : "transparent", color: activeTab === tab ? "#c4b5fd" : "#64748b", transition: "all 0.18s", fontFamily: "inherit" }}
            >
              {tab === "mcqs" ? "MCQs" : tab === "summary" ? "Summary" : "Key Concepts"}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && error !== "not_found" && (
          <div style={{ marginBottom: 18, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", borderRadius: 12, padding: "12px 16px", fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Content grid */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "300px 1fr", gap: 20, alignItems: "start" }}>

          {/* Sidebar */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* Score panel */}
            <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#3a3f60", margin: "0 0 10px" }}>Performance</p>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 48, fontWeight: 800, color: "#e2e8f0", lineHeight: 1 }}>{score}</span>
                <span style={{ fontSize: 18, color: "#64748b" }}>/ {totalCount}</span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden", marginBottom: 12 }}>
                <div style={{ height: "100%", borderRadius: 999, width: `${totalCount > 0 ? (score / totalCount) * 100 : 0}%`, background: "linear-gradient(90deg, #7B2FFF, #00D2FD)", transition: "width 0.8s ease" }} />
              </div>
              {answeredCount > 0 && (
                <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 4px" }}>{scorePercent}% accuracy — {answeredCount}/{totalCount} answered</p>
              )}
              {retakeCount > 0 && (
                <p style={{ fontSize: 12, color: "#3a3f60", margin: "0 0 14px" }}>{retakeCount} retake{retakeCount !== 1 ? "s" : ""} completed</p>
              )}

              {confirmRetake && (
                <div style={{ borderRadius: 12, background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", padding: 14, marginBottom: 14 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", margin: "0 0 4px" }}>Clear all answers?</p>
                  <p style={{ fontSize: 12, color: "#64748b", margin: "0 0 12px" }}>Your current progress will be lost.</p>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={handleReset} style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: "rgba(248,113,113,0.14)", border: "1px solid rgba(248,113,113,0.28)", color: "#f87171", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Yes, retake</button>
                    <button onClick={() => setConfirmRetake(false)} style={{ flex: 1, padding: "8px 0", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "#94a3b8", fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: "inherit" }}>Cancel</button>
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: confirmRetake ? 0 : 14 }}>
                <button
                  onClick={() => answeredCount > 0 ? setConfirmRetake(true) : handleReset()}
                  style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "9px 0", borderRadius: 12, background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "white", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer", fontFamily: "inherit" }}
                >
                  <RefreshCw size={13} />Retake
                </button>
                <button
                  onClick={handleToggleShuffle}
                  style={{ width: 42, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 12, background: shuffleMode ? "linear-gradient(135deg,#7B2FFF,#00D2FD)" : "rgba(255,255,255,0.05)", border: `1px solid ${shuffleMode ? "transparent" : "rgba(255,255,255,0.1)"}`, color: shuffleMode ? "white" : "#64748b", cursor: "pointer", fontFamily: "inherit" }}
                >
                  <Shuffle size={14} />
                </button>
              </div>
            </div>

            <PerformanceSidebar />

            {results.key_concepts.length > 0 && (
              <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20 }}>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#3a3f60", margin: "0 0 12px" }}>Key Concepts</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {results.key_concepts.slice(0, 6).map((concept, i) => (
                    <span key={i} style={{ padding: "4px 11px", borderRadius: 8, fontSize: 12, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}>
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main content */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

            {activeTab === "mcqs" && (
              shuffleMode
                ? <MCQList mcqs={shuffledMcqs} />
                : Object.entries(grouped).map(([topic, mcqs]) => (
                    <div key={topic}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                        <h3 style={{ fontSize: 14, fontWeight: 700, color: "#94a3b8", margin: 0 }}>{topic}</h3>
                        <span style={{ padding: "3px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "#3a3f60" }}>
                          {mcqs.length} questions
                        </span>
                      </div>
                      <MCQList mcqs={mcqs as Array<MCQ & { _index: number }>} />
                    </div>
                  ))
            )}

            {activeTab === "summary" && (
              <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <BookOpen size={17} style={{ color: "#7B2FFF" }} />
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>Summary</h2>
                </div>
                <p style={{ color: "#94a3b8", lineHeight: 1.75, margin: 0 }}>{results.summary}</p>
              </div>
            )}

            {activeTab === "concepts" && (
              <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <Lightbulb size={17} style={{ color: "#7B2FFF" }} />
                  <h2 style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", margin: 0 }}>High-Yield Key Concepts</h2>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                  {results.key_concepts.map((concept, i) => (
                    <span key={i} style={{ padding: "7px 16px", borderRadius: 10, fontSize: 13, background: "rgba(123,47,255,0.08)", border: "1px solid rgba(123,47,255,0.2)", color: "#c4b5fd" }}>
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Score banner */}
            {answeredCount === totalCount && totalCount > 0 && activeTab === "mcqs" && (
              <div style={{ background: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.07)", borderLeft: `3px solid ${scorePercent >= 70 ? "#4ade80" : "#fb923c"}`, borderRadius: 16, padding: "18px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" as const }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: 15, color: "#e2e8f0", margin: "0 0 4px" }}>
                    {scorePercent >= 70 ? "Great work!" : "Keep studying!"} — {score}/{totalCount} ({scorePercent}%)
                  </p>
                  <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>
                    {scorePercent >= 70 ? "You're well-prepared for this topic." : "Review the explanations for questions you missed."}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmRetake(true)}
                  style={{ padding: "9px 20px", borderRadius: 12, background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "white", fontWeight: 700, fontSize: 13, border: "none", cursor: "pointer", flexShrink: 0, fontFamily: "inherit" }}
                >
                  Retake
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile tools bar */}
      {isMobile && (
        <div style={{ position: "fixed", bottom: 56, left: 0, right: 0, zIndex: 40, borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(13,15,28,0.96)", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", display: "flex", justifyContent: "space-around", alignItems: "center", padding: "10px 16px", gap: 8 }}>
          <Link href={`/quiz/${lectureId}`} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: "rgba(123,47,255,0.12)", border: "1px solid rgba(123,47,255,0.25)", color: "#a78bfa", fontSize: 13, fontWeight: 600, textDecoration: "none" }}>
            <Zap size={14} />Quiz
          </Link>
          <button onClick={handleToggleShuffle} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: shuffleMode ? "linear-gradient(135deg,#7B2FFF,#00D2FD)" : "rgba(255,255,255,0.05)", border: `1px solid ${shuffleMode ? "transparent" : "rgba(255,255,255,0.1)"}`, color: shuffleMode ? "white" : "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            <Shuffle size={14} />{shuffleMode ? "Sectioned" : "Shuffle"}
          </button>
          <button onClick={shareToken ? handleCopyLink : handleShare} disabled={sharing} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 10, background: copied ? "linear-gradient(135deg,#7B2FFF,#00D2FD)" : "rgba(255,255,255,0.05)", border: `1px solid ${copied ? "transparent" : "rgba(255,255,255,0.1)"}`, color: copied ? "white" : "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {copied ? <Check size={14} /> : <Share2 size={14} />}{copied ? "Copied" : "Share"}
          </button>
        </div>
      )}

      {/* Mobile nav */}
      {isMobile && (
        <nav style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50, borderTop: "1px solid rgba(255,255,255,0.06)", background: "#0d0f1c", display: "flex", justifyContent: "space-around", alignItems: "center", padding: "10px 16px", paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
          <Link href="/dashboard" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: "#3a3f60", textDecoration: "none" }}>
            <Home size={20} /><span style={{ fontSize: 11 }}>Home</span>
          </Link>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: "#7B2FFF" }}>
            <BookOpen size={20} /><span style={{ fontSize: 11 }}>Study</span>
          </div>
          <Link href="/analytics" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, color: "#3a3f60", textDecoration: "none" }}>
            <BarChart3 size={20} /><span style={{ fontSize: 11 }}>Stats</span>
          </Link>
        </nav>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
