"use client";
import { useEffect, useRef, useState, useCallback, Suspense } from "react";
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

function isValid(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "null" && normalized !== "none";
  }
  return true;
}

// ── Component ─────────────────────────────────────────────────────────────────

function CoachPageInner({ initialConvId }: { initialConvId?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnConvId = initialConvId ?? searchParams.get("conv");
  const quizScore = searchParams.get("quiz_score");
  const quizTotal = searchParams.get("quiz_total");
  const quizPct   = searchParams.get("quiz_pct");
  const quizTopic = searchParams.get("quiz_topic");
  const autoQ     = searchParams.get("q");

  // Mobile detection (SSR-safe: default false = desktop render first)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

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

  // Sync URL to active conversation
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = activeId ? `/coach/${activeId}` : "/coach";
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }, [activeId]);

  // Global keypress → focus textarea (desktop only)
  useEffect(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (window.innerWidth < 1024) return; // skip on mobile
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

  // Auto-resize textarea
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
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

  // ── Init ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    const pathSegments = typeof window !== "undefined" ? window.location.pathname.split("/") : [];
    const pathConvId = pathSegments[2] || null;
    const targetConvId = returnConvId || pathConvId;

    if (quizScore || quizTotal) {
      console.log(`[Coach] Quiz params: score=${quizScore}/${quizTotal} (${quizPct}%)`);
    }

    coachListConversations()
      .then(async res => {
        setConversations(res.data);
        if (targetConvId) {
          await loadConversation(targetConvId);
          if (quizScore !== null && quizTotal !== null) {
            const pct = quizPct ?? Math.round((parseInt(quizScore) / parseInt(quizTotal)) * 100);
            const topicPart = quizTopic ? ` on ${quizTopic}` : "";
            const msg = `I just finished the practice quiz${topicPart} and scored ${quizScore}/${quizTotal} (${pct}%). How did I do and what should I focus on next?`;
            setPendingAutoMsg(msg);
          }
        } else if (autoQ) {
          setPendingAutoMsg(autoQ);
        }
      })
      .catch((err) => console.error("[Coach] Failed to load conversations:", err));
  }, [router, returnConvId, loadConversation, quizScore, quizTotal, quizPct, autoQ]);

  // ── Auto-send pending quiz result ────────────────────────────────────────────

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

  // ── New chat ─────────────────────────────────────────────────────────────────

  const handleNewChat = async () => {
    if (isMobile) setSidebarOpen(false);
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
    setImagePreview(null);
    setImageMime(null);
  };

  const applyImageFile = (file: File) => {
    setImageMime(file.type);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  // Paste image from clipboard
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

    const optimisticUser: Message = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      image_data: imgData,
      image_mime: imgMime,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimisticUser]);

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

  // ── Displayed conversations ──────────────────────────────────────────────────

  const displayedConvs = searchResults ?? conversations;
  const grouped = groupByDate(displayedConvs);
  const hasContent = input.trim() || imagePreview;

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div
      className="chat-root"
      style={{ backgroundColor: "#0d0f1c", color: "#e2e8f0" }}
    >

      {/* ── MOBILE BACKDROP ─────────────────────────────────────────────────── */}
      {isMobile && sidebarOpen && (
        <div
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        />
      )}

      {/* ── SIDEBAR ─────────────────────────────────────────────────────────── */}
      <aside
        style={
          isMobile
            ? {
                position: "fixed",
                top: 0,
                bottom: 0,
                left: 0,
                zIndex: 50,
                width: 300,
                transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
                transition: "transform 0.3s cubic-bezier(0.4,0,0.2,1)",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "#080a14",
                borderRight: "1px solid rgba(255,255,255,0.07)",
                boxShadow: sidebarOpen ? "8px 0 40px rgba(0,0,0,0.6)" : "none",
              }
            : {
                flexShrink: 0,
                display: "flex",
                flexDirection: "column",
                width: sidebarOpen ? 260 : 0,
                minWidth: sidebarOpen ? 260 : 0,
                overflow: "hidden",
                transition: "width 0.22s ease, min-width 0.22s ease",
                backgroundColor: "#080a14",
                borderRight: "1px solid rgba(255,255,255,0.06)",
              }
        }
      >
        {/* Inner content — fixed 300px wide to prevent layout reflow during animation */}
        <div
          style={{
            width: isMobile ? "100%" : 260,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            paddingTop: isMobile ? "env(safe-area-inset-top)" : 0,
          }}
        >
          {/* Sidebar header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 16px 8px",
              borderBottom: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <Link href="/dashboard" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none" }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 10,
                  background: "linear-gradient(135deg, #7B2FFF, #00D2FD)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  fontSize: 11,
                  fontWeight: 900,
                  color: "white",
                }}
              >
                cQ
              </div>
              <span style={{ color: "white", fontWeight: 700, fontSize: 14 }}>CortexQ</span>
            </Link>
            {isMobile && (
              <button
                onClick={() => setSidebarOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(255,255,255,0.05)",
                  border: "none",
                  cursor: "pointer",
                  color: "#64748b",
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 18 }}>close</span>
              </button>
            )}
          </div>

          {/* New chat button */}
          <div style={{ padding: "12px 12px 8px" }}>
            <button
              onClick={handleNewChat}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 12,
                background: "linear-gradient(135deg, rgba(123,47,255,0.18), rgba(0,210,253,0.09))",
                border: "1px solid rgba(123,47,255,0.28)",
                color: "#c4b5fd",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17, color: "#a78bfa" }}>add</span>
              New conversation
            </button>
          </div>

          {/* Search */}
          <div style={{ padding: "4px 12px 8px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16, color: "#3a3f60", flexShrink: 0 }}>search</span>
              <input
                value={searchQuery}
                onChange={e => handleSearchChange(e.target.value)}
                placeholder="Search…"
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "white",
                  fontSize: 13,
                }}
              />
              {searchQuery && (
                <button
                  onClick={() => handleSearchChange("")}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "#4a5280", padding: 0 }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
                </button>
              )}
            </div>
          </div>

          {/* Conversation list */}
          <div
            className="momentum-scroll"
            style={{ flex: 1, padding: "0 8px 8px", overflowX: "hidden" }}
          >
            {searchQuery && searchResults?.length === 0 && (
              <p style={{ color: "#3a3f60", fontSize: 12, padding: "8px 12px" }}>
                No results for &ldquo;{searchQuery}&rdquo;
              </p>
            )}

            {grouped.map(group => (
              <div key={group.label} style={{ marginBottom: 8 }}>
                <p
                  style={{
                    color: "#2a2f50",
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    padding: "6px 12px 4px",
                  }}
                >
                  {group.label}
                </p>
                {group.items.map(conv => (
                  <div
                    key={conv.id}
                    onClick={() => {
                      loadConversation(conv.id);
                      if (isMobile) setSidebarOpen(false);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "9px 10px",
                      borderRadius: 10,
                      cursor: "pointer",
                      background:
                        activeId === conv.id
                          ? "rgba(123,47,255,0.14)"
                          : "transparent",
                      borderLeft:
                        activeId === conv.id
                          ? "2px solid #7B2FFF"
                          : "2px solid transparent",
                      transition: "background 0.15s",
                      position: "relative",
                    }}
                    onMouseEnter={e => {
                      if (activeId !== conv.id)
                        (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.03)";
                    }}
                    onMouseLeave={e => {
                      if (activeId !== conv.id)
                        (e.currentTarget as HTMLDivElement).style.background = "transparent";
                    }}
                  >
                    <span
                      className="material-symbols-outlined"
                      style={{
                        fontSize: 15,
                        flexShrink: 0,
                        color: activeId === conv.id ? "#7B2FFF" : "#3a3f60",
                      }}
                    >
                      chat
                    </span>
                    <p
                      style={{
                        flex: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: 13,
                        fontWeight: 500,
                        color: activeId === conv.id ? "#e2e8f0" : "#94a3b8",
                      }}
                    >
                      {conv.title}
                    </p>
                    <button
                      onClick={e => handleDelete(conv.id, e)}
                      className="group-hover:opacity-100"
                      style={{
                        opacity: 0,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        color: "#4a5280",
                        padding: "2px",
                        flexShrink: 0,
                        transition: "color 0.15s",
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.opacity = "1";
                        e.currentTarget.style.color = "#f87171";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.opacity = "0";
                        e.currentTarget.style.color = "#4a5280";
                      }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>delete</span>
                    </button>
                  </div>
                ))}
              </div>
            ))}

            {conversations.length === 0 && !searchQuery && (
              <p style={{ color: "#2a2f50", fontSize: 12, padding: "12px" }}>
                No conversations yet. Start a new chat!
              </p>
            )}
          </div>

          {/* Dashboard link */}
          <div
            style={{
              padding: "12px",
              borderTop: "1px solid rgba(255,255,255,0.05)",
              paddingBottom: "max(12px, env(safe-area-inset-bottom))",
            }}
          >
            <Link
              href="/dashboard"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                borderRadius: 10,
                color: "#3a3f60",
                fontSize: 13,
                textDecoration: "none",
                transition: "color 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget.style.color = "#94a3b8")}
              onMouseLeave={e => (e.currentTarget.style.color = "#3a3f60")}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_back</span>
              Back to Dashboard
            </Link>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ───────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>

        {/* ── HEADER ──────────────────────────────────────────────────────── */}
        <header
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 12px",
            height: 56,
            paddingTop: "env(safe-area-inset-top)",
            borderBottom: "1px solid rgba(255,255,255,0.06)",
            background: "#0d0f1c",
            zIndex: 10,
          }}
        >
          {/* Menu button */}
          <button
            onClick={() => setSidebarOpen(p => !p)}
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#4a5280",
              transition: "color 0.15s, background 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.color = "#e2e8f0";
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.color = "#4a5280";
              e.currentTarget.style.background = "transparent";
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>menu</span>
          </button>

          {/* Coach identity */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 9,
                background: "linear-gradient(135deg, #7B2FFF, #00D2FD)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                boxShadow: "0 0 14px rgba(123,47,255,0.35)",
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 15, color: "white" }}>smart_toy</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <p
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: "white",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  lineHeight: 1.2,
                }}
              >
                {activeId ? convTitle : "CortexQ Coach"}
              </p>
              <p
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "#3a3f60",
                  lineHeight: 1.2,
                }}
              >
                AI Study Advisor
              </p>
            </div>
          </div>

          {/* New chat button */}
          <button
            onClick={handleNewChat}
            title="New conversation"
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
              background: "rgba(123,47,255,0.12)",
              border: "1px solid rgba(123,47,255,0.22)",
              cursor: "pointer",
              color: "#a78bfa",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = "0.75")}
            onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>edit_square</span>
          </button>
        </header>

        {/* ── MESSAGES ────────────────────────────────────────────────────── */}
        <div
          className="momentum-scroll"
          style={{ flex: 1, padding: "0" }}
        >
          <div
            style={{
              maxWidth: 700,
              margin: "0 auto",
              padding: "20px 16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >

            {/* Empty state */}
            {!activeId && messages.length === 0 && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: "48px 8px 32px",
                  gap: 24,
                }}
              >
                {/* Glowing icon */}
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 22,
                    background: "linear-gradient(135deg, #7B2FFF, #00D2FD)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 8px 40px rgba(123,47,255,0.45), 0 0 0 1px rgba(123,47,255,0.2)",
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 36, color: "white" }}>smart_toy</span>
                </div>

                <div style={{ textAlign: "center" }}>
                  <h2
                    style={{
                      fontSize: 22,
                      fontWeight: 800,
                      color: "#e2e8f0",
                      margin: "0 0 6px",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    What would you like to study?
                  </h2>
                  <p style={{ fontSize: 13, color: "#3a4060", margin: 0, lineHeight: 1.5 }}>
                    I have full visibility into your performance data.
                  </p>
                </div>

                {/* Suggestion grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 10,
                    width: "100%",
                    maxWidth: 420,
                  }}
                >
                  {[
                    { icon: "analytics", text: "What are my weakest topics right now?" },
                    { icon: "event_note", text: "Give me a 10-minute study plan" },
                    { icon: "psychology", text: "How can I fix my overconfidence?" },
                    { icon: "priority_high", text: "Which topic should I practice first?" },
                  ].map(({ icon, text }) => (
                    <button
                      key={text}
                      onClick={() => handleSend(text)}
                      style={{
                        padding: "14px 14px",
                        borderRadius: 14,
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        color: "#64748b",
                        fontSize: 12,
                        textAlign: "left",
                        lineHeight: 1.45,
                        cursor: "pointer",
                        transition: "all 0.18s",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                      onMouseEnter={e => {
                        e.currentTarget.style.borderColor = "rgba(123,47,255,0.35)";
                        e.currentTarget.style.background = "rgba(123,47,255,0.07)";
                        e.currentTarget.style.color = "#c4b5fd";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
                        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
                        e.currentTarget.style.color = "#64748b";
                      }}
                    >
                      <span
                        className="material-symbols-outlined"
                        style={{ fontSize: 18, color: "#4a5280" }}
                      >
                        {icon}
                      </span>
                      {text}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Loading */}
            {loadingConv && (
              <div style={{ display: "flex", justifyContent: "center", padding: "48px 0" }}>
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    border: "2px solid rgba(123,47,255,0.2)",
                    borderTopColor: "#7B2FFF",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
              </div>
            )}

            {/* Messages */}
            {messages.map(msg => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                convId={activeId}
                onQuickReply={(text) => handleSend(text)}
              />
            ))}

            <div ref={messagesEndRef} style={{ height: 4 }} />
          </div>
        </div>

        {/* ── INPUT AREA ──────────────────────────────────────────────────── */}
        <div
          style={{
            flexShrink: 0,
            padding: "10px 16px",
            paddingBottom: "max(16px, env(safe-area-inset-bottom))",
            borderTop: "1px solid rgba(255,255,255,0.06)",
            background: "#0d0f1c",
          }}
        >
          <div style={{ maxWidth: 700, margin: "0 auto" }}>

            {/* Image preview */}
            {imagePreview && (
              <div style={{ marginBottom: 10, position: "relative", display: "inline-block" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imagePreview}
                  alt="attachment"
                  style={{
                    height: 72,
                    borderRadius: 12,
                    objectFit: "cover",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                />
                <button
                  onClick={removeImage}
                  style={{
                    position: "absolute",
                    top: -8,
                    right: -8,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "#f87171",
                    border: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    color: "white",
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>close</span>
                </button>
              </div>
            )}

            {/* Input pill */}
            <div
              style={{
                display: "flex",
                alignItems: "flex-end",
                gap: 8,
                padding: "8px 8px 8px 14px",
                borderRadius: 26,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)",
                transition: "border-color 0.18s",
              }}
              onFocus={() => {}}
            >
              {/* Attach */}
              <button
                onClick={() => fileInputRef.current?.click()}
                title="Attach image (or paste)"
                style={{
                  flexShrink: 0,
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "#3a3f60",
                  marginBottom: 2,
                  transition: "color 0.15s",
                }}
                onMouseEnter={e => (e.currentTarget.style.color = "#7B2FFF")}
                onMouseLeave={e => (e.currentTarget.style.color = "#3a3f60")}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>attach_file</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={handleFileChange}
              />

              {/* Textarea */}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the coach anything…"
                rows={1}
                style={{
                  flex: 1,
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  resize: "none",
                  color: "white",
                  fontSize: 15,
                  lineHeight: 1.5,
                  maxHeight: 140,
                  overflowY: "auto",
                  padding: "7px 0",
                  fontFamily: "inherit",
                }}
              />

              {/* Send — active when has content, Claude-style */}
              <button
                onClick={() => handleSend()}
                disabled={sending || !hasContent}
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: hasContent
                    ? "linear-gradient(135deg, #7B2FFF, #00D2FD)"
                    : "rgba(255,255,255,0.07)",
                  border: "none",
                  cursor: hasContent ? "pointer" : "default",
                  marginBottom: 2,
                  transition: "all 0.2s",
                  opacity: sending ? 0.7 : 1,
                }}
              >
                {sending ? (
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      border: "2px solid rgba(255,255,255,0.25)",
                      borderTopColor: "white",
                      animation: "spin 0.8s linear infinite",
                    }}
                  />
                ) : (
                  <span
                    className="material-symbols-outlined"
                    style={{
                      fontSize: 18,
                      color: hasContent ? "white" : "#3a3f60",
                      fontVariationSettings: "'FILL' 1",
                    }}
                  >
                    arrow_upward
                  </span>
                )}
              </button>
            </div>

            <p
              style={{
                fontSize: 10,
                color: "#1e2238",
                textAlign: "center",
                marginTop: 8,
              }}
            >
              CortexQ Coach uses your real performance data — responses are specific to you.
            </p>
          </div>
        </div>
      </div>

      {/* Spin animation for loading states */}
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes coach-bounce {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        @keyframes msg-in {
          from { opacity: 0; transform: translateY(6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

// ── MessageBubble ─────────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  convId,
  onQuickReply,
}: {
  msg: Message;
  convId?: string | null;
  onQuickReply?: (text: string) => void;
}) {
  const isUser = msg.role === "user";
  const isThinking = msg.content === "…";
  const meta = msg.ai_metadata;

  // ── User bubble ──────────────────────────────────────────────────────────────
  if (isUser) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          paddingLeft: "12%",
          animation: "msg-in 0.2s ease",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, maxWidth: "100%" }}>
          {msg.image_data && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={msg.image_data}
              alt="attachment"
              style={{
                maxHeight: 220,
                borderRadius: 18,
                objectFit: "contain",
                border: "1px solid rgba(255,255,255,0.1)",
              }}
            />
          )}
          {msg.content && (
            <div
              style={{
                background: "rgba(123,47,255,0.24)",
                border: "1px solid rgba(123,47,255,0.28)",
                borderRadius: "18px 18px 4px 18px",
                padding: "9px 13px",
                color: "#e2e8f0",
                fontSize: 14,
                lineHeight: 1.5,
                wordBreak: "break-word",
              }}
            >
              {msg.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isStudyAction =
    isValid(meta?.action) && meta && meta.action && !["greeting", "off_topic"].includes(meta.action);
  const urgColor = urgencyColor(meta && isValid(meta.urgency) ? meta.urgency : undefined);

  // ── Assistant bubble ─────────────────────────────────────────────────────────
  return (
    <div
      style={{
        display: "flex",
        gap: 7,
        paddingRight: "4%",
        animation: "msg-in 0.2s ease",
      }}
    >
      {/* Avatar */}
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: 7,
          background: "linear-gradient(135deg, #7B2FFF, #00D2FD)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 3,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 13, color: "white" }}>smart_toy</span>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>

        {/* Thinking dots */}
        {isThinking ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "10px 14px",
              borderRadius: "4px 16px 16px 16px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.07)",
              width: "fit-content",
            }}
          >
            {[0, 150, 300].map(d => (
              <div
                key={d}
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#7B2FFF",
                  animation: `coach-bounce 1.4s ease-in-out ${d}ms infinite`,
                }}
              />
            ))}
          </div>
        ) : (
          <>
            {/* 2. Main text bubble */}
            <div
              style={{
                background: "rgba(255,255,255,0.035)",
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: "4px 16px 16px 16px",
                padding: "9px 13px",
                color: "#cbd5e1",
                fontSize: 14,
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {msg.content}
            </div>


            {/* 5. Calibration pulse */}
            {meta && isValid(meta.calibration_pulse) && (
              <CalibrationPulse text={meta.calibration_pulse!} />
            )}

            {/* 6. Practice CTA */}
            {(meta?.practice_topic || meta?.practice_document_id) && (() => {
              const topic  = meta.practice_topic ?? meta.topic_focus ?? "";
              const docId  = meta.practice_document_id ?? 0;
              const count  = meta.question_count ?? 5;
              const fromStr = convId ? `&from=${convId}` : "";
              const href = topic
                ? `/quiz/${docId || 1}?count=${count}${fromStr}&fresh=true&topic=${encodeURIComponent(topic)}`
                : `/quiz/${docId}?count=${count}${fromStr}`;
              return (
                <Link
                  href={href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    width: "100%",
                    padding: "13px 20px",
                    borderRadius: 14,
                    background: "linear-gradient(135deg, #7B2FFF, #00D2FD)",
                    color: "white",
                    fontWeight: 700,
                    fontSize: 14,
                    textDecoration: "none",
                    boxShadow: "0 4px 20px rgba(123,47,255,0.35)",
                    transition: "opacity 0.15s, transform 0.15s",
                    letterSpacing: "0.01em",
                  }}
                  onMouseEnter={e => { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "none"; }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 19, fontVariationSettings: "'FILL' 1" }}>play_circle</span>
                  Practice {isValid(topic) ? `"${topic}"` : "now"} →
                </Link>
              );
            })()}

            {/* 8. Quick replies */}
            {meta?.action && meta.action !== "greeting" && onQuickReply && (
              <QuickReplies action={meta.action} topicFocus={meta.topic_focus} onSelect={onQuickReply} />
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
    <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
      <div
        style={{
          height: "100%",
          borderRadius: 999,
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
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#2a3050" }}>
        Fix this → unlocks
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
        {chain.map((topic, i) => (
          <div key={topic} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            {i > 0 && (
              <span className="material-symbols-outlined" style={{ fontSize: 11, color: "#2a3050" }}>arrow_forward</span>
            )}
            <span
              style={{
                padding: "3px 10px",
                borderRadius: 8,
                fontSize: 11,
                fontWeight: 600,
                background: "rgba(0,210,253,0.08)",
                color: "#67e8f9",
                border: "1px solid rgba(0,210,253,0.18)",
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
        background: `${accentColor}08`,
      }}
    >
      <button
        onClick={() => setOpen(p => !p)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 16, color: accentColor, flexShrink: 0 }}>
          {isRelapse ? "history" : "lightbulb"}
        </span>
        <p style={{ flex: 1, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: `${accentColor}cc`, margin: 0 }}>
          {isRelapse ? "You had this — why it slipped" : "Why this topic right now"}
        </p>
        <span
          className="material-symbols-outlined"
          style={{
            fontSize: 16,
            color: `${accentColor}80`,
            flexShrink: 0,
            transition: "transform 0.2s",
            transform: open ? "rotate(180deg)" : "none",
          }}
        >
          expand_more
        </span>
      </button>
      {open && (
        <div style={{ padding: "0 14px 14px", borderTop: `1px solid ${accentColor}12` }}>
          <p style={{ fontSize: 13, lineHeight: 1.65, color: "#94a3b8", paddingTop: 10, margin: 0 }}>
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
        padding: "13px 16px",
        background: "rgba(251,146,60,0.07)",
        border: "1px solid rgba(251,146,60,0.2)",
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
      }}
    >
      <div style={{ flexShrink: 0, paddingTop: 4 }}>
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
        <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: "#fb923c", marginBottom: 6, margin: "0 0 6px" }}>
          Calibration alert
        </p>
        <p style={{ fontSize: 13, lineHeight: 1.6, color: "#fed7aa", margin: 0 }}>
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
        padding: "10px 14px",
        background: "rgba(100,116,139,0.07)",
        border: "1px solid rgba(100,116,139,0.14)",
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span className="material-symbols-outlined" style={{ fontSize: 15, color: "#475569", flexShrink: 0 }}>schedule</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569", marginRight: 8 }}>
          {displayDaysAway != null ? `${displayDaysAway}d away` : "Welcome back"}
        </span>
        <span style={{ fontSize: 12, color: "#64748b" }}>{text}</span>
      </div>
      <button
        onClick={() => setDismissed(true)}
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: "#334155",
          transition: "color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#64748b")}
        onMouseLeave={e => (e.currentTarget.style.color = "#334155")}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>close</span>
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

function QuickReplies({
  action,
  topicFocus,
  onSelect,
}: {
  action: string;
  topicFocus?: string | null;
  onSelect: (text: string) => void;
}) {
  const base = QUICK_REPLIES[action] ?? QUICK_REPLIES["off_topic"];
  const replies = base.map(r => (topicFocus ? r.replace(/\bthis\b/gi, topicFocus) : r));

  return (
    <div
      className="momentum-scroll"
      style={{
        display: "flex",
        gap: 7,
        overflowX: "auto",
        paddingBottom: 4,
        paddingTop: 2,
        scrollbarWidth: "none",
        msOverflowStyle: "none",
      }}
    >
      {replies.map((reply, i) => (
        <button
          key={i}
          onClick={() => onSelect(reply)}
          style={{
            flexShrink: 0,
            padding: "7px 15px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 500,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.09)",
            color: "#64748b",
            whiteSpace: "nowrap",
            cursor: "pointer",
            transition: "all 0.18s",
            fontFamily: "inherit",
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

export default function CoachPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" /></div>}>
      <CoachPageInner />
    </Suspense>
  );
}
