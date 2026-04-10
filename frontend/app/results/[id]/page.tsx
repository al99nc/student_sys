"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
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
import Link from "next/link";

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

// Maps confidence level → pre_answer_confidence integer (1–3) for backend
const CONFIDENCE_TO_INT: Record<Confidence, number> = {
  guessed: 1,
  unsure: 2,
  confident: 3,
};

interface AnswerEntry {
  letter: string;
  confidence: Confidence;
}

// Tracks hover time on each option while the question is live
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

const TOPIC_EMOJIS: Record<string, string> = {
  Pathophysiology: "🧬", Diagnosis: "🔬", Treatment: "💊", Complications: "⚠️",
  Anatomy: "🫀", Pharmacology: "💉", Neurology: "🧠", Cardiology: "❤️",
  Respiratory: "🫁", General: "📋",
};

function getEmoji(topic: string): string {
  for (const [key, emoji] of Object.entries(TOPIC_EMOJIS)) {
    if (topic.toLowerCase().includes(key.toLowerCase())) return emoji;
  }
  return "📌";
}

type ActiveTab = "mcqs" | "summary" | "concepts";

const CONFIDENCE_OPTIONS: { value: Confidence; label: string; emoji: string; color: string }[] = [
  { value: "guessed",   label: "Guessed",   emoji: "🎲", color: "border-orange-500/50 bg-orange-500/10 text-orange-300 hover:bg-orange-500/20" },
  { value: "unsure",    label: "Unsure",     emoji: "🤔", color: "border-yellow-500/50 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20" },
  { value: "confident", label: "Confident", emoji: "💪", color: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20" },
];

// Maps letter → option key for timeline
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
    <span className="font-mono text-sm text-on-surface-variant tabular-nums">{m}:{s}</span>
  );
}

// ─── Sidebar panels fetched from performance API ──────────────────────────────

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

