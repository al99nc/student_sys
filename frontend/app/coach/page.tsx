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
  confidence_tip?: string | null;
  urgency?: string;
  encouraging_note?: string | null;
  practice_document_id?: number | null;
  practice_questions?: { id: string; document_id: number; topic: string; preview: string }[];
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

// ── Component ─────────────────────────────────────────────────────────────────

export default function CoachPage({ initialConvId }: { initialConvId?: string } = {}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnConvId = initialConvId ?? searchParams.get("conv");

  // Sidebar state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Conversation[] | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Active conversation
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [convTitle, setConvTitle] = useState("New Conversation");
  const [loadingConv, setLoadingConv] = useState(false);

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

  // Sync URL to active conversation (no page reload)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const target = activeId ? `/coach/${activeId}` : "/coach";
    if (window.location.pathname !== target) {
      window.history.pushState(null, "", target);
    }
  }, [activeId]);

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
    coachListConversations()
      .then(res => {
        setConversations(res.data);
        if (targetConvId) loadConversation(targetConvId);
      })
      .catch(() => {});
  }, [router, returnConvId, loadConversation]);

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
    setImageFile(file);
    setImageMime(file.type);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setImageMime(null);
  };

  // ── Send message ─────────────────────────────────────────────────────────────

  const handleSend = async () => {
    if ((!input.trim() && !imagePreview) || sending) return;

    const text = input.trim();
    const imgData = imagePreview;
    const imgMime = imageMime;
    setInput("");
    removeImage();
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
      const res = await coachSendMessage(convId!, text, imgData ?? undefined, imgMime ?? undefined);
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
                      onClick={() => setInput(prompt)}
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
              <MessageBubble key={msg.id} msg={msg} convId={activeId} />
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
                title="Attach image"
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
                onClick={handleSend}
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

function MessageBubble({ msg, convId }: { msg: Message; convId?: string | null }) {
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

  // Assistant message
  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 mt-1" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
        <span className="material-symbols-outlined text-[15px] text-white">smart_toy</span>
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        {/* Thinking animation */}
        {isThinking ? (
          <div className="flex items-center gap-1 px-4 py-3 rounded-2xl rounded-tl-sm" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
            {[0, 150, 300].map(d => (
              <div key={d} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "#7B2FFF", animationDelay: `${d}ms` }} />
            ))}
          </div>
        ) : (
          <>
            {/* Main response */}
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#e2e8f0" }}>
              {msg.content}
            </div>

            {/* Next step card */}
            {meta?.next_step && (
              <div className="px-3 py-2.5 rounded-xl flex gap-2.5" style={{ background: "rgba(123,47,255,0.1)", border: "1px solid rgba(123,47,255,0.25)" }}>
                <span className="material-symbols-outlined text-[16px] flex-shrink-0 mt-0.5" style={{ color: "#a78bfa" }}>checklist</span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-0.5" style={{ color: "#7B2FFF" }}>Next Step</p>
                  <p className="text-xs" style={{ color: "#ddd6fe" }}>{meta.next_step}</p>
                </div>
              </div>
            )}

            {/* Urgency + topic */}
            {(meta?.topic_focus || meta?.urgency) && (
              <div className="flex items-center gap-2 flex-wrap">
                {meta.urgency && meta.urgency !== "low" && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest" style={{ background: `${urgencyColor(meta.urgency)}20`, color: urgencyColor(meta.urgency), border: `1px solid ${urgencyColor(meta.urgency)}40` }}>
                    {meta.urgency}
                  </span>
                )}
                {meta.topic_focus && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ background: "rgba(0,210,253,0.1)", color: "#00D2FD", border: "1px solid rgba(0,210,253,0.2)" }}>
                    {meta.topic_focus}
                  </span>
                )}
              </div>
            )}

            {/* Practice button */}
            {meta?.practice_document_id && (
              <Link
                href={`/quiz/${meta.practice_document_id}${convId ? `?from=${convId}` : ""}`}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold text-white transition-all w-full"
                style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}
                onMouseEnter={e => (e.currentTarget.style.opacity = "0.85")}
                onMouseLeave={e => (e.currentTarget.style.opacity = "1")}
              >
                <span className="material-symbols-outlined text-[16px]">play_circle</span>
                Practice {meta.topic_focus ? `"${meta.topic_focus}"` : "questions"} now →
              </Link>
            )}

            {/* Encouraging note */}
            {meta?.encouraging_note && (
              <p className="text-[11px] italic px-1" style={{ color: "#3a3f60" }}>{meta.encouraging_note}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
