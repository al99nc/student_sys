"use client";
import { useEffect, useRef, useState, useCallback, Suspense } from "react";
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/auth";
import { getPerformanceContext } from "@/lib/performance-context";
import {
  coachListConversations,
  coachCreateConversation,
  coachGetConversation,
  coachDeleteConversation,
  coachSendMessage,
  coachSearch,
  getEntitlements,
  coachGeneratePracticeMCQs,
  coachGeneratePracticeEssays,
  coachGeneratePractice,
  coachGenerateEssay,
  FreshMCQ,
  EssayQuestion,
  QuizResult,
} from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import {
  Plus, Search, X, MessageSquare, Trash2, ArrowLeft,
  Menu, Bot, ArrowUp, Paperclip, Lock, CheckCircle, XCircle,  
  Clock, Lightbulb, History, ArrowRight, Dumbbell,
  FileText, AlertCircle, ChevronRight, BookOpen, Sparkles, ChevronDown,
  Eye, Trophy,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Conversation {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface AiMeta {
  action?: string;
  topic_focus?: string | null;
  next_step?: string | null;
  question_count?: number | null;
  why_this_matters?: string | null;
  session_prediction?: string | null;
  calibration_pulse?: string | null;
  check_in?: string | null;
  confidence_tip?: string | null;
  urgency?: string;
  encouraging_note?: string | null;
  practice_document_id?: number | null;
  practice_topic?: string | null;
  practice_questions?: { id: string; document_id: number; topic: string; preview: string }[];
  mastery_progress?: { topic: string; current: number; target: number } | null;
  topic_chain?: string[] | null;
  days_since_last?: number | null;
  is_relapse?: boolean;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  image_data?: string | null;
  image_mime?: string | null;
  ai_metadata?: AiMeta | null;
  created_at: string;
  payg_limit?: boolean;
}

interface PracticeEntry {
  msgId: string;
  type: "mcq" | "essay";
  topic: string;
  timestamp: string;
}
type PracticeMap = Record<string, PracticeEntry[]>;

interface PracticeModalData {
  type: "mcq" | "essay";
  topic: string;
  count: number;
  questions: FreshMCQ[] | EssayQuestion[] | null;
  generating: boolean;
  error?: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const PRACTICE_KEY = "themcq_practice_map";

function loadPracticeMap(): PracticeMap {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(PRACTICE_KEY) ?? "{}"); }
  catch { return {}; }
}

function savePracticeMap(map: PracticeMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PRACTICE_KEY, JSON.stringify(map));
}

function groupByDate(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);

  const groups: Record<string, Conversation[]> = {
    Today: [], Yesterday: [], "This week": [], Older: [],
  };
  for (const c of convs) {
    const d = new Date(c.updated_at);
    if (d.toDateString() === today) groups["Today"].push(c);
    else if (d.toDateString() === yesterdayStr) groups["Yesterday"].push(c);
    else if (d >= weekAgo) groups["This week"].push(c);
    else groups["Older"].push(c);
  }
  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

function urgencyColor(urgency?: string): string {
  switch (urgency) {
    case "critical": return "#f87171";
    case "high":     return "#fb923c";
    case "medium":   return "#facc15";
    default:         return "#4ade80";
  }
}

function isValid(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const n = value.trim().toLowerCase();
    return n !== "" && n !== "null" && n !== "none";
  }
  return true;
}

const QUICK_REPLIES: Record<string, string[]> = {
  practice_questions:       ["Start now →", "What am I getting wrong?", "Make it harder"],
  review_topic:             ["Explain it simply", "Most tested concept?", "3 things I must know"],
  misconception_correction: ["What's my exact mistake?", "Give me a fixed example", "How common is this?"],
  spaced_review:            ["When do I review again?", "How fast do I forget?", "Quick refresher"],
  confidence_building:      ["How do I know I know it?", "Show me my progress", "What does 80% feel like?"],
  exam_strategy:            ["How does this appear on exams?", "What traps exist?", "Give me an exam question"],
  off_topic:                ["What should I study today?", "How am I doing?", "Show my weak spots"],
};

// ── CoachPageInner ─────────────────────────────────────────────────────────────

