"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/auth";
import {
  coachListConversations,
  coachCreateConversation,
  coachGetConversation,
  coachDeleteConversation,
  coachSendMessage,
  coachSearch,
  QuizResult,
} from "@/lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

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
  practice_topic?: string | null;          // always present when there's a practice CTA
  practice_questions?: { id: string; document_id: number; topic: string; preview: string }[];
  // Hard-data enrichments (not AI-generated)
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
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByDate(convs: Conversation[]): { label: string; items: Conversation[] }[] {
  const now = new Date();
  const today = now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayStr = yesterday.toDateString();
  const weekAgo = new Date(now);
  weekAgo.setDate(now.getDate() - 7);

  const groups: Record<string, Conversation[]> = {
    Today: [],
    Yesterday: [],
    "This week": [],
    Older: [],
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

function urgencyColor(urgency?: string) {
  switch (urgency) {
    case "critical": return "#f87171";
    case "high":     return "#fb923c";
    case "medium":   return "#facc15";
    default:         return "#4ade80";
  }
}

function isValid(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "null" && normalized !== "none";
  }
  return true;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CoachPage({ initialConvId }: { initialConvId?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnConvId = initialConvId ?? searchParams.get("conv");
  const quizScore = searchParams.get("quiz_score");
  const quizTotal = searchParams.get("quiz_total");
  const quizPct   = searchParams.get("quiz_pct");
  const quizTopic = searchParams.get("quiz_topic");   // topic practiced in fresh-mode quiz
  const autoQ     = searchParams.get("q");

  // Sidebar state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Active conversation
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [convTitle, setConvTitle] = useState("New Conversation");
  const [loadingConv, setLoadingConv] = useState(false);
  const [pendingAutoMsg, setPendingAutoMsg] = useState<string | null>(null);

  // Input state
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMime, setImageMime] = useState<string | null>(null);

  // UI refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Open sidebar by default only on large screens
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth >= 1024) {
      setSidebarOpen(true);
    }
  }, []);

  // Sync URL to active conversation (no page reload)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = activeId ? `/coach/${activeId}` : "/coach";
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }, [activeId]);

  // Global keypress → focus textarea
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return; // skip non-printable (arrows, F-keys, etc.)
      e.preventDefault();
      textareaRef.current?.focus();
      setInput(prev => prev + e.key);
    };
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // ── Search ──────────────────────────────────────────────────────────────────

  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!val.trim()) { setSearchResults(null); return; }
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await coachSearch(val.trim());
        setSearchResults(res.data);
      } catch {
        setSearchResults([]);
      }
    }, 300);
  };

  // ── Load conversation ────────────────────────────────────────────────────────

  const loadConversation = useCallback(async (id: string) => {
    setLoadingConv(true);
    setMessages([]);
    setActiveId(id);
    try {
      const res = await coachGetConversation(id);
      setMessages(res.data.messages || []);
      setConvTitle(res.data.title || "Conversation");
    } catch {
      setMessages([]);
    } finally {
      setLoadingConv(false);
    }
  }, []);

  // ── Init (placed after loadConversation to avoid temporal dead zone) ──────────

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    // Also detect UUID in the URL path for direct navigation (e.g. /coach/uuid)
    const pathSegments = typeof window !== "undefined" ? window.location.pathname.split("/") : [];
    const pathConvId = pathSegments[2] || null;  // /coach/[id]
    const targetConvId = returnConvId || pathConvId;
    
    // Debug logging for quiz params
    if (quizScore || quizTotal) {
      console.log(`[Coach] Quiz params detected: score=${quizScore}/${quizTotal} (${quizPct}%)`);
    }
    
    coachListConversations()
      .then(async res => {
        setConversations(res.data);
        if (targetConvId) {
          console.log(`[Coach] Loading conversation: ${targetConvId}`);
          await loadConversation(targetConvId);
          // Queue quiz result message — sent once activeId state settles (see effect below)
          if (quizScore !== null && quizTotal !== null) {
            const pct = quizPct ?? Math.round((parseInt(quizScore) / parseInt(quizTotal)) * 100);
            const topicPart = quizTopic ? ` on ${quizTopic}` : "";
            const msg = `I just finished the practice quiz${topicPart} and scored ${quizScore}/${quizTotal} (${pct}%). How did I do and what should I focus on next?`;
            console.log(`[Coach] Setting pending message: ${msg}`);
            setPendingAutoMsg(msg);
          }
        } else if (autoQ) {
          // ?q= param: auto-send a message into a fresh conversation
          setPendingAutoMsg(autoQ);
        }
      })
      .catch((err) => {
        console.error("[Coach] Failed to load conversations:", err);
      });
  }, [router, returnConvId, loadConversation, quizScore, quizTotal, quizPct, autoQ]);

  // ── Auto-send pending quiz result once activeId is ready ─────────────────────
  useEffect(() => {
    if (!pendingAutoMsg || !activeId || sending) return;
    console.log(`[Coach] Auto-sending pending message with activeId=${activeId}`);
    const msg = pendingAutoMsg;
    setPendingAutoMsg(null);
    // If this auto-message is a quiz result, pass structured data so the backend
    // can save it to memory automatically (score + topic).
    const qr: QuizResult | undefined =
      quizScore && quizTotal && quizTopic
        ? { topic: quizTopic, score: parseInt(quizScore), total: parseInt(quizTotal) }
        : undefined;
    handleSend(msg, qr);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, pendingAutoMsg]);

  // ── New chat ─────────────────────────────────────────────────────────────────

  const handleNewChat = async () => {
    try {
      const res = await coachCreateConversation();
      const newConv: Conversation = res.data;
      setConversations(prev => [newConv, ...prev]);
      setActiveId(newConv.id);
      setMessages([]);
      setConvTitle("New Conversation");
    } catch {}
  };

  // ── Delete conversation ──────────────────────────────────────────────────────

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

  // ── Image attachment ─────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    applyImageFile(file);
    e.target.value = "";
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageMime(null);
  };

  const applyImageFile = (file: File) => {
    setImageFile(file);
    setImageMime(file.type);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  // Paste image from clipboard (Ctrl+V / Cmd+V)
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

  // ── Send message ─────────────────────────────────────────────────────────────

  const handleSend = async (overrideText?: string, quizResult?: QuizResult) => {
    const text = overrideText !== undefined ? overrideText.trim() : input.trim();
    if ((!text && !imagePreview) || sending) return;

    const imgData = overrideText !== undefined ? null : imagePreview;
    const imgMime = overrideText !== undefined ? null : imageMime;
    if (overrideText === undefined) { setInput(""); removeImage(); } else { setInput(""); }
    setSending(true);

    // Ensure we have a conversation
    let convId = activeId;
    if (!convId) {
      try {
        const res = await coachCreateConversation();
        convId = res.data.id;
        setActiveId(convId);
        setConversations(prev => [res.data, ...prev]);
      } catch {
        setSending(false);
        return;
      }
    }

    // Optimistic user message
    const optimisticUser: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      image_data: imgData,
      image_mime: imgMime,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticUser]);

    // Thinking placeholder
    const thinkingId = `thinking-${Date.now()}`;
    const thinkingMsg: Message = {
      id: thinkingId,
      role: "assistant",
      content: "…",
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, thinkingMsg]);

    try {
      const res = await coachSendMessage(convId!, text, imgData ?? undefined, imgMime ?? undefined, quizResult);
      const { user_message, assistant_message } = res.data;

      setMessages(prev =>
        prev
          .filter(m => m.id !== optimisticUser.id && m.id !== thinkingId)
          .concat([user_message, assistant_message])
      );

      // Update title + conversation list
      if (assistant_message) {
        setConversations(prev =>
          prev.map(c =>
            c.id === convId
              ? { ...c, updated_at: new Date().toISOString(), title: text.slice(0, 60) || c.title, message_count: (c.message_count || 0) + 2 }
              : c
          )
        );
        setConvTitle(text.slice(0, 60) || convTitle);
      }
    } catch {
      setMessages(prev => prev.filter(m => m.id !== thinkingId));
      const errMsg: Message = {
        id: `err-${Date.now()}`,
        role: "assistant",
        content: "I'm temporarily offline. Check your connection and try again.",
        created_at: new Date().toISOString(),
      };
      setMessages(prev => [...prev.filter(m => m.id !== optimisticUser.id), optimisticUser, errMsg]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Displayed conversations (search vs full list) ────────────────────────────

  const displayedConvs = searchResults ?? conversations;
  const grouped = groupByDate(displayedConvs);

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "#0d0f1c", color: "#e2e8f0" }}>

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <aside
        className="flex-shrink-0 flex flex-col transition-all duration-200"
        style={{
          width: sidebarOpen ? 260 : 0,
          minWidth: sidebarOpen ? 260 : 0,
          overflow: "hidden",
          backgroundColor: "#0b0d1a",
          borderRight: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <div style={{ width: 260 }} className="flex flex-col h-full">
          {/* Logo + toggle */}
          <div className="flex items-center justify-between px-4 py-5">
            <Link href="/dashboard" className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl flex items-center justify-center font-black text-white text-xs flex-shrink-0" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
                cQ
              </div>
              <span className="text-white font-bold text-sm">CortexQ</span>
            </Link>
          </div>

          {/* New chat button */}
          <div className="px-3 mb-3">
            <button
              onClick={handleNewChat}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
              style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", color: "#e2e8f0" }}
              onMouseEnter={e => (e.currentTarget.style.background = "rgba(123,47,255,0.15)")}
              onMouseLeave={e => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
            >
              <span className="material-symbols-outlined text-[16px]" style={{ color: "#7B2FFF" }}>add</span>
              New chat
            </button>
          </div>

          {/* Search */}
          <div className="px-3 mb-3">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
              <span className="material-symbols-outlined text-[16px]" style={{ color: "#4a5280" }}>search</span>
              <input
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search conversations…"
                className="flex-1 bg-transparent text-xs text-white placeholder:text-slate-600 outline-none"
              />
              {searchQuery && (
                <button onClick={() => handleSearchChange("")} className="text-slate-600 hover:text-white">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto px-2 space-y-4 pb-4">
            {searchQuery && searchResults?.length === 0 && (
              <p className="text-xs px-3 py-2" style={{ color: "#4a5280" }}>No results for "{searchQuery}"</p>
            )}
            {grouped.map(group => (
              <div key={group.label}>
                <p className="text-[10px] font-bold uppercase tracking-widest px-3 mb-1" style={{ color: "#3a3f60" }}>{group.label}</p>
                {group.items.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => loadConversation(conv.id)}
                    className="group relative flex items-center gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-all"
                    style={{
                      background: activeId === conv.id ? "rgba(123,47,255,0.15)" : "transparent",
                      borderLeft: activeId === conv.id ? "2px solid #7B2FFF" : "2px solid transparent",
                    }}
                    onMouseEnter={e => { if (activeId !== conv.id) e.currentTarget.style.background = "rgba(255,255,255,0.04)"; }}
                    onMouseLeave={e => { if (activeId !== conv.id) e.currentTarget.style.background = "transparent"; }}
                  >
                    <span className="material-symbols-outlined text-[15px] flex-shrink-0" style={{ color: activeId === conv.id ? "#7B2FFF" : "#4a5280" }}>chat</span>
                    <p className="text-xs text-white truncate flex-1 font-medium">{conv.title}</p>
                    <button
                      onClick={e => handleDelete(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      style={{ color: "#4a5280" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#f87171")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#4a5280")}
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                    </button>
                  </div>
                ))}
              </div>
            ))}
            {conversations.length === 0 && !searchQuery && (
              <p className="text-xs px-3 py-2" style={{ color: "#4a5280" }}>No conversations yet. Start a new chat!</p>
            )}
          </div>

          {/* Dashboard link */}
          <div className="px-3 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
            <Link href="/dashboard" className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs transition-colors" style={{ color: "#4a5280" }}
              onMouseEnter={e => (e.currentTarget.style.color = "#e2e8f0")}
              onMouseLeave={e => (e.currentTarget.style.color = "#4a5280")}
            >
              <span className="material-symbols-outlined text-[16px]">arrow_back</span>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ───────────────────────────────────────────────────────── */}
      <div className="flex flex-col flex-1 min-w-0">

        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "#0d0f1c" }}>
          <button
            onClick={() => setSidebarOpen(p => !p)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: "#4a5280" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#e2e8f0")}
            onMouseLeave={e => (e.currentTarget.style.color = "#4a5280")}
          >
            <span className="material-symbols-outlined text-[20px]">menu</span>
          </button>

          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
              <span className="material-symbols-outlined text-[14px] text-white">smart_toy</span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white truncate">{activeId ? convTitle : "CortexQ Coach"}</p>
              <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#4a5280" }}>AI Advisor · Medical Study Coach</p>
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          <div className="max-w-3xl mx-auto space-y-6">

            {/* Empty state */}
            {!activeId && messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full pt-24 space-y-6">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
                  <span className="material-symbols-outlined text-[32px] text-white">smart_toy</span>
                </div>
                <div className="text-center space-y-2">
                  <h2 className="text-2xl font-black text-white">What would you like to study?</h2>
                  <p className="text-sm" style={{ color: "#4a5280" }}>I have full visibility into your performance data. Ask me anything.</p>
                </div>
                <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
                  {[
                    "What are my weakest topics right now?",
                    "Give me a 10-minute study plan",
                    "How can I fix my overconfidence?",
                    "Which topic should I practice first?",
                  ].map(prompt => (
                    <button
                      key={prompt}
                      onClick={() => handleSend(prompt)}
                      className="px-4 py-3 rounded-xl text-xs text-left transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8" }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(123,47,255,0.4)"; e.currentTarget.style.color = "#e2e8f0"; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#94a3b8"; }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading conversation */}
            {loadingConv && (
              <div className="flex justify-center pt-12">
                <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(123,47,255,0.2)", borderTopColor: "#7B2FFF" }} />
              </div>
            )}

            {/* Message list */}
            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                convId={activeId}
                onQuickReply={(text) => handleSend(text)}
              />
            ))}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input area */}
        <div className="flex-shrink-0 px-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="max-w-3xl mx-auto">

            {/* Image preview */}
            {imagePreview && (
              <div className="mb-3 relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imagePreview} alt="attachment" className="h-20 rounded-xl object-cover" style={{ border: "1px solid rgba(255,255,255,0.1)" }} />
                <button
                  onClick={removeImage}
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-white"
                  style={{ background: "#f87171" }}
                >
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              </div>
            )}

            <div className="flex items-end gap-2 rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
              {/* Image attach */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-shrink-0 p-1.5 rounded-lg transition-colors mb-0.5"
                style={{ color: "#4a5280" }}
                onMouseEnter={e => (e.currentTarget.style.color = "#e2e8f0")}
                onMouseLeave={e => (e.currentTarget.style.color = "#4a5280")}
                title="Attach image (or paste from clipboard)"
              >
                <span className="material-symbols-outlined text-[20px]">attach_file</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* Text input */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the coach anything… (Shift+Enter for new line)"
                rows={1}
                className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-600 outline-none resize-none leading-relaxed"
                style={{ maxHeight: 160 }}
              />

              {/* Send */}
              <button
                onClick={() => handleSend()}
                disabled={sending || (!input.trim() && !imagePreview)}
                className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all disabled:opacity-40 mb-0.5"
                style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}
              >
                {sending
                  ? <div className="w-3.5 h-3.5 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(255,255,255,0.3)", borderTopColor: "white" }} />
                  : <span className="material-symbols-outlined text-[16px] text-white">arrow_upward</span>
                }
              </button>
            </div>

            <p className="text-[10px] text-center mt-2" style={{ color: "#2a2f50" }}>
              CortexQ Coach uses your real performance data — responses are specific to you.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MessageBubble component ───────────────────────────────────────────────────

function MessageBubble({ msg, convId, onQuickReply }: { msg: Message; convId?: string | null; onQuickReply?: (text: string) => void }) {
  const isUser = msg.role === "user";
  const isThinking = msg.content === "…";
  const meta = msg.ai_metadata;

  if (isUser) {
    return (
      <div className="flex justify-end gap-3">
        <div className="max-w-xl">
          {msg.image_data && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={msg.image_data} alt="attachment" className="mb-2 rounded-xl max-h-64 object-contain" style={{ border: "1px solid rgba(255,255,255,0.1)" }} />
          )}
          {msg.content && (
            <div className="px-4 py-3 rounded-2xl rounded-tr-sm text-sm" style={{ background: "rgba(123,47,255,0.25)", border: "1px solid rgba(123,47,255,0.3)", color: "#e2e8f0" }}>
              {msg.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isStudyAction = isValid(meta?.action) && meta && meta.action && !["greeting", "off_topic"].includes(meta.action);
  const urgColor = urgencyColor(meta && isValid(meta.urgency) ? meta.urgency : undefined);

  // Assistant message
  return (
    <div className="flex gap-3 group">
      {/* Avatar */}
      <div
        className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-1"
        style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", boxShadow: "0 0 12px rgba(123,47,255,0.3)" }}
      >
        <span className="material-symbols-outlined text-[15px] text-white">smart_toy</span>
      </div>

      <div className="flex-1 min-w-0" style={{ display: "flex", flexDirection: "column", gap: 10 }}>

        {/* ── Thinking ── */}
        {isThinking ? (
          <div
            className="flex items-center gap-1.5 px-4 py-3.5 rounded-2xl rounded-tl-sm w-fit"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            {[0, 160, 320].map(d => (
              <div
                key={d}
                className="w-1.5 h-1.5 rounded-full animate-bounce"
                style={{ background: "#7B2FFF", animationDelay: `${d}ms` }}
              />
            ))}
          </div>
        ) : (
          <>
            {/* ── 1. Check-in banner (above everything) ── */}
            {meta && isValid(meta.check_in) && (
              <CheckInBanner text={meta.check_in!} daysAway={meta.days_since_last} />
            )}

            {/* ── 2. Main response bubble ── */}
            <div
              className="text-sm leading-[1.7]"
              style={{
                background: "rgba(255,255,255,0.035)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 16,
                borderTopLeftRadius: 4,
                padding: "14px 18px",
                color: "#cbd5e1",
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.content}
            </div>

            {/* ── 3. Unified Action Card ── */}
            {isStudyAction && isValid(meta?.next_step) && (
              <div
                style={{
                  background: "linear-gradient(135deg, rgba(123,47,255,0.12), rgba(0,210,253,0.06))",
                  border: "1px solid rgba(123,47,255,0.22)",
                  borderRadius: 16,
                  overflow: "hidden",
                }}
              >
                {/* Card header — topic + badges */}
                <div
                  className="flex items-center gap-2 flex-wrap px-4 pt-3.5 pb-2"
                  style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <span
                    className="material-symbols-outlined text-[15px]"
                    style={{ color: "#a78bfa" }}
                  >
                    bolt
                  </span>
                  {isValid(meta.topic_focus) && (
                    <span className="text-[11px] font-bold tracking-wide" style={{ color: "#c4b5fd" }}>
                      {meta.topic_focus!.toUpperCase()}
                    </span>
                  )}
                  <div className="flex-1" />
                  {meta.urgency && meta.urgency !== "low" && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest"
                      style={{
                        background: `${urgColor}18`,
                        color: urgColor,
                        border: `1px solid ${urgColor}35`,
                        letterSpacing: "0.08em",
                      }}
                    >
                      {meta.urgency}
                    </span>
                  )}
                  {meta.is_relapse && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[9px] font-bold"
                      style={{ background: "rgba(251,146,60,0.15)", color: "#fb923c", border: "1px solid rgba(251,146,60,0.3)" }}
                    >
                      relapse ↩
                    </span>
                  )}
                </div>

                {/* Next step text */}
                <div className="px-4 pt-3 pb-1">
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#6d5fbc" }}>
                    Your next move
                  </p>
                  <p className="text-sm font-semibold" style={{ color: "#e2e8f0" }}>
                    {meta.next_step}
                  </p>
                  {isValid(meta.session_prediction) && (
                    <p className="text-[11px] mt-1.5" style={{ color: "#6d6f8a" }}>
                      ⏱ {meta.session_prediction}
                    </p>
                  )}
                </div>

                {/* Mastery bar */}
                {meta.mastery_progress && (
                  <div className="px-4 pt-3 pb-1">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-semibold" style={{ color: "#6d5fbc" }}>
                        Mastery gap
                      </span>
                      <span className="text-[10px] tabular-nums" style={{ color: "#6d6f8a" }}>
                        {meta.mastery_progress.current}%
                        <span style={{ color: "#3a3f60" }}> / </span>
                        {meta.mastery_progress.target}% target
                      </span>
                    </div>
                    <MasteryBar
                      current={meta.mastery_progress.current}
                      target={meta.mastery_progress.target}
                    />
                  </div>
                )}

                {/* Topic unlock chain */}
                {meta.topic_chain && meta.topic_chain.length > 0 && (
                  <div
                    className="px-4 py-3"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.04)", marginTop: 4 }}
                  >
                    <TopicChain chain={meta.topic_chain} />
                  </div>
                )}
              </div>
            )}

            {/* ── 4. Why this matters (collapsible) ── */}
            {isStudyAction && isValid(meta?.why_this_matters) && (
              <WhyThisMatters
                text={meta.why_this_matters!}
                urgency={meta?.urgency}
                isRelapse={meta.is_relapse}
              />
            )}

            {/* ── 5. Calibration pulse ── */}
            {meta && isValid(meta.calibration_pulse) && (
              <CalibrationPulse text={meta.calibration_pulse!} />
            )}

            {/* ── 6. Practice CTA ── */}
            {/* Show CTA if we have either a topic (for fresh generation) or a document_id */}
            {(meta?.practice_topic || meta?.practice_document_id) && (() => {
              const topic   = meta.practice_topic ?? meta.topic_focus ?? "";
              const docId   = meta.practice_document_id ?? 0;
              const count   = meta.question_count ?? 5;
              const fromStr = convId ? `&from=${convId}` : "";
              // Always use fresh=true when we have a topic — generates new questions every time
              const href = topic
                ? `/quiz/${docId || 1}?count=${count}${fromStr}&fresh=true&topic=${encodeURIComponent(topic)}`
                : `/quiz/${docId}?count=${count}${fromStr}`;
              return (
                <Link
                  href={href}
                  className="flex items-center justify-center gap-2.5 w-full font-bold text-white transition-all"
                  style={{
                    background: "linear-gradient(135deg, #7B2FFF, #00D2FD)",
                    borderRadius: 14,
                    padding: "13px 20px",
                    fontSize: 14,
                    letterSpacing: "0.01em",
                    boxShadow: "0 4px 20px rgba(123,47,255,0.35)",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "0.88"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "translateY(0)"; }}
                >
                  <span className="material-symbols-outlined text-[18px]">play_circle</span>
                  Practice {isValid(topic) ? `"${topic}"` : "now"} →
                </Link>
              );
            })()}

            {/* ── 7. Encouraging note ── */}
            {meta && isValid(meta.encouraging_note) && (
              <p
                className="text-[11px] italic px-1"
                style={{ color: "#3a3f60" }}
              >
                {meta.encouraging_note!}
              </p>
            )}

            {/* ── 8. Quick replies ── */}
            {meta?.action && meta.action !== "greeting" && onQuickReply && (
              <QuickReplies
                action={meta.action}
                topicFocus={meta.topic_focus}
                onSelect={onQuickReply}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── MasteryBar ────────────────────────────────────────────────────────────────

function MasteryBar({ current, target }: { current: number; target: number }) {
  const pct = Math.min((current / Math.max(target, 1)) * 100, 100);
  const fromColor = current >= target ? "#4ade80" : current >= target * 0.65 ? "#facc15" : "#f87171";
  const toColor   = current >= target ? "#22c55e" : current >= target * 0.65 ? "#eab308" : "#ef4444";

  return (
    <div
      className="h-2 rounded-full overflow-hidden"
      style={{ background: "rgba(255,255,255,0.06)" }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${fromColor}, ${toColor})`,
          boxShadow: `0 0 8px ${fromColor}60`,
          transition: "width 0.8s cubic-bezier(0.4,0,0.2,1)",
        }}
      />
    </div>
  );
}

// ── TopicChain ────────────────────────────────────────────────────────────────

function TopicChain({ chain }: { chain: string[] }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#3a4060" }}>
        Fix this → unlocks
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {chain.map((topic, i) => (
          <div key={topic} className="flex items-center gap-1.5">
            {i > 0 && (
              <span className="material-symbols-outlined text-[11px]" style={{ color: "#2a3050" }}>
                arrow_forward
              </span>
            )}
            <span
              className="px-2.5 py-1 rounded-lg text-[10px] font-semibold"
              style={{
                background: "rgba(0,210,253,0.08)",
                color: "#67e8f9",
                border: "1px solid rgba(0,210,253,0.18)",
                letterSpacing: "0.02em",
              }}
            >
              {topic}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── WhyThisMatters ────────────────────────────────────────────────────────────

function WhyThisMatters({ text, urgency, isRelapse }: { text: string; urgency?: string; isRelapse?: boolean }) {
  const [open, setOpen] = useState(false);

  const accentColor =
    urgency === "critical" ? "#f87171" :
    urgency === "high"     ? "#fb923c" :
    urgency === "medium"   ? "#facc15" :
                             "#4ade80";

  return (
    <div
      style={{
        borderRadius: 12,
        overflow: "hidden",
        border: `1px solid ${accentColor}20`,
        background: `linear-gradient(135deg, ${accentColor}08, transparent)`,
      }}
    >
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full flex items-center gap-3 text-left"
        style={{ padding: "10px 14px" }}
      >
        <span
          className="material-symbols-outlined text-[16px] flex-shrink-0"
          style={{ color: accentColor }}
        >
          {isRelapse ? "history" : "lightbulb"}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: `${accentColor}cc` }}>
            {isRelapse ? "You had this — why it slipped" : "Why this topic right now"}
          </p>
        </div>
        <span
          className="material-symbols-outlined text-[16px] flex-shrink-0 transition-transform duration-200"
          style={{ color: `${accentColor}80`, transform: open ? "rotate(180deg)" : "rotate(0)" }}
        >
          expand_more
        </span>
      </button>

      {open && (
        <div
          style={{
            padding: "0 14px 14px",
            borderTop: `1px solid ${accentColor}12`,
          }}
        >
          <p
            className="text-[13px] leading-[1.65] pt-3"
            style={{ color: "#94a3b8" }}
          >
            {text}
          </p>
        </div>
      )}
    </div>
  );
}

// ── CalibrationPulse ──────────────────────────────────────────────────────────

function CalibrationPulse({ text }: { text: string }) {
  return (
    <div
      style={{
        borderRadius: 14,
        padding: "14px 16px",
        background: "rgba(251,146,60,0.07)",
        border: "1px solid rgba(251,146,60,0.22)",
        boxShadow: "0 0 20px rgba(251,146,60,0.08) inset",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      {/* Pulsing dot */}
      <div style={{ flexShrink: 0, paddingTop: 3 }}>
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "#fb923c",
            animation: "pulse-ring 1.6s ease-out infinite",
          }}
        />
      </div>

      <div>
        <p
          className="text-[10px] font-black uppercase tracking-widest mb-1.5"
          style={{ color: "#fb923c", letterSpacing: "0.1em" }}
        >
          Calibration alert
        </p>
        <p className="text-[13px] leading-[1.6]" style={{ color: "#fed7aa" }}>
          {text}
        </p>
      </div>
    </div>
  );
}

// ── CheckInBanner ─────────────────────────────────────────────────────────────

function CheckInBanner({ text, daysAway }: { text: string; daysAway?: number | null }) {
  const [dismissed, setDismissed] = useState(false);
  const displayDaysAway = typeof daysAway === "number" && Number.isFinite(daysAway) ? daysAway : undefined;
  if (dismissed) return null;

  return (
    <div
      style={{
        borderRadius: 12,
        padding: "11px 14px",
        background: "rgba(100,116,139,0.07)",
        border: "1px solid rgba(100,116,139,0.15)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        className="material-symbols-outlined text-[15px] flex-shrink-0"
        style={{ color: "#475569" }}
      >
        schedule
      </span>
      <div className="flex-1 min-w-0">
        <span
          className="text-[10px] font-bold uppercase tracking-widest mr-2"
          style={{ color: "#475569" }}
        >
          {displayDaysAway != null ? `${displayDaysAway}d away` : "Welcome back"}
        </span>
        <span className="text-[12px]" style={{ color: "#64748b" }}>
          {text}
        </span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 p-1 rounded-lg transition-colors"
        style={{ color: "#334155" }}
        onMouseEnter={e => (e.currentTarget.style.color = "#64748b")}
        onMouseLeave={e => (e.currentTarget.style.color = "#334155")}
      >
        <span className="material-symbols-outlined text-[14px]">close</span>
      </button>
    </div>
  );
}

// ── QuickReplies ──────────────────────────────────────────────────────────────

const QUICK_REPLIES: Record<string, string[]> = {
  practice_questions:       ["Start now →", "What am I getting wrong?", "Make it harder"],
  review_topic:             ["Explain it simply", "Most tested concept?", "3 things I must know"],
  misconception_correction: ["What's my exact mistake?", "Give me a fixed example", "How common is this?"],
  spaced_review:            ["When do I review again?", "How fast do I forget?", "Quick refresher"],
  confidence_building:      ["How do I know I know it?", "Show me my progress", "What does 80% feel like?"],
  exam_strategy:            ["How does this appear on exams?", "What traps exist?", "Give me an exam question"],
  off_topic:                ["What should I study today?", "How am I doing?", "Show my weak spots"],
};

function QuickReplies({ action, topicFocus, onSelect }: {
  action: string;
  topicFocus?: string | null;
  onSelect: (text: string) => void;
}) {
  const base = QUICK_REPLIES[action] ?? QUICK_REPLIES["off_topic"];
  const replies = base.map(r =>
    topicFocus ? r.replace(/\bthis\b/gi, topicFocus) : r
  );

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        overflowX: "auto",
        paddingBottom: 2,
        paddingTop: 2,
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      {replies.map((reply, i) => (
        <button
          key={i}
          onClick={() => onSelect(reply)}
          className="flex-shrink-0 transition-all"
          style={{
            padding: "6px 14px",
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 500,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#64748b",
            whiteSpace: "nowrap",
            cursor: "pointer",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(123,47,255,0.1)";
            e.currentTarget.style.borderColor = "rgba(123,47,255,0.35)";
            e.currentTarget.style.color = "#c4b5fd";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.04)";
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)";
            e.currentTarget.style.color = "#64748b";
          }}
        >
          {reply}
        </button>
      ))}
    </div>
  );
}