// ─── API helpers (call through your existing api.ts base) ─────────────────────
// We call fetch directly so we don't need to bloat api.ts imports.
// Adjust BASE_URL to match your environment.

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

  // ── Core state ─────────────────────────────────────────────────────────────
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

  // ── Performance sidebar state ───────────────────────────────────────────────
  const [weakPoints, setWeakPoints] = useState<WeakPoint[]>([]);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [nextAction, setNextAction] = useState<NextAction | null>(null);
  const [weeklyQuiz, setWeeklyQuiz] = useState<WeeklyQuiz | null>(null);
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [aiInsightStatus, setAiInsightStatus] = useState<"loading" | "fresh" | "stale" | "no_data" | "error">("loading");
  const [insightTab, setInsightTab] = useState<"next" | "insight" | "plan" | "quiz">("next");

  // ── Refs ────────────────────────────────────────────────────────────────────
  const sessionStartRef = useRef<number>(Date.now());
  const viewerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasScrolledToResume = useRef(false);

  // Performance tracking refs
  const perfSessionId = useRef<string | null>(null);
  const perfQuestionMap = useRef<Record<string, string>>({});  // question_text → UUID
  const questionStartTime = useRef<number>(Date.now());          // when question was shown
  const confidenceStartTime = useRef<number>(Date.now());        // when confidence prompt appeared
  const firstAnswerTime = useRef<number | null>(null);           // for answer_changed tracking
  const firstAnswerLetter = useRef<string | null>(null);

  // Per-question hover timeline tracking
  const hoverStartRef = useRef<{ letter: string; at: number } | null>(null);
  const liveTimelineRef = useRef<LiveTimeline>({
    time_on_option_a: 0, time_on_option_b: 0,
    time_on_option_c: 0, time_on_option_d: 0,
    second_choice: null, re_read_question: false, re_read_count: 0,
  });

  // Adaptive next-question queue (from backend)
  const nextQueueRef = useRef<string | null>(null); // question ID suggested by backend

  // ── Auth & load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    fetchResults();
  }, [lectureId, router]);

  // ── Load performance sidebar data after results load ────────────────────────
  useEffect(() => {
    if (!results) return;
    loadPerformanceSidebar();
  }, [results]);

  const loadPerformanceSidebar = async () => {
    // Fire all sidebar fetches in parallel — silently ignore failures
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

  // Refresh sidebar after each answer is committed (weak-points + readiness change)
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

  // ── Auto-scroll to first unanswered MCQ after session restore ───────────────
  useEffect(() => {
    if (loading || hasScrolledToResume.current || !results || Object.keys(answers).length === 0 || shuffleMode) return;
    const firstUnanswered = results.mcqs.findIndex((_, i) => answers[i] === undefined);
    if (firstUnanswered === -1) return;
    hasScrolledToResume.current = true;
    setTimeout(() => {
      document.getElementById(`mcq-${firstUnanswered}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
  }, [answers, results, shuffleMode, loading]);

  // ── Active viewer polling ───────────────────────────────────────────────────
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

  // ── Fetch results + restore session ────────────────────────────────────────
  const fetchResults = async () => {
    try {
      const res = await getResults(lectureId);
      setResults(res.data);
      if (res.data.share_token) {
        setShareToken(res.data.share_token);
        setTotalViews(res.data.view_count || 0);
      }

      // Load question UUID map for performance tracking
      // If no questions are registered yet, auto-register them first
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

      // Restore saved session
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

  // ── Prefetch next adaptive question whenever a session is live ───────────────
  const prefetchNextQuestion = useCallback(async () => {
    if (!perfSessionId.current) return;
    try {
      const data = await perfGet<{ question: { id: string } | null; reason: string }>(
        `/sessions/${perfSessionId.current}/next-question`
      );
      nextQueueRef.current = data.question?.id ?? null;
    } catch {}
  }, []);

  // ── Clipboard ───────────────────────────────────────────────────────────────
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

  // ── Hover tracking helpers ──────────────────────────────────────────────────
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

  // ── Step 1: user picks an answer letter ────────────────────────────────────
  const handleSelectAnswer = useCallback((globalIndex: number, letter: string) => {
    if (answers[globalIndex] !== undefined) return;

    if (pendingAnswer?.globalIndex === globalIndex) {
      // User changed their mind before rating confidence
      liveTimelineRef.current.second_choice = pendingAnswer.letter;
      // Track answer change timing
      if (firstAnswerTime.current === null) {
        firstAnswerTime.current = Date.now();
        firstAnswerLetter.current = pendingAnswer.letter;
      }
      setPendingAnswer({ globalIndex, letter });
      return;
    }

    // Flush any ongoing hover
    if (hoverStartRef.current) {
      handleOptionHoverEnd(hoverStartRef.current.letter);
    }

    setPendingAnswer({ globalIndex, letter });
    confidenceStartTime.current = Date.now();
  }, [answers, pendingAnswer, handleOptionHoverEnd]);

  // ── Step 2: user rates confidence → commit & send to backend ───────────────
  const handleConfidence = useCallback(async (confidence: Confidence) => {
    if (!pendingAnswer || !results) return;
    const { globalIndex, letter } = pendingAnswer;

    const timeSpent = Math.max(1, Math.round((Date.now() - questionStartTime.current) / 1000));
    const timeToConfidence = Math.max(1, Math.round((Date.now() - confidenceStartTime.current) / 1000));

    // Was the answer changed before confidence?
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

    // Snapshot the timeline before reset
    const timeline = { ...liveTimelineRef.current };
    resetLiveTimeline();
    questionStartTime.current = Date.now();

    // ── Fire performance tracking ────────────────────────────────────────────
    const mcq = results.mcqs[globalIndex];
    const questionId = perfQuestionMap.current[mcq.question];
    if (questionId) {
      (async () => {
        try {
          // Ensure session exists
          if (!perfSessionId.current) {
            const res = await startPerformanceSession(lectureId, "highyield", results.mcqs.length);
            perfSessionId.current = res.data.session_id;
          }

          // Submit answer with FULL payload
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

          // Prefetch next adaptive question in background
          prefetchNextQuestion();

          // Complete session when all questions are answered
          if (Object.keys(updated).length === results.mcqs.length && perfSessionId.current) {
            await completePerformanceSession(perfSessionId.current);
            perfSessionId.current = null;
            // Refresh all sidebar panels after session completes
            await loadPerformanceSidebar();
          } else {
            // Refresh weak-points + readiness after every answer
            refreshSidebarAfterAnswer();
          }
        } catch {}
      })();
    }

    // Debounced auto-save to quiz session
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

  // ── Dismiss weekly quiz ─────────────────────────────────────────────────────
  const handleDismissQuiz = async () => {
    if (!weeklyQuiz?.assignment_id) return;
    try {
      await perfPost(`/weekly-quiz/${weeklyQuiz.assignment_id}/dismiss`);
      setWeeklyQuiz(null);
    } catch {}
  };

  // ── Force-refresh AI insight ────────────────────────────────────────────────
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

  // ── Loading / error states ──────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#111220" }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-container" />
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center relative" style={{ backgroundColor: "#111220" }}>
        <div className="grain-overlay" />
        <div className="text-center glass-panel rounded-3xl p-6 sm:p-12 max-w-md mx-4 relative z-10 w-full">
          <div className="w-16 h-16 rounded-2xl bg-tertiary/20 flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-3xl text-tertiary">warning</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Not Processed Yet</h2>
          <p className="text-on-surface-variant mb-8">Click below to generate study materials for this lecture.</p>
          <button
            onClick={handleProcess} disabled={processing}
            className="synapse-gradient text-white font-bold px-8 py-3 rounded-xl hover:-translate-y-1 transition-transform disabled:opacity-50"
          >
            {processing ? (
              <span className="flex items-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Processing…
              </span>
            ) : "Generate Study Materials"}
          </button>
        </div>
      </div>
    );
  }

  if (!results) return null;

  const answeredCount = Object.keys(answers).length;
  const totalCount = results.mcqs.length;
  const grouped = groupByTopic(results.mcqs);
  const scorePercent = totalCount > 0 ? Math.round((score / totalCount) * 100) : 0;

  // ── MCQ Card ────────────────────────────────────────────────────────────────
  const MCQList = ({ mcqs }: { mcqs: Array<MCQ & { _index: number }> }) => (
    <div className="space-y-6">
      {mcqs.map((mcq, displayIdx) => {
        const globalIdx = mcq._index;
        const answered = answers[globalIdx];
        const isPending = pendingAnswer?.globalIndex === globalIdx;
        const isAnswered = answered !== undefined;
        const isCorrect = answered?.letter === mcq.answer;

        return (
          <div
            key={globalIdx}
            id={`mcq-${globalIdx}`}
            className={`glass-panel p-4 sm:p-8 rounded-xl transition-all duration-300 hover:-translate-y-1 border-l-4 ${
              isAnswered
                ? isCorrect ? "border-green-500/50" : "border-error/50"
                : isPending ? "border-primary-container/60" : "border-primary-container/30"
            }`}
          >
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-on-surface-variant bg-surface-container-highest px-2 py-1 rounded">
                Question {displayIdx + 1 < 10 ? `0${displayIdx + 1}` : displayIdx + 1}
              </span>
              {isAnswered && (
                <span className={`px-2 py-1 text-[10px] font-bold rounded uppercase flex items-center gap-1 ${isCorrect ? "bg-green-500/10 text-green-400" : "bg-error/10 text-error"}`}>
                  <span className="material-symbols-outlined text-sm">{isCorrect ? "check_circle" : "cancel"}</span>
                  {isCorrect ? "Correct" : "Incorrect"}
                </span>
              )}
            </div>

            {/* Question text — track re-reads via pointer enter */}
            <h3
              className="text-lg font-bold text-white mb-6 leading-snug"
              onPointerEnter={() => {
                if (!isAnswered && isPending) {
                  liveTimelineRef.current.re_read_question = true;
                  liveTimelineRef.current.re_read_count += 1;
                }
              }}
            >
              {mcq.question}
            </h3>

            {/* Options */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mcq.options.map((option, j) => {
                const letter = option.charAt(0);
                const isThisSelected = answered?.letter === letter || (isPending && pendingAnswer?.letter === letter);
                const isThisCorrect = letter === mcq.answer;

                let cls: string;
                if (isAnswered) {
                  if (isThisCorrect) cls = "bg-primary-container/20 border border-primary/30 text-white cursor-default";
                  else if (isThisSelected) cls = "bg-error/20 border border-error/30 text-error cursor-default";
                  else cls = "bg-surface-container-highest border border-outline-variant/10 text-on-surface-variant/50 cursor-default";
                } else if (isPending) {
                  if (isThisSelected) cls = "bg-primary-container/20 border border-primary-container/40 text-white cursor-default";
                  else cls = "bg-surface-container-highest border border-outline-variant/10 text-on-surface-variant/40 cursor-default";
                } else {
                  cls = "bg-surface-container-highest border border-outline-variant/10 text-on-surface-variant cursor-pointer hover:border-primary-container/50 hover:bg-primary-container/10 hover:text-white";
                }

                return (
                  <button
                    key={j}
                    onClick={() => !isAnswered && !isPending && handleSelectAnswer(globalIdx, letter)}
                    onPointerEnter={() => !isAnswered && handleOptionHoverStart(letter)}
                    onPointerLeave={() => !isAnswered && handleOptionHoverEnd(letter)}
                    className={`p-4 rounded-xl text-sm text-left transition-all flex justify-between items-center ${cls}`}
                  >
                    <span>{option}</span>
                    {isAnswered && isThisCorrect && <span className="material-symbols-outlined text-primary text-sm">done_all</span>}
                    {isAnswered && isThisSelected && !isThisCorrect && <span className="material-symbols-outlined text-error text-sm">close</span>}
                  </button>
                );
              })}
            </div>

            {/* Confidence prompt */}
            {isPending && (
              <div className="mt-6 rounded-xl border border-primary-container/30 bg-primary-container/5 p-5 animate-fadeIn">
                <p className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                  <span className="material-symbols-outlined text-base text-primary-container">psychology</span>
                  How confident were you?
                </p>
                <p className="text-xs text-on-surface-variant mb-4">Your answer is locked in — this is for your performance tracking.</p>
                <div className="flex gap-3 flex-wrap">
                  {CONFIDENCE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => handleConfidence(opt.value)}
                      className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all hover:-translate-y-0.5 ${opt.color}`}
                    >
                      <span>{opt.emoji}</span>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Explanation */}
            {isAnswered && mcq.explanation && (
              <div className={`mt-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2 ${isCorrect ? "bg-green-500/5 border border-green-500/20 text-green-300" : "bg-primary-container/5 border border-primary/20 text-primary-fixed-dim"}`}>
                <span className="material-symbols-outlined text-sm flex-shrink-0 mt-0.5">arrow_forward</span>
                <span>
                  <strong>Answer: {mcq.answer}</strong> — {mcq.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
                </span>
                {answered.confidence && (() => {
                  const c = CONFIDENCE_OPTIONS.find(o => o.value === answered.confidence);
                  return c ? (
                    <span className={`ml-auto shrink-0 text-xs px-2 py-0.5 rounded-full border ${c.color}`}>
                      {c.emoji} {c.label}
                    </span>
                  ) : null;
                })()}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // ── Performance Sidebar Panels ───────────────────────────────────────────────

  const urgencyColor: Record<string, string> = {
    routine: "text-emerald-400 bg-emerald-400/10 border-emerald-400/30",
    elevated: "text-yellow-400 bg-yellow-400/10 border-yellow-400/30",
    critical: "text-red-400 bg-red-400/10 border-red-400/30",
  };

  const PerformanceSidebar = () => (
    <div className="glass-panel rounded-xl border border-outline-variant/10 overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-outline-variant/10 text-[10px] font-black uppercase tracking-widest">
        {(["next", "insight", "plan", "quiz"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setInsightTab(t)}
            className={`flex-1 py-3 transition-colors ${insightTab === t ? "bg-primary-container/10 text-primary-container border-b-2 border-primary-container" : "text-on-surface-variant hover:text-white"}`}
          >
            {t === "next" ? "🎯 Next" : t === "insight" ? "🧠 AI" : t === "plan" ? "📅 Plan" : "📋 Quiz"}
          </button>
        ))}
      </div>

      <div className="p-5">

        {/* ── NEXT ACTION tab ── */}
        {insightTab === "next" && (
          <div className="space-y-4">
            {/* Readiness score */}
            {readiness && (
              <div className="rounded-xl bg-surface-container-highest p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-on-surface-variant uppercase tracking-widest">Readiness</span>
                  <span className="text-2xl font-black text-white">{Math.round(readiness.readiness_score)}%</span>
                </div>
                <div className="h-2 w-full bg-surface-container rounded-full overflow-hidden">
                  <div
                    className="h-full synapse-gradient rounded-full transition-all duration-700"
                    style={{ width: `${readiness.readiness_score}%` }}
                  />
                </div>
                <div className="flex justify-between mt-2 text-[10px] text-on-surface-variant">
                  <span>⚠️ {readiness.weak_topics_count} weak</span>
                  <span>✅ {readiness.strong_topics_count} strong</span>
                  <span>📝 {readiness.total_questions_answered} answered</span>
                </div>
              </div>
            )}

            {/* Next action card */}
            {nextAction ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-primary-container/10 border border-primary-container/20 p-4">
                  <p className="text-xs font-black uppercase tracking-widest text-primary-container mb-1">Recommended Now</p>
                  <p className="text-sm text-white font-bold mb-2">{nextAction.next_step}</p>
                  {nextAction.topic && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary-container/20 text-primary-container border border-primary-container/30">
                      📌 {nextAction.topic}
                    </span>
                  )}
                </div>

                {nextAction.reason.length > 0 && (
                  <div className="space-y-1">
                    {nextAction.reason.map((r, i) => (
                      <p key={i} className="text-xs text-on-surface-variant flex items-start gap-1.5">
                        <span className="text-primary-container mt-0.5">›</span>{r}
                      </p>
                    ))}
                  </div>
                )}

                {nextAction.confidence_gap_alert && (
                  <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-3 py-2 text-xs text-orange-300 flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">warning</span>
                    Overconfidence pattern detected
                  </div>
                )}

                {nextAction.predicted_readiness_24h !== null && (
                  <p className="text-xs text-on-surface-variant">
                    📈 Predicted in 24h: <strong className="text-white">{nextAction.predicted_readiness_24h}%</strong>
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">Complete a session to get your next action.</p>
            )}

            {/* Weak points mini list */}
            {weakPoints.length > 0 && (
              <div>
                <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-2">Weak Topics</p>
                <div className="space-y-2">
                  {weakPoints.slice(0, 4).map((wp) => (
                    <div key={wp.topic} className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${wp.dangerous_misconception ? "bg-red-400" : "bg-orange-400"}`} />
                      <span className="text-xs text-on-surface-variant flex-1 truncate">{wp.topic}</span>
                      <span className="text-xs font-bold text-white">{Math.round((wp.accuracy_rate || 0) * 100)}%</span>
                      {wp.accuracy_trend !== undefined && wp.accuracy_trend !== null && (
                        <span className={`text-[10px] ${wp.accuracy_trend >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {wp.accuracy_trend >= 0 ? "↑" : "↓"}
                        </span>
                      )}
                    </div>
                  ))}
                  {weakPoints.length > 4 && (
                    <p className="text-[10px] text-on-surface-variant/60">+{weakPoints.length - 4} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── AI INSIGHT tab ── */}
        {insightTab === "insight" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">CortexQ AI Insight</p>
              <button
                onClick={handleRefreshInsight}
                className="text-[10px] text-primary-container hover:text-white transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-xs">refresh</span>
                {aiInsightStatus === "stale" ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {aiInsightStatus === "loading" && (
              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <span className="animate-spin rounded-full h-3 w-3 border-b border-primary-container" />
                Generating insight…
              </div>
            )}

            {aiInsightStatus === "no_data" && (
              <p className="text-xs text-on-surface-variant">Complete at least one session to unlock your AI insight.</p>
            )}

            {aiInsightStatus === "error" && (
              <p className="text-xs text-red-400">Could not load insight. Try refreshing.</p>
            )}

            {aiInsight && (aiInsightStatus === "fresh" || aiInsightStatus === "stale") && (
              <div className="space-y-3">
                {aiInsightStatus === "stale" && (
                  <div className="text-[10px] px-2 py-1 rounded bg-yellow-400/10 border border-yellow-400/20 text-yellow-400">
                    ⚡ Refreshing in background…
                  </div>
                )}

                {/* Urgency */}
                <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest ${urgencyColor[aiInsight.urgency_level] || urgencyColor.routine}`}>
                  {aiInsight.urgency_level === "critical" ? "🔴" : aiInsight.urgency_level === "elevated" ? "🟡" : "🟢"}
                  {aiInsight.urgency_level}
                </div>

                {/* Personalized message */}
                <div className="rounded-xl bg-primary-container/10 border border-primary-container/20 p-4">
                  <p className="text-sm text-white leading-relaxed">{aiInsight.personalized_message}</p>
                </div>

                {/* Next topic */}
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant mb-1">Study Now</p>
                  <p className="text-xs text-white">{aiInsight.next_topic_to_study}</p>
                </div>

                {/* Critical insight */}
                {aiInsight.critical_insight && (
                  <div className="rounded-lg bg-tertiary/10 border border-tertiary/20 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-tertiary mb-1">Hidden Pattern</p>
                    <p className="text-xs text-on-surface-variant">{aiInsight.critical_insight}</p>
                  </div>
                )}

                {/* Behavioral warning */}
                {aiInsight.behavioral_warning && (
                  <div className="rounded-lg bg-orange-500/10 border border-orange-500/30 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-400 mb-1">⚠️ Behavioral Alert</p>
                    <p className="text-xs text-orange-300">{aiInsight.behavioral_warning}</p>
                  </div>
                )}

                {/* Decay alert */}
                {aiInsight.decay_alert && (
                  <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2">
                    <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-1">🕐 Decay Alert</p>
                    <p className="text-xs text-red-300">{aiInsight.decay_alert}</p>
                  </div>
                )}

                {/* Predicted readiness */}
                {aiInsight.predicted_readiness_7d !== null && (
                  <p className="text-xs text-on-surface-variant">
                    🔮 Predicted readiness in 7 days: <strong className="text-white">{Math.round(aiInsight.predicted_readiness_7d)}%</strong>
                  </p>
                )}

                {/* Strongest topic */}
                {aiInsight.strongest_topic && (
                  <p className="text-xs text-emerald-400">
                    💪 Strongest: <strong>{aiInsight.strongest_topic}</strong>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── DAILY PLAN tab ── */}
        {insightTab === "plan" && (
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">3-Day Study Plan</p>
            {aiInsight?.daily_plan && aiInsight.daily_plan.length > 0 ? (
              <div className="space-y-3">
                {aiInsight.daily_plan.map((day) => {
                  const priorityColor = day.priority === "critical"
                    ? "border-red-500/30 bg-red-500/5"
                    : day.priority === "high"
                      ? "border-orange-500/30 bg-orange-500/5"
                      : "border-outline-variant/20 bg-surface-container-highest";
                  const priorityBadge = day.priority === "critical"
                    ? "bg-red-500/20 text-red-400"
                    : day.priority === "high"
                      ? "bg-orange-500/20 text-orange-400"
                      : "bg-surface-container text-on-surface-variant";

                  return (
                    <div key={day.day} className={`rounded-xl border p-4 ${priorityColor}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-black text-white uppercase tracking-widest">Day {day.day}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${priorityBadge}`}>
                            {day.priority}
                          </span>
                          <span className="text-[10px] text-on-surface-variant">{day.question_count}q</span>
                        </div>
                      </div>
                      <p className="text-sm text-on-surface-variant">{day.focus}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-on-surface-variant">Complete a session to generate your personalized plan.</p>
            )}
          </div>
        )}

        {/* ── WEEKLY QUIZ tab ── */}
        {insightTab === "quiz" && (
          <div className="space-y-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant">Weekly Review Quiz</p>
            {weeklyQuiz?.assignment_id ? (
              <div className="space-y-3">
                <div className="rounded-xl bg-secondary/10 border border-secondary/30 p-4">
                  <p className="text-sm font-bold text-white mb-1">
                    📋 {weeklyQuiz.questions.length} questions ready
                  </p>
                  {weeklyQuiz.weak_topics.length > 0 && (
                    <p className="text-xs text-on-surface-variant mb-3">
                      Covering: {weeklyQuiz.weak_topics.slice(0, 3).join(", ")}
                      {weeklyQuiz.weak_topics.length > 3 && ` +${weeklyQuiz.weak_topics.length - 3} more`}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Link
                      href={`/quiz/${lectureId}?weekly=${weeklyQuiz.assignment_id}`}
                      className="flex-1 py-2 synapse-gradient text-white font-bold rounded-lg text-xs text-center"
                    >
                      Start Quiz
                    </Link>
                    <button
                      onClick={handleDismissQuiz}
                      className="px-3 py-2 glass-panel text-on-surface-variant font-bold rounded-lg text-xs hover:text-white transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6">
                <span className="text-3xl block mb-2">🎯</span>
                <p className="text-xs text-on-surface-variant">
                  Answer 3+ questions in weak topics to unlock your weekly quiz.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  // ── Page ─────────────────────────────────────────────────────────────────────
  return (
    <div
      className="relative min-h-screen text-on-surface pb-36 md:pb-0"
      style={{
        backgroundColor: "#111220",
        backgroundImage: "radial-gradient(at 0% 0%, rgba(123,47,255,0.1) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(0,210,253,0.05) 0px, transparent 50%)",
        backgroundAttachment: "fixed",
      }}
    >
      <div className="grain-overlay" />

      {/* Header */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)]">
        <Link href="/dashboard" className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">
          cortexQ
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high border border-outline-variant/20">
            <span className="material-symbols-outlined text-sm text-on-surface-variant">timer</span>
            <TimerDisplay startRef={sessionStartRef} />
          </div>

          {shareToken && (totalViews > 0 || activeViewers > 0) && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-high border border-outline-variant/20">
              {totalViews > 0 && (
                <span className="flex items-center gap-1 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-sm">visibility</span>{totalViews}
                </span>
              )}
              {totalViews > 0 && activeViewers > 0 && <span className="text-outline-variant text-xs">·</span>}
              {activeViewers > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                  {activeViewers} solving
                </span>
              )}
            </div>
          )}

          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs">
              {saveStatus === "saving" && <span className="material-symbols-outlined text-sm text-on-surface-variant animate-spin">sync</span>}
              {saveStatus === "saved" && <><span className="material-symbols-outlined text-sm text-emerald-400">cloud_done</span><span className="text-emerald-400">Saved</span></>}
              {saveStatus === "idle" && <span className="material-symbols-outlined text-sm text-on-surface-variant/40">cloud_done</span>}
            </div>
            <Link href={`/quiz/${lectureId}`} className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg glass-panel border border-secondary/30 text-secondary hover:text-white transition-all">
              <span className="material-symbols-outlined text-sm">bolt</span>Quiz Mode
            </Link>
            <button
              onClick={shareToken ? handleCopyLink : handleShare} disabled={sharing}
              className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg transition-all ${copied ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "glass-panel text-on-surface-variant hover:text-white"}`}
            >
              <span className="material-symbols-outlined text-sm">{copied ? "check" : "share"}</span>
              {copied ? "Copied!" : shareToken ? "Copy Link" : sharing ? "…" : "Share"}
            </button>
            <button
              onClick={handleToggleShuffle}
              className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg transition-all ${shuffleMode ? "synapse-gradient text-white" : "glass-panel text-on-surface-variant hover:text-white"}`}
            >
              <span className="material-symbols-outlined text-sm">shuffle</span>
              {shuffleMode ? "Sectioned" : "Shuffle"}
            </button>
            <button onClick={handleProcess} disabled={processing} className="text-sm text-secondary hover:text-white font-medium disabled:opacity-50 transition-colors">
              {processing ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      </header>

      <main className="pt-20 sm:pt-24 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-bold tracking-widest text-secondary mb-4 uppercase pt-6">
          <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-on-surface-variant">Lecture #{lectureId}</span>
        </nav>

        {/* Title */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight mb-4">Study Materials</h2>
            <div className="flex flex-wrap gap-3">
              <span className="px-3 py-1 bg-surface-container-high rounded-full border border-outline-variant/20 text-xs font-medium text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">quiz</span>{totalCount} MCQs
              </span>
              <span className="px-3 py-1 bg-surface-container-high rounded-full border border-outline-variant/20 text-xs font-medium text-secondary flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">calendar_today</span>
                {new Date(results.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-outline-variant/10 mb-8 gap-8 overflow-x-auto scrollbar-hide">
          {(["mcqs", "summary", "concepts"] as ActiveTab[]).map((t) => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`pb-4 text-sm font-bold border-b-2 whitespace-nowrap px-2 transition-all ${activeTab === t ? "border-primary-container text-white" : "border-transparent text-on-surface-variant hover:text-white"}`}
            >
              {t === "mcqs" ? "MCQs" : t === "summary" ? "Summary" : "Key Concepts"}
            </button>
          ))}
        </div>

        {error && error !== "not_found" && (
          <div className="mb-6 bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">{error}</div>
        )}

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-20">

          {/* Sidebar */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            {/* Score panel */}
            <div className="glass-panel p-5 sm:p-8 rounded-xl shadow-[0px_8px_24px_rgba(123,47,255,0.15)] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary-container/10 blur-3xl rounded-full -mr-16 -mt-16" />
              <div className="relative z-10">
                <p className="text-secondary font-bold uppercase tracking-[0.2em] text-xs mb-2">Performance</p>
                <div className="flex items-baseline gap-2 mb-6">
                  <span className="text-6xl font-black text-white">{score}</span>
                  <span className="text-2xl font-bold text-on-surface-variant">/ {totalCount}</span>
                </div>
                <div className="h-3 w-full bg-surface-container-highest rounded-full mb-4 overflow-hidden">
                  <div
                    className="h-full synapse-gradient rounded-full transition-all duration-500"
                    style={{ width: `${totalCount > 0 ? (score / totalCount) * 100 : 0}%` }}
                  />
                </div>
                {answeredCount > 0 && (
                  <p className="text-sm text-on-surface-variant mb-2">
                    {scorePercent}% accuracy · {answeredCount}/{totalCount} answered
                  </p>
                )}
                {retakeCount > 0 && (
                  <p className="text-xs text-on-surface-variant/60 mb-6">
                    <span className="material-symbols-outlined text-xs align-middle mr-1">history</span>
                    {retakeCount} retake{retakeCount !== 1 ? "s" : ""} completed
                  </p>
                )}
                {answeredCount === 0 && retakeCount === 0 && <div className="mb-6" />}

                {confirmRetake ? (
                  <div className="bg-error/10 border border-error/30 rounded-xl p-4 mb-3">
                    <p className="text-sm font-bold text-white mb-1">Clear all answers?</p>
                    <p className="text-xs text-on-surface-variant mb-3">Your current progress will be lost.</p>
                    <div className="flex gap-2">
                      <button onClick={handleReset} className="flex-1 py-2 bg-error text-white font-bold rounded-lg text-sm hover:bg-error/80 transition-colors">Yes, retake</button>
                      <button onClick={() => setConfirmRetake(false)} className="flex-1 py-2 glass-panel text-on-surface-variant font-bold rounded-lg text-sm hover:text-white transition-colors">Cancel</button>
                    </div>
                  </div>
                ) : null}

                <div className="flex gap-3">
                  <button
                    onClick={() => answeredCount > 0 ? setConfirmRetake(true) : handleReset()}
                    className="flex-1 py-3 synapse-gradient text-white font-bold rounded-xl shadow-lg hover:-translate-y-1 transition-transform flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">refresh</span>Retake
                  </button>
                  <button
                    onClick={handleToggleShuffle}
                    className={`px-4 py-3 rounded-xl font-bold transition-all ${shuffleMode ? "bg-white/20 text-white" : "glass-panel text-on-surface-variant hover:text-white"}`}
                  >
                    <span className="material-symbols-outlined text-sm">shuffle</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Performance intelligence panel */}
            <PerformanceSidebar />

            {results.key_concepts.length > 0 && (
              <div className="glass-panel p-6 rounded-xl border border-outline-variant/10">
                <h4 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Key Concepts</h4>
                <div className="flex flex-wrap gap-2">
                  {results.key_concepts.slice(0, 6).map((concept, i) => (
                    <span key={i} className="text-xs px-3 py-1.5 rounded-full bg-surface-container-highest border border-outline-variant/10 text-on-surface-variant">
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
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
                      <span className="text-xl">{getEmoji(topic)}</span>
                      <h3 className="font-bold text-white">{topic}</h3>
                      <span className="text-xs text-on-surface-variant">{mcqs.length} questions</span>
                    </div>
                    <MCQList mcqs={mcqs as Array<MCQ & { _index: number }>} />
                  </div>
                ))
              )
            )}

            {activeTab === "summary" && (
              <div className="glass-panel p-5 sm:p-8 rounded-xl">
                <div className="flex items-center gap-3 mb-6">
                  <span className="material-symbols-outlined text-primary">summarize</span>
                  <h3 className="font-bold text-white text-xl">Summary</h3>
                </div>
                <p className="text-on-surface-variant leading-relaxed">{results.summary}</p>
              </div>
            )}

            {activeTab === "concepts" && (
              <div className="glass-panel p-5 sm:p-8 rounded-xl">
                <div className="flex items-center gap-3 mb-6">
                  <span className="material-symbols-outlined text-tertiary">lightbulb</span>
                  <h3 className="font-bold text-white text-xl">High-Yield Key Concepts</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  {results.key_concepts.map((concept, i) => (
                    <span key={i} className="px-4 py-2 rounded-full bg-tertiary/10 border border-tertiary/20 text-tertiary text-sm font-medium">
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Score banner */}
            {answeredCount === totalCount && totalCount > 0 && activeTab === "mcqs" && (
              <div className={`rounded-xl p-6 flex items-center justify-between glass-panel border-l-4 ${scorePercent >= 70 ? "border-green-500/50" : "border-tertiary/50"}`}>
                <div>
                  <p className="font-bold text-white text-lg">
                    {scorePercent >= 70 ? "🎉 Great work!" : "📖 Keep studying!"} — {score}/{totalCount} ({scorePercent}%)
                  </p>
                  <p className="text-on-surface-variant text-sm mt-1">
                    {scorePercent >= 70 ? "You're well-prepared for this topic." : "Review the explanations for questions you missed."}
                  </p>
                </div>
                <button
                  onClick={() => setConfirmRetake(true)}
                  className="synapse-gradient text-white font-bold px-6 py-2 rounded-xl text-sm hover:-translate-y-0.5 transition-transform"
                >
                  Retake
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Mobile page tools subbar */}
      <div className="md:hidden fixed bottom-[56px] w-full z-[51]">
        <div className="flex items-center gap-2 px-4 pt-1.5">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Page tools</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>
        <div className="flex justify-around items-center py-1.5 px-4 bg-slate-800/80 backdrop-blur-xl border-t border-white/8">
          <Link
            href={`/quiz/${lectureId}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/10 border border-secondary/25 text-secondary"
          >
            <span className="material-symbols-outlined text-[18px]">bolt</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Quiz Mode</span>
          </Link>
          <button
            onClick={handleToggleShuffle}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${shuffleMode ? "bg-white/15 border-white/20 text-white" : "bg-white/5 border-white/10 text-slate-400"}`}
          >
            <span className="material-symbols-outlined text-[18px]">shuffle</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{shuffleMode ? "Sectioned" : "Shuffle"}</span>
          </button>
          <button
            onClick={shareToken ? handleCopyLink : handleShare} disabled={sharing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${copied ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-white/5 border-white/10 text-slate-400"}`}
          >
            <span className="material-symbols-outlined text-[18px]">{copied ? "check" : "share"}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{copied ? "Copied!" : shareToken ? "Copy Link" : "Share"}</span>
          </button>
        </div>
      </div>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-slate-950/95 backdrop-blur-xl border-t border-white/5">
        <Link href="/dashboard" className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors">
          <span className="material-symbols-outlined text-[22px]">home</span>
          <span className="text-[10px] uppercase tracking-widest">Home</span>
        </Link>
        <div className="flex flex-col items-center gap-0.5 text-[#00D2FD]">
          <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>upload_file</span>
          <span className="text-[10px] uppercase tracking-widest">Upload</span>
        </div>
        <Link href="/analytics" className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors">
          <span className="material-symbols-outlined text-[22px]">insights</span>
          <span className="text-[10px] uppercase tracking-widest">Stats</span>
        </Link>
      </nav>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeIn { animation: fadeIn 0.25s ease forwards; }
      `}</style>
    </div>
  );
}