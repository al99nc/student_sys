"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { companionAsk, coachCreateConversation } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { X, Loader2, Sparkles, Send, ExternalLink } from "lucide-react";

type WidgetState = "closed" | "input" | "answering" | "answered" | "opening";

const HIDDEN_PAGES = ["/auth", "/", "/admin"];

// ── Animated face button ──────────────────────────────────────────────────────

function CompanionFace({ state }: { state: WidgetState }) {
  // Eyes: different shapes per state
  // closed   → look-around pupils + blink
  // input    → wide awake eyes, looking forward
  // answering→ bouncing dot eyes (thinking)
  // answered → happy crescent eyes
  // opening  → spinning swirl

  const isIdle      = state === "closed";
  const isThinking  = state === "answering";
  const isHappy     = state === "answered";
  const isLoading   = state === "opening";
  const isInput     = state === "input";

  return (
    <svg viewBox="0 0 40 40" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">

      {/* ── Left eye ── */}
      {(isIdle || isInput) && (
        <g className={isIdle ? "companion-eye" : ""}>
          {/* eye white */}
          <circle cx="13" cy="17" r="5.5" fill="white" fillOpacity="0.95" />
          {/* pupil — animated when idle */}
          <circle
            cx="13" cy="17" r="3"
            fill="#6366f1"
            className={isIdle ? "companion-pupil" : ""}
            style={isInput ? { transform: "translate(0.5px,-0.5px)" } : undefined}
          />
          {/* shine */}
          <circle cx="14.5" cy="15.5" r="1" fill="white" fillOpacity="0.7" />
        </g>
      )}

      {/* ── Right eye ── */}
      {(isIdle || isInput) && (
        <g className={isIdle ? "companion-eye" : ""}>
          <circle cx="27" cy="17" r="5.5" fill="white" fillOpacity="0.95" />
          <circle
            cx="27" cy="17" r="3"
            fill="#6366f1"
            className={isIdle ? "companion-pupil" : ""}
            style={isInput ? { transform: "translate(0.5px,-0.5px)" } : undefined}
          />
          <circle cx="28.5" cy="15.5" r="1" fill="white" fillOpacity="0.7" />
        </g>
      )}

      {/* ── Thinking eyes (bouncing dots) ── */}
      {isThinking && (
        <>
          <circle cx="13" cy="17" r="3.5" fill="white" fillOpacity="0.9"
            className="companion-think" style={{ animationDelay: "0s" }} />
          <circle cx="27" cy="17" r="3.5" fill="white" fillOpacity="0.9"
            className="companion-think" style={{ animationDelay: "0.2s" }} />
          {/* third dot — ellipsis feel */}
          <circle cx="20" cy="17" r="2.5" fill="white" fillOpacity="0.6"
            className="companion-think" style={{ animationDelay: "0.1s" }} />
        </>
      )}

      {/* ── Happy eyes (crescents) ── */}
      {isHappy && (
        <>
          {/* left happy eye */}
          <path d="M8 19 Q13 12 18 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
          {/* right happy eye */}
          <path d="M22 19 Q27 12 32 19" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </>
      )}

      {/* ── Loading swirl (opening) ── */}
      {isLoading && (
        <g>
          <circle cx="20" cy="17" r="6" stroke="white" strokeWidth="2" strokeOpacity="0.3" fill="none" />
          <path d="M20 11 A6 6 0 0 1 26 17" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none">
            <animateTransform attributeName="transform" type="rotate" from="0 20 17" to="360 20 17" dur="0.8s" repeatCount="indefinite" />
          </path>
        </g>
      )}

      {/* ── Mouth ── */}
      {isIdle && (
        /* neutral soft smile */
        <path d="M15 26 Q20 29.5 25 26" stroke="white" strokeWidth="2" strokeLinecap="round" fill="none" strokeOpacity="0.85" />
      )}
      {isInput && (
        /* slight open smile */
        <path d="M14 26 Q20 31 26 26" stroke="white" strokeWidth="2.2" strokeLinecap="round" fill="none" strokeOpacity="0.9" />
      )}
      {isThinking && (
        /* flat / wavy thinking mouth */
        <path d="M15 27 Q17.5 25.5 20 27 Q22.5 28.5 25 27" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" strokeOpacity="0.7" />
      )}
      {isHappy && (
        /* big happy smile */
        <path d="M13 26 Q20 33 27 26" stroke="white" strokeWidth="2.5" strokeLinecap="round" fill="none" strokeOpacity="0.95" />
      )}
      {isLoading && (
        <path d="M16 28 Q20 30 24 28" stroke="white" strokeWidth="1.8" strokeLinecap="round" fill="none" strokeOpacity="0.5" />
      )}
    </svg>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function CompanionWidget() {
  const router = useRouter();
  const pathname = usePathname();

  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<WidgetState>("closed");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [canEscalate, setCanEscalate] = useState(false);
  const [escalateReason, setEscalateReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vpHeight, setVpHeight] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const isHiddenPage =
    HIDDEN_PAGES.includes(pathname) ||
    pathname.startsWith("/shared") ||
    pathname.startsWith("/solved-shared");

  const visible = mounted && !isHiddenPage && isAuthenticated();

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setVpHeight(vv.height);
    vv.addEventListener("resize", update);
    return () => vv.removeEventListener("resize", update);
  }, []);

  useEffect(() => {
    if (!visible) return;
    function onDown(e: MouseEvent) {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) reset();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") reset(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    if (state === "input" && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [state, visible]);

  const handleAsk = useCallback(async () => {
    const q = question.trim();
    if (!q) return;
    setState("answering");
    setError(null);
    setAnswer(null);
    setCanEscalate(false);
    try {
      const { data } = await companionAsk(q, pathname);
      setAnswer(data.answer ?? "I'm not sure — try the full coach for a better answer.");
      setCanEscalate(data.escalate);
      setEscalateReason(data.escalate_reason);
      setState("answered");
    } catch {
      setError("Couldn't reach the AI. Try again.");
      setState("input");
    }
  }, [question, pathname]);

  const handleOpenInCoach = useCallback(async () => {
    const q = escalateReason || question.trim();
    setState("opening");
    try {
      const convRes = await coachCreateConversation();
      const convId = (convRes.data as { id: string }).id;
      router.push(`/coach/${convId}?seed=${encodeURIComponent(q)}`);
    } catch {
      router.push(`/coach?q=${encodeURIComponent(q)}`);
    }
  }, [escalateReason, question, router]);

  if (!visible) return null;

  const reset = () => {
    setState("closed");
    setQuestion("");
    setAnswer(null);
    setCanEscalate(false);
    setEscalateReason(null);
    setError(null);
  };

  const windowHeight = typeof window !== "undefined" ? window.innerHeight : 0;
  const keyboardOpen = vpHeight !== null && vpHeight < windowHeight - 80;
  const mobileBottomStyle = keyboardOpen && vpHeight !== null
    ? { bottom: `${window.innerHeight - vpHeight + 8}px` }
    : undefined;

  return (
    <div
      ref={popupRef}
      className="fixed right-3 md:right-6 z-50 flex flex-col items-end gap-2 bottom-[calc(5rem+env(safe-area-inset-bottom,0px))] md:bottom-6"
      style={mobileBottomStyle}
    >
      {/* ── Popup ── */}
      {state !== "closed" && (
        <div className="w-[calc(100vw-1.5rem)] max-w-xs md:w-80 bg-card border border-border/60 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-400" />
              <span className="text-sm font-semibold text-foreground">Jolie</span>
            </div>
            <button
              onClick={reset}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-muted/50 transition-colors touch-manipulation"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-4">

            {/* INPUT / ANSWERING */}
            {(state === "input" || state === "answering") && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Ask anything about using this app</p>
                <QuickSuggestions pathname={pathname} onSelect={(s) => {
                  setQuestion(s);
                  setTimeout(() => inputRef.current?.focus(), 80);
                }} />
                <div className="flex items-center gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    inputMode="search"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
                    placeholder="How do I...?"
                    disabled={state === "answering"}
                    className="flex-1 text-base md:text-sm bg-muted/50 border border-border/40 rounded-xl px-3 py-2.5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
                  />
                  <button
                    onClick={handleAsk}
                    disabled={!question.trim() || state === "answering"}
                    className="p-3 md:p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex-shrink-0 touch-manipulation"
                  >
                    {state === "answering" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  </button>
                </div>
                {state === "answering" && (
                  <p className="text-xs text-muted-foreground text-center animate-pulse">Looking that up...</p>
                )}
                {error && <p className="text-xs text-red-400">{error}</p>}
              </div>
            )}

            {/* ANSWERED */}
            {state === "answered" && answer && (
              <div className="space-y-3">
                <p className="text-sm text-foreground leading-relaxed">{answer}</p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => { setState("input"); setQuestion(""); setAnswer(null); setCanEscalate(false); }}
                    className="flex-1 text-xs px-3 py-2.5 rounded-xl bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border/30 touch-manipulation"
                  >
                    Ask another
                  </button>
                  {canEscalate && (
                    <button
                      onClick={handleOpenInCoach}
                      className="flex-1 flex items-center justify-center gap-1.5 text-xs px-3 py-2.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 hover:text-indigo-300 transition-colors border border-indigo-500/20 touch-manipulation"
                    >
                      Open in coach <ExternalLink className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* OPENING */}
            {state === "opening" && (
              <div className="flex flex-col items-center gap-2 py-2">
                <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                <p className="text-xs text-muted-foreground text-center">Opening coach conversation...</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Floating face button ── */}
      <button
        onClick={() => {
          if (state !== "closed") { reset(); return; }
          setState("input");
        }}
        aria-label="Open Jolie"
        className={`
          relative w-12 h-12 md:w-14 md:h-14 rounded-2xl
          flex items-center justify-center
          shadow-2xl shadow-black/50
          transition-all duration-300 active:scale-90 touch-manipulation
          overflow-hidden
          ${state === "closed"
            ? "bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-600 hover:from-indigo-500 hover:to-violet-500"
            : "bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-700 ring-2 ring-indigo-400/50"
          }
        `}
      >
        {/* subtle inner glow */}
        <span className="absolute inset-0 rounded-2xl bg-white/5 pointer-events-none" />

        {/* pulse ring — only when idle/closed */}
        {state === "closed" && (
          <span className="absolute inset-0 rounded-2xl animate-ping bg-indigo-400/15 pointer-events-none" />
        )}

        {/* face — always visible, expression changes */}
        <CompanionFace state={state} />
      </button>
    </div>
  );
}

// ── Quick suggestions ─────────────────────────────────────────────────────────

const PAGE_SUGGESTIONS: Record<string, string[]> = {
  "/upload":    ["How do I upload a PDF?", "What modes are available?", "Why is generation slow?"],
  "/lectures":  ["How do I open a lecture?", "Can I delete a lecture?"],
  "/dashboard": ["What is readiness score?", "How do I start a session?"],
  "/coach":     ["How do I start a conversation?", "What can the coach do?"],
  "/analytics": ["What does accuracy trend mean?", "What is calibration gap?"],
  "/billing":   ["How do credits work?", "What's included in Pro?"],
};

function QuickSuggestions({ pathname, onSelect }: { pathname: string; onSelect: (s: string) => void }) {
  const key = Object.keys(PAGE_SUGGESTIONS).find((k) => pathname.startsWith(k));
  const suggestions = key ? PAGE_SUGGESTIONS[key] : [];
  if (!suggestions.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.map((s) => (
        <button
          key={s}
          onClick={() => onSelect(s)}
          className="text-xs px-2.5 py-1.5 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/30 hover:border-border/60 transition-colors touch-manipulation"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
