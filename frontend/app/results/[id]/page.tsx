"use client";
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  getResults, processLecture, createShareLink, getActiveViewers,
  getQuizSession, saveQuizSession, retakeQuizSession,
  getPerformanceQuestions, savePerformanceQuestions,
  startPerformanceSession, submitPerformanceAnswer, completePerformanceSession,
  generateFlashcards,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { invalidatePerformanceContext } from "@/lib/performance-context";
import { api } from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Share2, Shuffle, RefreshCw, Check, X,
  Zap, BookOpen, Lightbulb, ChevronRight,
  Brain, AlertTriangle, Calendar,
  CheckCircle2, XCircle, Loader2, Clock, Timer, Power, Pause, Play,
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
  lecture_title?: string;
  mode?: string;
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

const BASE = "/api/v1/performance";

async function perfGet<T>(path: string): Promise<T> {
  const res = await api.get<T>(`${BASE}${path}`);
  return res.data;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const lectureId = parseInt(params.id as string);

  const searchParams = useSearchParams();
const [showFlashcardPrompt, setShowFlashcardPrompt] = useState(false);

useEffect(() => {
  if (searchParams.get("processed") === "true") {
    const hasSeen = localStorage.getItem(`fc_prompt_seen_${lectureId}`);
    if (!hasSeen) {
      setShowFlashcardPrompt(true);
    }
  }
}, [searchParams, lectureId]);

const handleFlashcardPromptAction = (action: "try" | "later") => {
  localStorage.setItem(`fc_prompt_seen_${lectureId}`, "true");
  setShowFlashcardPrompt(false);
  if (action === "try") {
    router.push(`/flashcards/${lectureId}`);
  }
};

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

  const [showButtonsHint, setShowButtonsHint] = useState(false);
  useEffect(() => {
    if (typeof window !== "undefined" && !localStorage.getItem("themcq_buttons_hint_seen")) {
      const t = setTimeout(() => setShowButtonsHint(true), 1200);
      return () => clearTimeout(t);
    }
  }, []);
  const dismissHint = () => {
    setShowButtonsHint(false);
    localStorage.setItem("themcq_buttons_hint_seen", "1");
  };

  // Timer widget state
  const [timerOpen, setTimerOpen] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState(25);
  const [timerActive, setTimerActive] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [timerRemaining, setTimerRemaining] = useState(0);
  const [keepAwake, setKeepAwake] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Timer countdown effect
  useEffect(() => {
    if (timerActive && timerRemaining > 0) {
      timerIntervalRef.current = setInterval(() => {
        setTimerRemaining(prev => {
          if (prev <= 1) {
            setTimerActive(false);
            setTimerPaused(false);
            if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => {
        if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      };
    }
  }, [timerActive, timerRemaining]);

  // Wake lock effect
  useEffect(() => {
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        }
      } catch (err) {
        console.log('Wake Lock error:', err);
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        } catch (err) {
          console.log('Wake Lock release error:', err);
        }
      }
    };

    if (keepAwake) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => {
      releaseWakeLock();
    };
  }, [keepAwake]);


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
          await savePerformanceQuestions(lectureId, "revision", res.data.mcqs || []);
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
            const res = await startPerformanceSession(lectureId, "revision", results.mcqs.length);
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
            invalidatePerformanceContext();
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
  }, [pendingAnswer, answers, results, lectureId, shuffleMode, shuffledMcqs, prefetchNextQuestion, resetLiveTimeline]);

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

  const handleStartTimer = () => {
    setTimerRemaining(timerMinutes * 60);
    setTimerActive(true);
    setTimerPaused(false);
  };

  const handlePauseTimer = () => {
    setTimerActive(false);
    setTimerPaused(true);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  const handleResumeTimer = () => {
    setTimerActive(true);
    setTimerPaused(false);
  };

  const handleStopTimer = () => {
    setTimerActive(false);
    setTimerPaused(false);
    setTimerRemaining(0);
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader activePage="Lectures" />
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────────

  if (error === "not_found") {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader activePage="Lectures" />
        <div className="flex items-center justify-center px-4 py-20">
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
                    onClick={() => !isAnswered && handleSelectAnswer(globalIdx, letter)}
                    onMouseEnter={() => { if (!isAnswered) handleOptionHoverStart(letter); }}
                    onMouseLeave={() => { if (!isAnswered) handleOptionHoverEnd(letter); }}
                    disabled={isAnswered}
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
                          ? "bg-violet-600/10 border-violet-500/35 text-foreground cursor-pointer"
                          : "bg-muted/15 border-border text-muted-foreground hover:bg-violet-600/10 hover:border-violet-500/30 hover:text-violet-300 cursor-pointer"
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
                <p className="text-xs text-muted-foreground mb-3.5">Still deciding? Change your answer above — pick confidence when you're ready.</p>
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


  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 md:pb-8">
      <AppHeader activePage="Lectures" />

      <main className="max-w-7xl mx-auto px-4 py-6 md:px-8 md:py-10 relative">

        {/* Buttons hint popup */}
        {showButtonsHint && (
          <div className="fixed top-20 right-[72px] z-50 w-[240px] bg-card border border-border rounded-2xl shadow-xl p-4">
            <p className="text-[13px] font-bold text-foreground mb-3">yo here's what these do 👀</p>
            <div className="flex flex-col gap-2.5 mb-3.5">
              <div className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">🔗</span>
                <div>
                  <p className="text-[12px] font-semibold text-foreground">Share</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">copy the link and drop it in the group chat. your friends study too, right? no cap</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-base leading-none mt-0.5">⏱️</span>
                <div>
                  <p className="text-[12px] font-semibold text-foreground">Study Timer</p>
                  <p className="text-[11px] text-muted-foreground leading-snug">set a timer so you actually study and don't just vibe on here fr fr</p>
                </div>
              </div>
            </div>
            <button
              onClick={dismissHint}
              className="w-full py-1.5 rounded-lg bg-violet-600/15 border border-violet-600/25 text-violet-300 text-[12px] font-semibold hover:bg-violet-600/25 transition-colors"
            >
              got it ✓
            </button>
          </div>
        )}

        {/* Timer Widget - Static Button */}
        <div className="fixed top-20 right-4 z-40 flex flex-col gap-2">
          {/* Share Button */}
          <button
            onClick={shareToken ? handleCopyLink : handleShare}
            disabled={sharing}
            className="w-12 h-12 rounded-full bg-card border-2 border-primary/40 shadow-lg flex items-center justify-center hover:bg-muted/50 transition-colors"
            title={shareToken ? "Copy share link" : "Share"}
          >
            {sharing ? (
              <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
            ) : copied ? (
              <Check className="w-5 h-5 text-emerald-400" />
            ) : (
              <Share2 className="w-5 h-5 text-muted-foreground" />
            )}
          </button>
          {!timerOpen ? (
            <button
              onClick={() => setTimerOpen(true)}
              className="w-12 h-12 rounded-full bg-card border-2 border-primary/40 shadow-lg flex items-center justify-center hover:bg-muted/50 transition-colors"
              title="Study Timer"
            >
              {timerActive ? (
                <Timer className="w-5 h-5 text-primary animate-pulse" />
              ) : timerPaused ? (
                <Pause className="w-5 h-5 text-yellow-400" />
              ) : (
                <Clock className="w-5 h-5 text-muted-foreground" />
              )}
            </button>
          ) : (
            <>
              {/* Click outside to close timer */}
              <div
                className="fixed inset-0 z-30"
                onClick={() => setTimerOpen(false)}
              />
              
              <div 
                className="bg-card border-2 border-primary/30 rounded-2xl shadow-xl p-4 w-[280px] relative z-40"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">Study Timer</span>
                  </div>
                  <button
                    onClick={() => setTimerOpen(false)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-muted/50 transition-colors"
                  >
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>

                {(timerActive || timerPaused) ? (
                  <div className="space-y-3">
                    <div className="text-center">
                      <div className={cn("text-4xl font-bold font-mono", timerPaused ? "text-yellow-400" : "text-foreground")}>
                        {formatTime(timerRemaining)}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {timerPaused ? "Paused" : "Time remaining"}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      {timerActive ? (
                        <Button onClick={handlePauseTimer} variant="outline" size="sm" className="flex-1">
                          <Pause className="w-3.5 h-3.5" />Pause
                        </Button>
                      ) : (
                        <Button onClick={handleResumeTimer} size="sm" className="flex-1">
                          <Play className="w-3.5 h-3.5" />Resume
                        </Button>
                      )}
                      <Button onClick={handleStopTimer} variant="outline" size="sm" className="flex-1">
                        Stop
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-2 block">
                        Study Duration (minutes)
                      </label>
                      <div className="flex gap-2">
                        {[15, 25, 45, 60].map((mins) => (
                          <button
                            key={mins}
                            onClick={() => setTimerMinutes(mins)}
                            className={cn(
                              "flex-1 py-2 rounded-lg text-sm font-medium transition-colors",
                              timerMinutes === mins
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {mins}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                      <div className="flex items-center gap-2">
                        <Power className="w-4 h-4 text-muted-foreground" />
                        <span className="text-xs text-foreground">Keep screen on</span>
                      </div>
                      <button
                        onClick={() => setKeepAwake(!keepAwake)}
                        className={cn(
                          "w-10 h-5 rounded-full transition-colors relative",
                          keepAwake ? "bg-primary" : "bg-muted-foreground/30"
                        )}
                      >
                        <div
                          className={cn(
                            "w-4 h-4 rounded-full bg-white absolute top-0.5 transition-transform",
                            keepAwake ? "translate-x-5" : "translate-x-0.5"
                          )}
                        />
                      </button>
                    </div>

                    <Button
                      onClick={handleStartTimer}
                      size="sm"
                      className="w-full"
                    >
                      Start Timer
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-[13px] text-muted-foreground mb-6 flex-wrap">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
          <Link href="/lectures" className="hover:text-foreground transition-colors">Lectures</Link>
          <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 opacity-40" />
          <span className="text-foreground font-medium truncate max-w-[260px] sm:max-w-none">
            {results.lecture_title || "Study Materials"}
          </span>
        </nav>

        {/* Title */}
        <div className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-semibold text-foreground mb-3">
            {results.lecture_title || "Study Materials"}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <BookOpen className="w-3 h-3" />{totalCount} MCQs
            </Badge>
            <Badge variant="outline" className="gap-1.5 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />{new Date(results.created_at).toLocaleDateString()}
            </Badge>
            {results.mode && (() => {
              const MODE_LABELS: Record<string, { label: string; className: string }> = {
                revision:     { label: "Revision",     className: "border-violet-500/30 text-violet-400 bg-violet-500/10" },
                exam:         { label: "Exam",         className: "border-amber-500/30 text-amber-400 bg-amber-500/10" },
                harder:       { label: "Hard Mode",    className: "border-red-500/30 text-red-400 bg-red-500/10" },
                quick_review: { label: "Quick Review", className: "border-sky-500/30 text-sky-400 bg-sky-500/10" },
                custom:       { label: "Smart Context", className: "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" },
              };
              const m = MODE_LABELS[results.mode];
              return m ? (
                <span className={cn("inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold border", m.className)}>
                  <Zap className="w-3 h-3" />{m.label}
                </span>
              ) : null;
            })()}
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
        <div className="grid gap-5 items-start grid-cols-1 lg:grid-cols-[300px_1fr]">

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
                  <Button
                    onClick={shareToken ? handleCopyLink : handleShare}
                    disabled={sharing}
                    variant="outline"
                    size="sm"
                    className="w-10 px-0"
                    title={shareToken ? "Copy share link" : "Share"}
                  >
                    {sharing ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : copied ? (
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                    ) : (
                      <Share2 className="w-3.5 h-3.5" />
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

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

      <AnimatePresence>
        {showFlashcardPrompt && (
          <FlashcardDiscoveryPopup onAction={handleFlashcardPromptAction} />
        )}
      </AnimatePresence>
    </div>
  );
}

function FlashcardDiscoveryPopup({ onAction }: { onAction: (action: "try" | "later") => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 50, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.95 }}
      className="fixed bottom-8 right-8 z-[100] w-[400px] max-w-[calc(100vw-64px)]"
    >
      <div className="bg-[#0f172a] border border-white/10 rounded-[2rem] p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)] overflow-hidden relative group">
        {/* Glow effect */}
        <div className="absolute -top-24 -right-24 w-48 h-48 bg-primary/20 blur-[80px] group-hover:bg-primary/30 transition-colors duration-500" />
        
        <div className="relative space-y-6">
          <div className="flex items-start justify-between">
            <div className="p-3.5 bg-primary/10 rounded-2xl border border-primary/20">
              <Sparkles className="w-7 h-7 text-primary animate-pulse" />
            </div>
            <button 
              onClick={() => onAction("later")}
              className="text-white/20 hover:text-white/40 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-2">
            <h3 className="text-2xl font-bold text-white tracking-tight">
              Try our new AI Flashcards
            </h3>
            <p className="text-white/60 leading-relaxed">
              Turn this lecture into a personalized spaced-repetition deck in seconds.
            </p>
          </div>

          <div className="flex flex-col gap-3 pt-2">
            <Button
              onClick={() => onAction("try")}
              className="w-full h-12 rounded-xl bg-primary text-primary-foreground hover:scale-[1.02] active:scale-[0.98] transition-all font-bold text-base shadow-lg shadow-primary/20"
            >
              Try Flashcards
              <ChevronRight className="w-4 h-4 ml-2" />
            </Button>
            <Button
              variant="ghost"
              onClick={() => onAction("later")}
              className="w-full h-12 rounded-xl text-white/40 hover:text-white/60 hover:bg-white/5 transition-all font-semibold"
            >
              Maybe Later
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