function CoachPageInner({ initialConvId }: { initialConvId?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnConvId = initialConvId ?? searchParams.get("conv");
  const quizScore = searchParams.get("quiz_score");
  const quizTotal = searchParams.get("quiz_total");
  const quizPct   = searchParams.get("quiz_pct");
  const quizTopic = searchParams.get("quiz_topic");
  const autoQ     = searchParams.get("q");
  const seedMsg   = searchParams.get("seed");

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [convTitle, setConvTitle] = useState("New Conversation");
  const [loadingConv, setLoadingConv] = useState(false);
  const [pendingAutoMsg, setPendingAutoMsg] = useState<string | null>(null);

  const [userPlan, setUserPlan] = useState<"free" | "pro" | "enterprise">("free");
  const [creditBalance, setCreditBalance] = useState(0);
  const [extraUsageEnabled, setExtraUsageEnabled] = useState(true);
  const [lockedDueToLimit, setLockedDueToLimit] = useState(false);
  const [countdown, setCountdown] = useState("");

  const [selectedModel, setSelectedModel] = useState<"llama" | "gemini">("llama");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string | null>(null);

  // Practice map (sidebar indicators)
  const [practiceMap, setPracticeMap] = useState<PracticeMap>({});
  const [practicePopoverConvId, setPracticePopoverConvId] = useState<string | null>(null);

  // Standalone practice panel in toolbar
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practiceTopic, setPracticeTopic] = useState("");
  const [practiceCount, setPracticeCount] = useState(5);

  // Practice modal (fullscreen overlay)
  const [practiceModal, setPracticeModal] = useState<PracticeModalData | null>(null);

  const isFreeUser = userPlan === "free" && creditBalance === 0;
  const isConvLocked = false;
  const lockExpiresAt = null;

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which conversations have already received the performance context prefix.
  const sentContextForConv = useRef<Set<string>>(new Set());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    setPracticeMap(loadPracticeMap());
  }, []);

  useEffect(() => {
    getEntitlements().then(res => {
      setUserPlan(res.data.plan ?? "free");
      setCreditBalance(res.data.credit_balance ?? 0);
      setExtraUsageEnabled(res.data.extra_usage_enabled ?? true);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!lockExpiresAt) { setCountdown(""); return; }
    const update = () => {
      const diff = lockExpiresAt - Date.now();
      if (diff <= 0) { setCountdown(""); return; }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      setCountdown(`${h}h ${m}m`);
    };
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockExpiresAt]);

  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) setSidebarOpen(true);
  }, []);

  // iOS Safari: track visual viewport height so the input stays above the keyboard
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      document.documentElement.style.setProperty("--keyboard-h", `${Math.max(0, offset)}px`);
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    update();
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      document.documentElement.style.removeProperty("--keyboard-h");
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = activeId ? `/coach/${activeId}` : "/coach";
    if (window.location.pathname !== target) window.history.pushState(null, "", target);
  }, [activeId]);

  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (window.innerWidth < 1024) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      e.preventDefault();
      textareaRef.current?.focus();
      setInput(prev => prev + e.key);
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [input]);

  useEffect(() => {
    if (practiceOpen) {
      const lastMeta = messages.slice().reverse()
        .find(m => m.ai_metadata?.practice_topic || m.ai_metadata?.topic_focus)?.ai_metadata;
      setPracticeTopic(lastMeta?.practice_topic ?? lastMeta?.topic_focus ?? convTitle ?? "");
    }
  }, [practiceOpen, messages, convTitle]);

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!val.trim()) { setSearchResults(null); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await coachSearch(val.trim());
        setSearchResults(res.data);
      } catch { setSearchResults([]); }
    }, 300);
  };

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConv(true);
    setMessages([]);
    setActiveId(id);
    try {
      const res = await coachGetConversation(id);
      setMessages(res.data.messages || []);
      setConvTitle(res.data.title || "Conversation");
    } catch { setMessages([]); }
    finally { setLoadingConv(false); }
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    const pathSegments = typeof window !== "undefined" ? window.location.pathname.split("/") : [];
    const pathConvId = pathSegments[2] || null;
    const targetConvId = returnConvId || pathConvId;
    const mcqContext = typeof window !== "undefined" ? sessionStorage.getItem("mcqContext") : null;

    coachListConversations()
      .then(async res => {
        setConversations(res.data);
        if (targetConvId) {
          await loadConversation(targetConvId);
          if (quizScore !== null && quizTotal !== null) {
            const pct = quizPct ?? Math.round((parseInt(quizScore) / parseInt(quizTotal)) * 100);
            const topicPart = quizTopic ? ` on ${quizTopic}` : "";
            setPendingAutoMsg(`I just finished the practice quiz${topicPart} and scored ${quizScore}/${quizTotal} (${pct}%). How did I do and what should I focus on next?`);
          } else if (seedMsg) {
            setPendingAutoMsg(seedMsg);
          }
        } else if (autoQ) {
          setPendingAutoMsg(autoQ);
        } else if (mcqContext) {
          setInput(`Help me understand this question:\n\n${mcqContext}`);
          if (typeof window !== "undefined") {
            sessionStorage.removeItem("mcqContext");
            sessionStorage.removeItem("fromMcq");
          }
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, returnConvId, loadConversation, quizScore, quizTotal, quizPct, autoQ, seedMsg]);

  useEffect(() => {
    if (!pendingAutoMsg || !activeId || sending) return;
    const msg = pendingAutoMsg;
    setPendingAutoMsg(null);
    const qr: QuizResult | undefined =
      quizScore && quizTotal && quizTopic
        ? { topic: quizTopic, score: parseInt(quizScore), total: parseInt(quizTotal) }
        : undefined;
    handleSend(msg, qr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, pendingAutoMsg]);

  const handleNewChat = async (forceLlama = false) => {
    if (isMobile) setSidebarOpen(false);
    setLockedDueToLimit(false);
    if (forceLlama) setSelectedModel("llama");
    try {
      const res = await coachCreateConversation();
      const newConv: Conversation = res.data;
      setConversations(prev => [newConv, ...prev]);
      setActiveId(newConv.id);
      setMessages([]);
      setConvTitle("New Conversation");
    } catch {}
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await coachDeleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (activeId === id) {
        setActiveId(null);
        setMessages([]);
        setConvTitle("New Conversation");
      }
    } catch {}
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    applyImageFile(file);
    e.target.value = "";
  };

  const removeImage = () => { setImagePreview(null); setImageMime(null); };

  const applyImageFile = (file: File) => {
    setImageMime(file.type);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) applyImageFile(file);
          break;
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSend = async (overrideText?: string, quizResult?: QuizResult) => {
    const text = overrideText !== undefined ? overrideText.trim() : input.trim();
    if ((!text && !imagePreview) || sending) return;
    const imgData = overrideText !== undefined ? null : imagePreview;
    const imgMime = overrideText !== undefined ? null : imageMime;
    if (overrideText === undefined) { setInput(""); removeImage(); } else { setInput(""); }
    setSending(true);

    let convId = activeId;
    if (!convId) {
      try {
        const res = await coachCreateConversation();
        convId = res.data.id;
        setActiveId(convId);
        setConversations(prev => [res.data, ...prev]);
      } catch { setSending(false); return; }
    }

    const optimisticUser: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      image_data: imgData,
      image_mime: imgMime,
      created_at: new Date().toISOString(),
    };
    const thinkingId = `thinking-${Date.now()}`;
    const thinkingMsg: Message = {
      id: thinkingId, role: "assistant", content: "…", created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticUser, thinkingMsg]);

      try {
        // Prepend performance context once per conversation so the coach is
        // aware of the student's right/wrong history from the first message.
        let messageToSend = text;
        if (!sentContextForConv.current.has(convId!)) {
          const perfCtx = await getPerformanceContext();
          if (perfCtx) {
            messageToSend = `${perfCtx}\n\n${text}`;
            sentContextForConv.current.add(convId!);
          }
        }
        const res = await coachSendMessage(convId!, messageToSend, imgData ?? undefined, imgMime ?? undefined, quizResult, selectedModel);
        const { user_message, assistant_message } = res.data;
        setMessages(prev =>
          prev.filter(m => m.id !== optimisticUser.id && m.id !== thinkingId)
              .concat([user_message, assistant_message])
        );
        if (assistant_message) {
          setConversations(prev =>
            prev.map(c => c.id === convId
              ? { ...c, updated_at: new Date().toISOString(), title: text.slice(0, 60) || c.title, message_count: (c.message_count || 0) + 2 }
              : c
            )
          );
          setConvTitle(text.slice(0, 60) || convTitle);
        }
      } catch (err: unknown) {
        setMessages(prev => prev.filter(m => m.id !== thinkingId));
        const errResp = (err as { response?: { status?: number; data?: { detail?: { message?: string; hint?: string; payg_limit?: boolean } | string } } })?.response;
        const is403 = errResp?.status === 403;
        const detail = errResp?.data?.detail;
        const isPayg = typeof detail === "object" && detail?.payg_limit === true;
        const isTimeout = (err as { code?: string })?.code === "ECONNABORTED";
        if (is403) setLockedDueToLimit(true);
        let errContent: string;
        if (isTimeout) {
          errContent = "The coach is taking longer than expected. This can happen when the AI model is busy. Please try again in a moment.";
        } else if (is403) {
          errContent = typeof detail === "object" ? `${detail.message ?? ""} ${detail.hint ?? ""}`.trim() : (detail ?? "You've reached your message limit.");
        } else {
          errContent = "I couldn't process that. This might be a temporary network issue. Try again or start a new conversation.";
        }
        const errMsg: Message = {
          id: `err-${Date.now()}`, role: "assistant", content: errContent,
          created_at: new Date().toISOString(), payg_limit: isPayg,
        };
        setMessages(prev => [...prev.filter(m => m.id !== optimisticUser.id), optimisticUser, errMsg]);
      } finally {
        setSending(false);
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handlePracticeGenerated = useCallback((type: "mcq" | "essay", topic: string, msgId: string) => {
    const convId = activeId;
    if (!convId) return;
    setPracticeMap(prev => {
      const updated: PracticeMap = { ...prev };
      const existing = updated[convId] ?? [];
      if (existing.some(e => e.msgId === msgId && e.type === type)) return prev;
      updated[convId] = [...existing, { msgId, type, topic, timestamp: new Date().toISOString() }];
      savePracticeMap(updated);
      return updated;
    });
  }, [activeId]);

  // Start practice modal: open in "building" state, call API, transition to countdown
  const handleStartPractice = useCallback(async (type: "mcq" | "essay", topic: string, count: number) => {
    const convId = activeId;
    const buildStart = Date.now();

    setPracticeModal({ type, topic, count, questions: null, generating: true, error: null });
    setPracticeOpen(false);

    try {
      let questions: FreshMCQ[] | EssayQuestion[];
      if (type === "mcq") {
        const res = convId && topic
          ? await coachGeneratePracticeMCQs(convId, topic, count)
          : await coachGeneratePractice(topic || "general", count);
        questions = res.data.questions;
      } else {
        const res = convId && topic
          ? await coachGeneratePracticeEssays(convId, topic, Math.min(count, 5))
          : await coachGenerateEssay(topic || "general", 3);
        questions = res.data.questions;
      }

      if (!questions || questions.length === 0) throw new Error("No questions were returned.");

      // Ensure the build animation runs for at least 1.8s
      const elapsed = Date.now() - buildStart;
      if (elapsed < 1800) await new Promise(r => setTimeout(r, 1800 - elapsed));

      setPracticeModal(prev => prev ? { ...prev, questions, generating: false } : null);
    } catch (e: unknown) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      const msg = detail || (e as Error)?.message || "Generation failed";
      setPracticeModal(prev => prev ? { ...prev, generating: false, error: msg } : null);
    }
  }, [activeId]);

  // Called when PracticeModal closes (with or without a result)
  const handlePracticeClose = useCallback((result?: { correct: number; total: number; topic: string; type: "mcq" | "essay" }) => {
    setPracticeModal(null);
    if (!result) return;

    // Track in practiceMap
    const practiceId = `modal-${Date.now()}`;
    handlePracticeGenerated(result.type, result.topic, practiceId);

    // Auto-send score/completion to coach
    if (result.type === "mcq" && result.total > 0) {
      const pct = Math.round((result.correct / result.total) * 100);
      handleSend(`I just scored ${result.correct}/${result.total} (${pct}%) on "${result.topic}" practice MCQs. Give me honest feedback and tell me exactly what to work on next.`);
    } else if (result.type === "essay") {
      handleSend(`I just reviewed ${result.total} essay questions on "${result.topic}". Break down the key concepts I need to really master here.`);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handlePracticeGenerated]);

  const scrollToMsg = (msgId: string) => {
    setPracticePopoverConvId(null);
    if (isMobile) setSidebarOpen(false);
    setTimeout(() => {
      document.getElementById(`msg-${msgId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 200);
  };

  const displayedConvs = searchResults ?? conversations;
  const grouped = groupByDate(displayedConvs);
  const hasContent = input.trim() || imagePreview;
  const inputLocked = isConvLocked || lockedDueToLimit;

  return (
    <div className="chat-root bg-background text-foreground" style={{ flexDirection: "column" }}>
      <AppHeader activePage="Coach" />

      <div className="flex flex-1 overflow-hidden">

      {/* ── Practice fullscreen modal ────────────────────────────────────────── */}
      {practiceModal && (
        <PracticeModal
          data={practiceModal}
          onClose={handlePracticeClose}
        />
      )}

      {/* Mobile backdrop */}
      {isMobile && sidebarOpen && (
        <div onClick={() => setSidebarOpen(false)} className="fixed inset-0 z-40 bg-black/65 backdrop-blur-sm" />
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <aside
        className={`flex flex-col bg-card border-r border-border flex-shrink-0 ${
          isMobile
            ? `fixed inset-y-0 left-0 z-50 w-[300px] transition-transform duration-300 ${sidebarOpen ? "translate-x-0 shadow-2xl" : "-translate-x-full"}`
            : `transition-[width] duration-200 overflow-hidden ${sidebarOpen ? "w-[260px] min-w-[260px]" : "w-0 min-w-0"}`
        }`}
      >
        <div
          className="flex flex-col flex-1 overflow-hidden"
          style={{ width: isMobile ? "100%" : 260, paddingTop: isMobile ? "env(safe-area-inset-top)" : 0 }}
        >
          {/* Sidebar header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Link href="/dashboard" className="flex items-center gap-2.5 no-underline">
              <div className="w-8 h-8 rounded-[10px] bg-foreground flex items-center justify-center flex-shrink-0">
                <span className="text-background font-black text-[11px]">cQ</span>
              </div>
              <span className="text-foreground font-bold text-sm">themcq</span>
            </Link>
            {isMobile && (
              <button onClick={() => setSidebarOpen(false)} className="w-9 h-9 rounded-lg flex items-center justify-center bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* New chat button */}
          <div className="p-3">
            <button
              onClick={() => handleNewChat()}
              className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-foreground text-background text-sm font-semibold hover:opacity-85 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              New conversation
            </button>
          </div>

          {/* Search */}
          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/40 border border-border">
              <Search className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
              <input
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent border-none outline-none text-foreground text-sm placeholder:text-muted-foreground/40"
              />
              {searchQuery && (
                <button onClick={() => handleSearchChange("")} className="text-muted-foreground/50 hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div className="momentum-scroll flex-1 px-2 pb-2 overflow-x-hidden">
            {searchQuery && searchResults?.length === 0 && (
              <p className="text-muted-foreground/40 text-xs px-3 py-2">No results for &ldquo;{searchQuery}&rdquo;</p>
            )}

            {grouped.map(group => (
              <div key={group.label} className="mb-2">
                <p className="text-muted-foreground/30 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5">{group.label}</p>
                {group.items.map(conv => {
                  const hasPractice = (practiceMap[conv.id]?.length ?? 0) > 0;
                  const isActive = activeId === conv.id;
                  return (
                    <div key={conv.id} className="group/conv relative">
                      <div
                        onClick={() => { loadConversation(conv.id); if (isMobile) setSidebarOpen(false); }}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                          isActive
                            ? "bg-muted text-foreground border-l-2 border-foreground/30"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/30 border-l-2 border-transparent"
                        }`}
                      >
                        <MessageSquare className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? "text-foreground/70" : "text-muted-foreground/40"}`} />
                        <p className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium">{conv.title}</p>

                        {hasPractice && (
                          <button
                            onClick={e => { e.stopPropagation(); setPracticePopoverConvId(p => p === conv.id ? null : conv.id); }}
                            title="Has practice sessions"
                            className="flex-shrink-0"
                          >
                            <span className="w-2 h-2 rounded-full bg-orange-400 block" style={{ animation: "practiceDot 2s ease-in-out infinite" }} />
                          </button>
                        )}

                        <button
                          onClick={e => handleDelete(conv.id, e)}
                          className="opacity-0 group-hover/conv:opacity-100 flex-shrink-0 text-muted-foreground/40 hover:text-destructive transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Practice popover */}
                      {hasPractice && practicePopoverConvId === conv.id && (
                        <div className="absolute left-0 right-0 z-50 mx-2 mt-1 rounded-xl border border-border bg-card shadow-xl overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
                            <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Practice sessions</span>
                            <button onClick={() => setPracticePopoverConvId(null)} className="text-muted-foreground/40 hover:text-foreground"><X className="w-3 h-3" /></button>
                          </div>
                          <div className="p-2 space-y-1">
                            {(practiceMap[conv.id] ?? []).map((entry, i) => (
                              <button
                                key={i}
                                onClick={() => scrollToMsg(entry.msgId)}
                                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left hover:bg-muted/50 transition-colors group/entry"
                              >
                                {entry.type === "mcq"
                                  ? <BookOpen className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                                  : <FileText className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
                                }
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium text-foreground/80 truncate">{entry.topic}</p>
                                  <p className="text-[10px] text-muted-foreground/40 uppercase">{entry.type === "mcq" ? "MCQs" : "Essays"}</p>
                                </div>
                                <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover/entry:text-muted-foreground transition-colors flex-shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {conversations.length === 0 && !searchQuery && (
              <p className="text-muted-foreground/30 text-xs px-3 py-3">No conversations yet. Start a new chat!</p>
            )}
          </div>

          {/* Back link */}
          <div className="p-3 border-t border-border" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
            <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 rounded-lg text-muted-foreground/50 text-sm hover:text-muted-foreground transition-colors no-underline">
              <ArrowLeft className="w-4 h-4" />
              Back to Dashboard
            </Link>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">

        {/* Header */}
        <header className="flex-shrink-0 flex items-center gap-2.5 px-3 border-b border-border bg-background z-10" style={{ height: 56, paddingTop: "env(safe-area-inset-top)" }}>
          <button onClick={() => setSidebarOpen(p => !p)} className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0">
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-foreground/70" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground truncate leading-tight">{activeId ? convTitle : "themcq Coach"}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground/40 leading-tight">AI Study Advisor</p>
            </div>
          </div>

          <button onClick={() => handleNewChat()} title="New conversation" className="w-10 h-10 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors flex-shrink-0 border border-border/50">
            <Plus className="w-4 h-4" />
          </button>
        </header>

        {/* Messages */}
        <div className="momentum-scroll flex-1">
          <div className="max-w-[700px] mx-auto px-4 py-5 flex flex-col gap-1">

            {!activeId && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 gap-6">
                <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
                  <Bot className="w-8 h-8 text-foreground/50" />
                </div>
                <div className="text-center max-w-md">
                  <h2 className="text-xl font-bold text-foreground mb-1.5">Your AI Study Coach</h2>
                  <p className="text-sm text-muted-foreground mb-1">
                    I can see your performance data, weak spots, and what you&apos;ve studied.
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Ask me anything about your progress — or tap a suggestion below to start.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2.5 w-full max-w-[420px]">
                  {[
                    { icon: <BookOpen className="w-4 h-4" />, text: "What are my weakest topics right now?" },
                    { icon: <Sparkles className="w-4 h-4" />, text: "Give me a 10-minute study plan" },
                    { icon: <Bot className="w-4 h-4" />, text: "Explain something I keep getting wrong" },
                    { icon: <ArrowRight className="w-4 h-4" />, text: "Which topic should I practice first?" },
                  ].map(({ icon, text }) => (
                    <button
                      key={text}
                      onClick={() => handleSend(text)}
                      className="flex flex-col gap-2 p-3.5 rounded-xl bg-card border border-border/50 text-left text-muted-foreground text-xs leading-snug hover:text-foreground hover:border-border hover:bg-muted/30 transition-all"
                    >
                      <span className="text-muted-foreground/40">{icon}</span>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loadingConv && (
              <div className="space-y-8 animate-pulse">
                <div className="flex justify-end pl-[12%]">
                  <div className="h-12 w-2/3 bg-muted rounded-2xl rounded-tr-sm" />
                </div>
                <div className="flex gap-2 pr-[4%]">
                  <div className="w-6 h-6 rounded-lg bg-muted shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-20 w-3/4 bg-muted rounded-2xl rounded-tl-sm" />
                  </div>
                </div>
              </div>
            )}

            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onQuickReply={(text) => handleSend(text)}
                onStartPractice={handleStartPractice}
                onPracticeGenerated={(type, topic, msgId) => handlePracticeGenerated(type, topic, msgId)}
              />
            ))}

            <div ref={messagesEndRef} className="h-1" />
          </div>
        </div>

        {/* ── INPUT AREA ────────────────────────────────────────────────────── */}
        <div className="flex-shrink-0 px-4 border-t border-border bg-background" style={{ paddingTop: 10, paddingBottom: "max(16px, env(safe-area-inset-bottom))", marginBottom: "var(--keyboard-h, 0px)" }}>
          <div className="max-w-[700px] mx-auto">

            {/* Standalone practice panel */}
            {practiceOpen && (
              <div className="mb-3 p-3 rounded-xl bg-card border border-border">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Dumbbell className="w-3.5 h-3.5 text-muted-foreground/50" />
                    <span className="text-xs font-semibold text-foreground/70">Generate Practice</span>
                  </div>
                  <button onClick={() => setPracticeOpen(false)} className="text-muted-foreground/40 hover:text-foreground"><X className="w-3.5 h-3.5" /></button>
                </div>
                <input
                  value={practiceTopic}
                  onChange={e => setPracticeTopic(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && practiceTopic.trim() && handleStartPractice("mcq", practiceTopic.trim(), practiceCount)}
                  placeholder="Topic (e.g. Cardiology, Pharmacokinetics…)"
                  className="w-full px-3 py-2 rounded-lg bg-background border border-border text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-foreground/30 transition-colors mb-2.5"
                />
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 p-1 bg-background rounded-lg border border-border">
                    {[3, 5, 10].map(n => (
                      <button key={n} onClick={() => setPracticeCount(n)} className={`px-2.5 py-0.5 rounded text-xs font-medium transition-colors ${practiceCount === n ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{n}</button>
                    ))}
                  </div>
                  <div className="flex-1 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => practiceTopic.trim() && handleStartPractice("mcq", practiceTopic.trim(), practiceCount)}
                      disabled={!practiceTopic.trim()}
                      className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-foreground text-background text-xs font-semibold hover:opacity-85 transition-opacity disabled:opacity-40"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      MCQs
                    </button>
                    <button
                      onClick={() => practiceTopic.trim() && handleStartPractice("essay", practiceTopic.trim(), practiceCount)}
                      disabled={!practiceTopic.trim()}
                      className="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-muted border border-border text-foreground/70 text-xs font-semibold hover:text-foreground transition-colors disabled:opacity-40"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      Essays
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Model toggle + practice trigger */}
            {!inputLocked && (
              <div className="flex items-center gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => { if (!extraUsageEnabled || isFreeUser) return; setSelectedModel(m => m === "llama" ? "gemini" : "llama"); }}
                  title={!extraUsageEnabled ? "Extra usage is off" : isFreeUser ? "Gemini is a Pro feature" : undefined}
                  className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all ${
                    selectedModel === "gemini" ? "border-foreground/30 bg-muted text-foreground" : "border-border/50 bg-transparent text-muted-foreground"
                  } ${(!extraUsageEnabled || isFreeUser) ? "opacity-60 cursor-default" : "cursor-pointer hover:border-border"}`}
                >
                  <Sparkles className="w-3 h-3" />
                  {!extraUsageEnabled ? "Llama 3.3" : selectedModel === "gemini" ? "Gemini 2.5" : "Llama 3.3"}
                  {isFreeUser && <Lock className="w-2.5 h-2.5 opacity-50" />}
                </button>

                <button
                  onClick={() => setPracticeOpen(p => !p)}
                  className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition-all ${
                    practiceOpen ? "border-foreground/30 bg-muted text-foreground" : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  <Dumbbell className="w-3 h-3" />
                  Practice
                </button>
              </div>
            )}

            {/* Image preview */}
            {imagePreview && (
              <div className="mb-2.5 relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="attachment" className="h-[72px] rounded-xl object-cover border border-border" />
                <button onClick={removeImage} className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive flex items-center justify-center text-white">
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}

            {/* Lock banner */}
            {inputLocked && (
              <div className="p-4 rounded-xl bg-card border border-border mb-2">
                <div className="flex items-center gap-2 mb-2.5">
                  <Lock className="w-4 h-4 text-muted-foreground/70" />
                  <span className="text-sm font-semibold text-foreground">Chat limit reached</span>
                  {countdown && <span className="ml-auto text-xs text-muted-foreground">Unlocks in {countdown}</span>}
                </div>
                <p className="text-xs text-muted-foreground mb-3">Monthly message limit reached. Start a new chat or upgrade to Pro for unlimited messages.</p>
                <div className="flex gap-2">
                  <button onClick={() => handleNewChat(true)} className="flex-1 py-2 rounded-lg bg-muted border border-border text-sm font-semibold text-foreground/80 hover:text-foreground transition-colors">New Chat</button>
                  <Link href="/billing" className="flex-1 py-2 rounded-lg bg-foreground text-background text-sm font-semibold text-center no-underline hover:opacity-85 transition-opacity">Get Pro</Link>
                </div>
              </div>
            )}

            {/* Input pill */}
            <div className={`flex items-end gap-2 px-3.5 py-2 rounded-[26px] border transition-colors ${inputLocked ? "bg-muted/20 border-border/30 opacity-50 pointer-events-none" : "bg-muted/30 border-border"}`}>
              <button
                onClick={() => isFreeUser ? null : fileInputRef.current?.click()}
                title={isFreeUser ? "Image upload is a Pro feature" : "Attach image (or paste)"}
                disabled={isFreeUser}
                className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mb-0.5 transition-colors ${isFreeUser ? "text-muted-foreground/20 cursor-not-allowed" : "text-muted-foreground/50 hover:text-foreground cursor-pointer"}`}
              >
                {isFreeUser ? <Lock className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the coach anything…"
                rows={1}
                className="flex-1 bg-transparent border-none outline-none resize-none text-foreground text-[15px] leading-relaxed max-h-[140px] overflow-y-auto py-1.5 placeholder:text-muted-foreground/40 font-[inherit]"
              />

              <button
                onClick={() => handleSend()}
                disabled={sending || !hasContent || inputLocked}
                className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center mb-0.5 transition-all ${hasContent ? "bg-foreground text-background hover:opacity-85 cursor-pointer" : "bg-muted text-muted-foreground cursor-default"} ${sending ? "opacity-70" : ""}`}
              >
                {sending
                  ? <div className="w-3.5 h-3.5 rounded-full border-2 border-background/25 border-t-background animate-spin" />
                  : <ArrowUp className="w-4 h-4" />
                }
              </button>
            </div>

            <p className="text-[10px] text-muted-foreground/20 text-center mt-2">
              themcq Coach uses your real performance data — responses are specific to you.
            </p>
          </div>
        </div>
      </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes coach-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes msg-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes practiceDot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.75); }
        }
        @keyframes buildBlock {
          from { opacity: 0; transform: scale(0) rotate(-8deg); }
          70%  { transform: scale(1.15) rotate(2deg); }
          to   { opacity: 1; transform: scale(1) rotate(0deg); }
        }
        @keyframes blockCollapse {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0) rotate(8deg); }
        }
        @keyframes countPop {
          from { opacity: 0; transform: scale(0.4); }
          65%  { transform: scale(1.18); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes countFade {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(1.5); }
        }
        @keyframes owlDrop {
          from { opacity: 0; transform: translateX(-50%) translateY(-32px) scale(0.6); }
          65%  { transform: translateX(-50%) translateY(6px) scale(1.12); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0) scale(1); }
        }
        @keyframes modalSlideUp {
          from { opacity: 0; transform: translateY(24px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes indetermBar {
          0%   { left: -60%; width: 50%; }
          50%  { left: 60%;  width: 60%; }
          100% { left: 120%; width: 50%; }
        }
        @keyframes optionReveal {
          from { opacity: 0; transform: translateX(-8px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes feedbackSlide {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes doneScale {
          from { opacity: 0; transform: scale(0.5); }
          65%  { transform: scale(1.1); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}

// ── PracticeModal ──────────────────────────────────────────────────────────────

function PracticeModal({
  data,
  onClose,
}: {
  data: PracticeModalData;
  onClose: (result?: { correct: number; total: number; topic: string; type: "mcq" | "essay" }) => void;
}) {
  const [phase, setPhase] = useState<"building" | "error" | "countdown" | "active" | "done">("building");
  const [countdownNum, setCountdownNum] = useState(3);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [advanceProgress, setAdvanceProgress] = useState(0);
  const [advancingFromIdx, setAdvancingFromIdx] = useState<number | null>(null);
  const [essayRevealed, setEssayRevealed] = useState<Record<number, boolean>>({});

  const mcqs = data.type === "mcq" ? (data.questions as FreshMCQ[] | null) : null;
  const essays = data.type === "essay" ? (data.questions as EssayQuestion[] | null) : null;
  const totalQ = mcqs?.length ?? essays?.length ?? 0;
  const correctCount = mcqs ? mcqs.filter((q, i) => answers[i] === q.answer).length : 0;
  const pct = totalQ > 0 ? Math.round((correctCount / totalQ) * 100) : 0;

  // Transition from building → countdown when generation completes
  useEffect(() => {
    if (!data.generating && data.questions && data.questions.length > 0 && phase === "building") {
      setPhase("countdown");
    }
    if (data.error && phase === "building") {
      setPhase("error");
    }
  }, [data.generating, data.questions, data.error, phase]);

  // Countdown 3 → 2 → 1 → active
  useEffect(() => {
    if (phase !== "countdown") return;
    if (countdownNum <= 0) {
      const t = setTimeout(() => setPhase("active"), 150);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setCountdownNum(n => n - 1), 1000);
    return () => clearTimeout(t);
  }, [phase, countdownNum]);

  // Auto-advance after answering (MCQ only)
  useEffect(() => {
    if (advancingFromIdx === null) return;
    const duration = 3500;
    const start = Date.now();
    const tick = setInterval(() => {
      const progress = Math.min(((Date.now() - start) / duration) * 100, 100);
      setAdvanceProgress(progress);
      if (progress >= 100) {
        clearInterval(tick);
        setAdvanceProgress(0);
        const nextIdx = advancingFromIdx + 1;
        setAdvancingFromIdx(null);
        if (nextIdx >= totalQ) {
          setPhase("done");
        } else {
          setCurrentIdx(nextIdx);
        }
      }
    }, 50);
    return () => clearInterval(tick);
  }, [advancingFromIdx, totalQ]);

  const handleMCQAnswer = (letter: string) => {
    if (advancingFromIdx !== null || answers[currentIdx]) return;
    setAnswers(prev => ({ ...prev, [currentIdx]: letter }));
    setAdvancingFromIdx(currentIdx);
  };

  const handleEssayReveal = () => {
    setEssayRevealed(prev => ({ ...prev, [currentIdx]: true }));
  };

  const handleEssayNext = () => {
    setAnswers(prev => ({ ...prev, [currentIdx]: "seen" }));
    const nextIdx = currentIdx + 1;
    if (nextIdx >= totalQ) {
      setPhase("done");
    } else {
      setCurrentIdx(nextIdx);
      setEssayRevealed(prev => ({ ...prev }));
    }
  };

  const handleClose = () => {
    if (phase === "done") {
      onClose({ correct: correctCount, total: totalQ, topic: data.topic, type: data.type });
    } else {
      onClose();
    }
  };

  const currentMCQ = mcqs?.[currentIdx];
  const currentEssay = essays?.[currentIdx];
  const currentAnswer = answers[currentIdx];
  const isLastQ = currentIdx === totalQ - 1;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center" style={{ padding: "16px" }}>
      {/* Backdrop — coach page visible & blurred at edges */}
      <div className="absolute inset-0 bg-background/85 backdrop-blur-md" onClick={phase === "error" ? handleClose : undefined} />

      {/* Modal shell */}
      <div className="relative z-10 w-full max-w-[480px] flex flex-col" style={{ maxHeight: "calc(100dvh - 32px)" }}>

        {/* Floating Bot avatar (Duolingo-style) */}
        <div
          className="absolute left-1/2 z-20 w-16 h-16 rounded-full bg-foreground flex items-center justify-center shadow-2xl border-4 border-background"
          style={{ top: -28, animation: "owlDrop 0.55s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >
          <Bot className="w-8 h-8 text-background" />
        </div>

        {/* Modal card */}
        <div
          className="bg-card rounded-3xl border border-border shadow-2xl overflow-hidden flex flex-col"
          style={{ marginTop: 28, maxHeight: "calc(100dvh - 60px)", animation: "modalSlideUp 0.4s cubic-bezier(0.34,1.56,0.64,1) both" }}
        >

          {/* ── Building phase ── */}
          {phase === "building" && <BuildingPhase topic={data.topic} type={data.type} />}

          {/* ── Error phase ── */}
          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 px-6 py-12 text-center">
              <AlertCircle className="w-10 h-10 text-destructive" />
              <p className="text-base font-bold text-foreground">Something went wrong</p>
              <p className="text-sm text-muted-foreground">{data.error ?? "Failed to generate questions. Please try again."}</p>
              <button onClick={handleClose} className="px-6 py-2.5 rounded-xl bg-foreground text-background font-semibold text-sm hover:opacity-85 transition-opacity">
                Close
              </button>
            </div>
          )}

          {/* ── Countdown phase ── */}
          {phase === "countdown" && <CountdownPhase count={countdownNum} />}

          {/* ── Active: MCQ ── */}
          {phase === "active" && data.type === "mcq" && currentMCQ && (
            <MCQPhase
              question={currentMCQ}
              currentIdx={currentIdx}
              total={totalQ}
              selected={currentAnswer}
              advancing={advancingFromIdx !== null}
              advanceProgress={advanceProgress}
              onAnswer={handleMCQAnswer}
            />
          )}

          {/* ── Active: Essay ── */}
          {phase === "active" && data.type === "essay" && currentEssay && (
            <EssayPhase
              question={currentEssay}
              currentIdx={currentIdx}
              total={totalQ}
              revealed={!!essayRevealed[currentIdx]}
              isLast={isLastQ}
              onReveal={handleEssayReveal}
              onNext={handleEssayNext}
            />
          )}

          {/* ── Done phase ── */}
          {phase === "done" && (
            <DonePhase
              type={data.type}
              correct={correctCount}
              total={totalQ}
              pct={pct}
              topic={data.topic}
              onClose={handleClose}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── BuildingPhase ──────────────────────────────────────────────────────────────

function BuildingPhase({ topic, type }: { topic: string; type: "mcq" | "essay" }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 gap-7">
      {/* Assembling blocks */}
      <div className="grid grid-cols-3 gap-2.5">
        {Array.from({ length: 9 }).map((_, i) => (
          <div
            key={i}
            className="w-11 h-11 rounded-2xl bg-muted"
            style={{ animation: `buildBlock 0.5s cubic-bezier(0.34,1.56,0.64,1) ${i * 0.09}s both` }}
          />
        ))}
      </div>

      <div className="text-center">
        <p className="text-base font-bold text-foreground mb-1">Assembling your practice session…</p>
        <p className="text-sm text-muted-foreground">
          Crafting {type === "mcq" ? "MCQs" : "essay questions"} for <span className="text-foreground font-semibold">{topic || "your topic"}</span>
        </p>
      </div>

      {/* Indeterminate progress bar */}
      <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden relative">
        <div
          className="absolute top-0 h-full bg-foreground/50 rounded-full"
          style={{ animation: "indetermBar 1.6s ease-in-out infinite" }}
        />
      </div>
    </div>
  );
}

// ── CountdownPhase ─────────────────────────────────────────────────────────────

function CountdownPhase({ count }: { count: number }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 gap-3">
      <div
        key={count}
        className="text-[96px] font-black text-foreground leading-none tabular-nums select-none"
        style={{ animation: "countPop 0.45s cubic-bezier(0.34,1.56,0.64,1) both" }}
      >
        {count === 0 ? "GO!" : count}
      </div>
      <p className="text-sm text-muted-foreground font-medium">
        {count === 3 ? "Take a breath…" : count === 2 ? "Stay focused…" : count === 1 ? "Almost…" : "Let's go!"}
      </p>
    </div>
  );
}

// ── MCQPhase ───────────────────────────────────────────────────────────────────

function MCQPhase({
  question, currentIdx, total, selected, advancing, advanceProgress, onAnswer,
}: {
  question: FreshMCQ;
  currentIdx: number;
  total: number;
  selected?: string;
  advancing: boolean;
  advanceProgress: number;
  onAnswer: (letter: string) => void;
}) {
  const isCorrect = selected ? selected === question.answer : false;

  return (
    <div className="flex flex-col overflow-hidden" style={{ maxHeight: "calc(100dvh - 90px)" }}>
      {/* Top progress */}
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground rounded-full transition-all duration-500"
              style={{ width: `${(currentIdx / total) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums font-semibold flex-shrink-0">
            {currentIdx + 1} / {total}
          </span>
        </div>

        {/* Advance countdown bar */}
        {advancing && (
          <div className="h-0.5 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-none ${isCorrect ? "bg-green-400" : "bg-red-400"}`}
              style={{ width: `${advanceProgress}%` }}
            />
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 momentum-scroll">
        {/* Question text */}
        <p className="text-[17px] font-bold text-foreground leading-snug mb-5" style={{ animation: "optionReveal 0.3s ease both" }}>
          {question.question}
        </p>

        {/* Options */}
        <div className="flex flex-col gap-3">
          {question.options.map((opt, oi) => {
            const letter = ["A", "B", "C", "D"][oi];
            const isThisCorrect = letter === question.answer;
            const isThisSelected = letter === selected;

            let optCls = "bg-muted/30 border-border text-foreground hover:bg-muted/60 hover:border-foreground/20 cursor-pointer";
            if (selected) {
              if (isThisCorrect) optCls = "bg-green-500/15 border-green-400/60 text-green-300 scale-[1.01]";
              else if (isThisSelected) optCls = "bg-red-500/15 border-red-400/60 text-red-300";
              else optCls = "bg-transparent border-border/20 text-muted-foreground/30 cursor-default";
            }

            return (
              <button
                key={oi}
                onClick={() => onAnswer(letter)}
                disabled={!!selected || advancing}
                className={`w-full flex items-center gap-3 px-4 py-4 rounded-2xl border text-sm font-medium text-left transition-all duration-250 ${optCls}`}
                style={{ animation: `optionReveal 0.3s ease ${oi * 0.06}s both` }}
              >
                <span className="w-7 h-7 rounded-xl bg-background/40 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {letter}
                </span>
                <span className="flex-1 leading-snug">{opt.replace(/^[A-D]\.\s*/i, "")}</span>
                {selected && isThisCorrect && <CheckCircle className="w-5 h-5 flex-shrink-0 text-green-400" />}
                {selected && isThisSelected && !isThisCorrect && <XCircle className="w-5 h-5 flex-shrink-0 text-red-400" />}
              </button>
            );
          })}
        </div>

        {/* Feedback banner */}
        {selected && (
          <div
            className={`mt-4 py-3 px-4 rounded-2xl text-sm font-bold text-center ${isCorrect ? "bg-green-500/12 text-green-400" : "bg-red-500/12 text-red-400"}`}
            style={{ animation: "feedbackSlide 0.3s ease both" }}
          >
            {isCorrect ? "✓ Correct!" : `✗ Wrong — correct answer: ${question.answer}`}
            {!isCorrect && question.explanation && (
              <p className="text-xs font-normal text-muted-foreground mt-1.5 leading-relaxed text-left">{question.explanation}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EssayPhase ─────────────────────────────────────────────────────────────────

function EssayPhase({
  question, currentIdx, total, revealed, isLast, onReveal, onNext,
}: {
  question: EssayQuestion;
  currentIdx: number;
  total: number;
  revealed: boolean;
  isLast: boolean;
  onReveal: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col overflow-hidden" style={{ maxHeight: "calc(100dvh - 90px)" }}>
      {/* Progress */}
      <div className="px-5 pt-5 pb-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-foreground rounded-full transition-all duration-500"
              style={{ width: `${(currentIdx / total) * 100}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums font-semibold flex-shrink-0">{currentIdx + 1} / {total}</span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 pb-6 momentum-scroll">
        {/* Question */}
        <p className="text-[17px] font-bold text-foreground leading-snug mb-4" style={{ animation: "optionReveal 0.3s ease both" }}>
          {question.question}
        </p>

        {/* Key points */}
        {question.key_points && question.key_points.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {question.key_points.map((kp, i) => (
              <span key={i} className="text-[11px] px-2.5 py-1 rounded-lg bg-muted border border-border text-muted-foreground font-medium">
                {kp}
              </span>
            ))}
          </div>
        )}

        {/* Reveal / model answer */}
        {!revealed ? (
          <button
            onClick={onReveal}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-muted border border-border text-foreground font-semibold text-sm hover:bg-muted/70 transition-colors"
          >
            <Eye className="w-4 h-4" />
            Show Model Answer
          </button>
        ) : (
          <div className="rounded-2xl bg-muted/40 border border-border/60 overflow-hidden" style={{ animation: "feedbackSlide 0.3s ease both" }}>
            <div className="px-4 py-2.5 border-b border-border/40">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/50">Model Answer</p>
            </div>
            <div className="px-4 py-4">
              <p className="text-sm text-foreground/80 leading-relaxed">{question.ideal_answer}</p>
            </div>
          </div>
        )}

        {/* Next / Finish button */}
        {revealed && (
          <button
            onClick={onNext}
            className="w-full mt-4 py-4 rounded-2xl bg-foreground text-background font-bold text-sm hover:opacity-85 transition-opacity"
            style={{ animation: "feedbackSlide 0.3s ease 0.15s both" }}
          >
            {isLast ? "Finish Review →" : "Next Question →"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── DonePhase ──────────────────────────────────────────────────────────────────

function DonePhase({ type, correct, total, pct, topic, onClose }: {
  type: "mcq" | "essay";
  correct: number;
  total: number;
  pct: number;
  topic: string;
  onClose: () => void;
}) {
  const good = pct >= 70;
  const mid  = pct >= 50;

  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 gap-5 text-center">
      {type === "mcq" ? (
        <>
          {/* Score */}
          <div
            className={`text-[80px] font-black leading-none tabular-nums ${good ? "text-green-400" : mid ? "text-yellow-400" : "text-red-400"}`}
            style={{ animation: "doneScale 0.6s cubic-bezier(0.34,1.56,0.64,1) both" }}
          >
            {pct}%
          </div>

          <div>
            <p className="text-lg font-bold text-foreground mb-1">
              {good ? "Solid work! 🎯" : mid ? "Not bad — keep pushing" : "Room to grow — let's fix it"}
            </p>
            <p className="text-sm text-muted-foreground">
              {correct} of {total} correct on <span className="text-foreground font-semibold">{topic}</span>
            </p>
          </div>

          {/* Score bar */}
          <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-[width] duration-1000 ease-out ${good ? "bg-green-400" : mid ? "bg-yellow-400" : "bg-red-400"}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </>
      ) : (
        <>
          <div style={{ animation: "doneScale 0.6s cubic-bezier(0.34,1.56,0.64,1) both" }}>
            <Trophy className="w-16 h-16 text-foreground/60 mx-auto" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground mb-1">Review complete!</p>
            <p className="text-sm text-muted-foreground">
              You reviewed {total} essay questions on <span className="text-foreground font-semibold">{topic}</span>
            </p>
          </div>
        </>
      )}

      <button
        onClick={onClose}
        className="w-full py-4 rounded-2xl bg-foreground text-background font-bold text-base hover:opacity-85 transition-opacity"
        style={{ animation: "feedbackSlide 0.4s ease 0.3s both" }}
      >
        Back to Coach →
      </button>

      <p className="text-xs text-muted-foreground/40">The coach will review your results and suggest what's next</p>
    </div>
  );
}

// ── InlinePracticeCard (trigger only) ─────────────────────────────────────────

function InlinePracticeCard({
  topic,
  count,
  onStartPractice,
}: {
  topic: string;
  count: number;
  onStartPractice: (type: "mcq" | "essay", topic: string, count: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <Dumbbell className="w-3 h-3 text-muted-foreground/40" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40">
          AI Coach Practice{topic ? ` — ${topic}` : ""}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onStartPractice("mcq", topic, count)}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-foreground text-background font-bold text-sm hover:opacity-85 transition-opacity"
        >
          <BookOpen className="w-4 h-4" />
          MCQs
        </button>
        <button
          onClick={() => onStartPractice("essay", topic, count)}
          className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl bg-muted border border-border text-foreground/70 font-semibold text-sm hover:text-foreground hover:bg-muted/70 transition-colors"
        >
          <FileText className="w-4 h-4" />
          Essays
        </button>
      </div>
    </div>
  );
}

// ── Helper: strip performance context from message display ─────────────────────

function stripPerformanceContext(content: string): string {
  // Remove the performance context block that starts with "[Student Performance Context..."
  // The context is followed by double newline before the actual user message
  const contextMarker = "[Student Performance Context — use this to personalise your advice]";
  if (!content.includes(contextMarker)) return content;
  
  // Find where the context starts
  const idx = content.indexOf(contextMarker);
  if (idx === -1) return content;
  
  // Look for double newline after the context (which separates context from user message)
  const doubleNewlineIdx = content.indexOf("\n\n", idx);
  if (doubleNewlineIdx === -1) return content;
  
  // Return everything after the double newline, trimmed
  return content.substring(doubleNewlineIdx + 2).trim();
}

// ── MessageBubble ──────────────────────────────────────────────────────────────

const MessageBubble = React.memo(function MessageBubble({
  msg,
  onQuickReply,
  onStartPractice,
  onPracticeGenerated,
}: {
  msg: Message;
  onQuickReply?: (text: string) => void;
  onStartPractice: (type: "mcq" | "essay", topic: string, count: number) => void;
  onPracticeGenerated?: (type: "mcq" | "essay", topic: string, msgId: string) => void;
}) {
  const isUser = msg.role === "user";
  const isThinking = msg.content === "…";
  const meta = msg.ai_metadata;
  const displayContent = stripPerformanceContext(msg.content);

  if (isUser) {
    return (
      <div id={`msg-${msg.id}`} className="flex justify-end pl-[12%]" style={{ animation: "msg-in 0.2s ease" }}>
        <div className="flex flex-col items-end gap-1 max-w-full">
          {msg.image_data && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={msg.image_data} alt="attachment" className="max-h-[220px] rounded-[18px] object-contain border border-border" />
          )}
          {msg.content && (
            <div className="bg-muted border border-border/50 rounded-[18px_18px_4px_18px] px-3.5 py-2.5 text-foreground text-sm leading-relaxed break-words">
              {displayContent}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div id={`msg-${msg.id}`} className="flex gap-2 pr-[4%]" style={{ animation: "msg-in 0.2s ease" }}>
      <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-foreground/50" />
      </div>

      <div className="flex-1 min-w-0 flex flex-col gap-2">
        {isThinking ? (
          <div className="flex items-center gap-1 px-3.5 py-3 rounded-[4px_16px_16px_16px] bg-card border border-border/50 w-fit">
            {[0, 150, 300].map(d => (
              <div key={d} className="w-1.5 h-1.5 rounded-full bg-foreground/40" style={{ animation: `coach-bounce 1.4s ease-in-out ${d}ms infinite` }} />
            ))}
          </div>
        ) : (
          <>
            <div className="bg-card border border-border/50 rounded-[4px_16px_16px_16px] px-3.5 py-2.5 text-foreground/80 text-sm leading-relaxed whitespace-pre-wrap break-words">
              {displayContent}
            </div>

            {msg.payg_limit && (
              <Link href="/billing" className="inline-flex items-center gap-2 mt-2 px-4 py-2.5 rounded-xl bg-foreground text-background font-semibold text-sm no-underline hover:opacity-85 transition-opacity">
                Buy More Credits →
              </Link>
            )}

            {meta && isValid(meta.check_in) && (
              <CheckInBanner text={meta.check_in!} daysAway={meta.days_since_last} />
            )}


            {meta?.mastery_progress && (
              <div className="flex flex-col gap-1.5 px-3 py-2.5 rounded-xl bg-card border border-border/50">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wide text-muted-foreground/50">
                  <span>Mastery — {meta.mastery_progress.topic}</span>
                  <span>{meta.mastery_progress.current}/{meta.mastery_progress.target}</span>
                </div>
                <MasteryBar current={meta.mastery_progress.current} target={meta.mastery_progress.target} />
              </div>
            )}

            {meta?.topic_chain && meta.topic_chain.length > 0 && (
              <TopicChain chain={meta.topic_chain} />
            )}

            {meta && isValid(meta.calibration_pulse) && (
              <CalibrationPulse text={meta.calibration_pulse!} />
            )}

            {(meta?.practice_topic || meta?.practice_document_id) && (
              <InlinePracticeCard
                topic={meta.practice_topic ?? meta.topic_focus ?? ""}
                count={meta.question_count ?? 5}
                onStartPractice={(type, topic, count) => {
                  onStartPractice(type, topic, count);
                  onPracticeGenerated?.(type, topic, msg.id);
                }}
              />
            )}

            {meta?.action && meta.action !== "greeting" && onQuickReply && (
              <QuickReplies action={meta.action} topicFocus={meta.topic_focus} onSelect={onQuickReply} />
            )}
          </>
        )}
      </div>
    </div>
  );
});

// ── MasteryBar ────────────────────────────────────────────────────────────────

function MasteryBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min((current / Math.max(target, 1)) * 100, 100);
  const color = current >= target ? "#4ade80" : current >= target * 0.65 ? "#facc15" : "#f87171";
  return (
    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

// ── TopicChain ────────────────────────────────────────────────────────────────

function TopicChain({ chain }: { chain: string[] }) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/30">Fix this → unlocks</span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chain.map((topic, i) => (
          <div key={topic} className="flex items-center gap-1.5">
            {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground/30" />}
            <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-muted border border-border text-muted-foreground">{topic}</span>
          </div>
        ))}
      </div>
    </div>
  );
}


// ── CalibrationPulse ──────────────────────────────────────────────────────────

function CalibrationPulse({ text }: { text: string }) {
  return (
    <div className="rounded-xl px-4 py-3 bg-orange-500/10 border border-orange-500/20 flex items-start gap-3">
      <div className="flex-shrink-0 mt-1">
        <div className="w-2 h-2 rounded-full bg-orange-400" style={{ animation: "pulse-ring 1.6s ease-out infinite" }} />
      </div>
      <div>
        <p className="text-[10px] font-extrabold uppercase tracking-widest text-orange-400 mb-1.5 m-0">Calibration alert</p>
        <p className="text-sm leading-relaxed text-orange-200/80 m-0">{text}</p>
      </div>
    </div>
  );
}

// ── CheckInBanner ─────────────────────────────────────────────────────────────

function CheckInBanner({ text, daysAway }: { text: string; daysAway?: number | null }) {
  const [dismissed, setDismissed] = useState(false);
  const displayDays = typeof daysAway === "number" && Number.isFinite(daysAway) ? daysAway : undefined;
  if (dismissed) return null;

  return (
    <div className="rounded-xl px-3.5 py-2.5 bg-card border border-border/50 flex items-center gap-2.5">
      <Clock className="w-3.5 h-3.5 text-muted-foreground/40 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/40 mr-2">
          {displayDays != null ? `${displayDays}d away` : "Welcome back"}
        </span>
        <span className="text-xs text-muted-foreground/60">{text}</span>
      </div>
      <button onClick={() => setDismissed(true)} className="flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground/30 hover:text-muted-foreground transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── QuickReplies ──────────────────────────────────────────────────────────────

function QuickReplies({ action, topicFocus, onSelect }: {
  action: string; topicFocus?: string | null; onSelect: (text: string) => void;
}) {
  const base = QUICK_REPLIES[action] ?? QUICK_REPLIES["off_topic"];
  const replies = base.map(r => (topicFocus ? r.replace(/\bthis\b/gi, topicFocus) : r));

  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
      {replies.map((reply, i) => (
        <button
          key={i}
          onClick={() => onSelect(reply)}
          className="flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium bg-card border border-border/50 text-muted-foreground whitespace-nowrap cursor-pointer hover:text-foreground hover:border-border hover:bg-muted/30 transition-all font-[inherit]"
        >
          {reply}
        </button>
      ))}
    </div>
  );
}

// ── Page export ────────────────────────────────────────────────────────────────

import { CoachSkeleton } from "./CoachSkeleton";

export default function CoachPage({ initialConvId }: { initialConvId?: string } = {}) {
  return (
    <Suspense fallback={<CoachSkeleton />}>
      <CoachPageInner initialConvId={initialConvId} />
    </Suspense>
  );
}
