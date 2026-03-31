"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { getSharedResult, pingSharedSession, getQuizSession, saveQuizSession, retakeQuizSession } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";

interface MCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

interface SharedResult {
  lecture_id: number;
  lecture_title: string;
  summary: string;
  key_concepts: string[];
  mcqs: MCQ[];
  view_count: number;
}

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

export default function SharedPage() {
  const params = useParams();
  const token = params.token as string;
  const router = useRouter();

  const [result, setResult] = useState<SharedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [score, setScore] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [retakeCount, setRetakeCount] = useState(0);
  const [confirmRetake, setConfirmRetake] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [shuffleMode, setShuffleMode] = useState(false);
  const [shuffledMcqs, setShuffledMcqs] = useState<Array<MCQ & { _index: number }>>([]);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("mcqs");
  const [guestRetakeBlocked, setGuestRetakeBlocked] = useState(false);
  const sessionIdRef = useRef<string>("");
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Check auth token from localStorage (SSR-safe — runs client-side only)
    const loggedIn = isAuthenticated();
    setIsLoggedIn(loggedIn);

    // Retrieve or generate a session ID for this browser tab
    let sid = sessionStorage.getItem(`cortexq_sid_${token}`);
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(`cortexq_sid_${token}`, sid);
    }
    sessionIdRef.current = sid;

    const load = async () => {
      try {
        const res = await getSharedResult(token);
        setResult(res.data);
        // If user has a valid token, restore their saved session for this lecture
        if (isAuthenticated()) {
          try {
            const sessionRes = await getQuizSession(res.data.lecture_id);
            const saved = sessionRes.data.answers || {};
            setRetakeCount(sessionRes.data.retake_count || 0);
            if (Object.keys(saved).length > 0) {
              const numericAnswers: Record<number, string> = {};
              Object.entries(saved).forEach(([k, v]) => { numericAnswers[parseInt(k)] = v as string; });
              setSelectedAnswers(numericAnswers);
              const correct = res.data.mcqs.filter((mcq: MCQ, i: number) => numericAnswers[i] === mcq.answer).length;
              setScore(correct);
              setSaveStatus("saved");
              setTimeout(() => setSaveStatus("idle"), 1500);
              setSessionRestored(true);
              setTimeout(() => setSessionRestored(false), 4000);
            }
          } catch {}
        }
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number } };
        setError(axiosErr.response?.status === 404 ? "not_found" : "Failed to load content");
      } finally {
        setLoading(false);
      }
    };

    load();

    // Ping immediately then every 15s so the owner sees this as an active viewer
    const ping = () => {
      pingSharedSession(token, sessionIdRef.current).then(res => {
        sessionIdRef.current = res.data.session_id;
        sessionStorage.setItem(`cortexq_sid_${token}`, res.data.session_id);
      }).catch(() => {});
    };

    ping();
    pingIntervalRef.current = setInterval(ping, 15000);

    return () => {
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, [token]);

  const handleSelectAnswer = (globalIndex: number, letter: string) => {
    if (selectedAnswers[globalIndex] !== undefined) return;
    const updated = { ...selectedAnswers, [globalIndex]: letter };
    if (result) {
      const correct = result.mcqs.filter((mcq, i) => updated[i] === mcq.answer).length;
      setScore(correct);
    }
    setSelectedAnswers(updated);
    // Auto-save to the user's account if logged in
    if (isLoggedIn && result) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setSaveStatus("saving");
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await saveQuizSession(result.lecture_id, updated);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch {
          setSaveStatus("idle");
        }
      }, 800);
    }
  };

  const handleToggleShuffle = (mcqs: MCQ[]) => {
    if (!shuffleMode) {
      const indexed = mcqs.map((mcq, i) => ({ ...mcq, _index: i }));
      setShuffledMcqs([...indexed].sort(() => Math.random() - 0.5));
      setShuffleMode(true);
    } else {
      setShuffleMode(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
  };

  const handleCopyLink = async () => {
    await copyToClipboard(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleReset = async () => {
    setConfirmRetake(false);
    // Feature 6: gate second retake for guests
    if (!isLoggedIn) {
      const key = `cortexq_guest_shared_retakes_${token}`;
      const count = parseInt(localStorage.getItem(key) || "0");
      if (count >= 1) {
        setGuestRetakeBlocked(true);
        return;
      }
      localStorage.setItem(key, String(count + 1));
    }
    if (isLoggedIn && result) {
      try {
        const res = await retakeQuizSession(result.lecture_id);
        setRetakeCount(res.data.retake_count);
      } catch {}
    }
    setSelectedAnswers({});
    setScore(0);
    setSaveStatus("idle");
    setGuestRetakeBlocked(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#111220" }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-container" />
      </div>
    );
  }

  if (error === "not_found" || !result) {
    return (
      <div className="min-h-screen flex items-center justify-center relative" style={{ backgroundColor: "#111220" }}>
        <div className="grain-overlay" />
        <div className="text-center glass-panel rounded-3xl p-12 max-w-md mx-4 relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-tertiary/20 flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-3xl text-tertiary">link_off</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Link Not Found</h2>
          <p className="text-on-surface-variant mb-8">This share link is invalid or has been removed.</p>
          <Link href="/" className="synapse-gradient text-white font-bold px-8 py-3 rounded-xl inline-block hover:-translate-y-1 transition-transform">
            Go to cortexQ
          </Link>
        </div>
      </div>
    );
  }

  const answeredCount = Object.keys(selectedAnswers).length;
  const totalCount = result.mcqs.length;
  const grouped = groupByTopic(result.mcqs);
  const scorePercent = totalCount > 0 ? Math.round((score / totalCount) * 100) : 0;

  const MCQList = ({ mcqs }: { mcqs: Array<MCQ & { _index: number }> }) => (
    <div className="space-y-6">
      {mcqs.map((mcq, displayIdx) => {
        const globalIdx = mcq._index;
        const selected = selectedAnswers[globalIdx];
        const isAnswered = selected !== undefined;
        const isCorrect = selected === mcq.answer;

        return (
          <div
            key={globalIdx}
            className={`glass-panel p-8 rounded-xl transition-all duration-300 hover:-translate-y-1 border-l-4 ${
              isAnswered ? (isCorrect ? "border-green-500/50" : "border-error/50") : "border-primary-container/30"
            }`}
          >
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

            <h3 className="text-lg font-bold text-white mb-6 leading-snug">{mcq.question}</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mcq.options.map((option, j) => {
                const letter = option.charAt(0);
                const isThisSelected = selected === letter;
                const isThisCorrect = letter === mcq.answer;
                let cls = "bg-surface-container-highest border border-outline-variant/10 text-on-surface-variant cursor-pointer hover:border-primary-container/50 hover:bg-primary-container/10 hover:text-white";
                if (isAnswered) {
                  if (isThisCorrect) cls = "bg-primary-container/20 border border-primary/30 text-white cursor-default";
                  else if (isThisSelected) cls = "bg-error/20 border border-error/30 text-error cursor-default";
                  else cls = "bg-surface-container-highest border border-outline-variant/10 text-on-surface-variant/50 cursor-default";
                }
                return (
                  <button
                    key={j}
                    onClick={() => handleSelectAnswer(globalIdx, letter)}
                    className={`p-4 rounded-xl text-sm text-left transition-all flex justify-between items-center ${cls}`}
                  >
                    <span>{option}</span>
                    {isAnswered && isThisCorrect && <span className="material-symbols-outlined text-primary text-sm">done_all</span>}
                    {isAnswered && isThisSelected && !isThisCorrect && <span className="material-symbols-outlined text-error text-sm">close</span>}
                  </button>
                );
              })}
            </div>

            {isAnswered && mcq.explanation && (
              <div className={`mt-4 px-4 py-3 rounded-xl text-sm flex items-start gap-2 ${isCorrect ? "bg-green-500/5 border border-green-500/20 text-green-300" : "bg-primary-container/5 border border-primary/20 text-primary-fixed-dim"}`}>
                <span className="material-symbols-outlined text-sm flex-shrink-0 mt-0.5">arrow_forward</span>
                <span><strong>Answer: {mcq.answer}</strong> — {mcq.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}</span>
              </div>
            )}

            {/* Feature 3: wrong answer nudge for guests */}
            {isAnswered && !isCorrect && !isLoggedIn && (
              <div className="mt-2 flex items-center justify-between px-1">
                <span className="text-xs text-on-surface-variant/60">Track your weak spots</span>
                <Link href={`/auth?redirect=/shared/${token}`} className="text-xs font-bold text-secondary hover:text-white transition-colors flex items-center gap-1">
                  Sign up free
                  <span className="material-symbols-outlined text-xs">arrow_forward</span>
                </Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className={`relative min-h-screen text-on-surface md:pb-16 ${isLoggedIn ? "pb-36" : "pb-20"}`} style={{ backgroundColor: "#111220", backgroundImage: "radial-gradient(at 0% 0%, rgba(123,47,255,0.1) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(0,210,253,0.05) 0px, transparent 50%)", backgroundAttachment: "fixed" }}>
      <div className="grain-overlay" />

      {/* Restore toast */}
      {sessionRestored && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 border border-emerald-500/30 shadow-xl text-sm text-white">
          <span className="material-symbols-outlined text-sm text-emerald-400">cloud_done</span>
          Your saved progress has been restored from your account
        </div>
      )}

      {/* Header — logo + cloud icon only on mobile; full buttons on desktop */}
      <header className="fixed top-0 w-full flex justify-between items-center px-5 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)]">
        <div className="flex items-center gap-3">
          <Link href={isLoggedIn ? "/dashboard" : "/"} className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent hover:opacity-80 transition-opacity">
            cortexQ
          </Link>
          <span className="hidden md:inline px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant bg-surface-container-high border border-outline-variant/20 rounded">Shared</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Cloud save icon — always visible, text only on desktop */}
          {isLoggedIn ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-panel border border-emerald-500/20">
              {saveStatus === "saving"
                ? <span className="material-symbols-outlined text-sm text-on-surface-variant animate-spin">sync</span>
                : <span className="material-symbols-outlined text-sm text-emerald-400">cloud_done</span>}
              <span className="hidden md:inline text-xs font-semibold text-emerald-400">
                {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved" : "Cloud saving ON"}
              </span>
            </div>
          ) : (
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-panel border border-orange-500/20 text-orange-400">
                <span className="material-symbols-outlined text-sm">cloud_off</span>
                <span className="hidden md:inline text-xs font-semibold">Not saving</span>
              </button>
              <div className="absolute top-full right-0 mt-2 w-64 glass-panel rounded-xl p-4 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150 z-50 border border-outline-variant/20 shadow-xl">
                <p className="font-bold text-white text-sm mb-1">Your answers are not saved</p>
                <p className="text-on-surface-variant text-xs mb-3 leading-relaxed">Create a free cortexQ account to auto-save answers, track retakes, and generate MCQs from your own PDFs.</p>
                <Link href="/" className="block text-center synapse-gradient text-white font-bold py-2 rounded-lg text-xs hover:-translate-y-0.5 transition-transform">
                  Create Free Account
                </Link>
              </div>
            </div>
          )}

          {/* Desktop-only action buttons */}
          <div className="hidden md:flex items-center gap-2">
            {result.view_count > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-on-surface-variant mr-1">
                <span className="material-symbols-outlined text-sm">visibility</span>
                {result.view_count} views
              </span>
            )}
            <Link
              href={`/shared/${token}/quiz`}
              className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg glass-panel border border-secondary/30 text-secondary hover:text-white transition-all"
            >
              <span className="material-symbols-outlined text-sm">bolt</span>
              Quiz Mode
            </Link>
            <button
              onClick={handleCopyLink}
              className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg transition-all ${copied ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" : "glass-panel text-on-surface-variant hover:text-white"}`}
            >
              <span className="material-symbols-outlined text-sm">{copied ? "check" : "share"}</span>
              {copied ? "Copied!" : "Share"}
            </button>
            {isLoggedIn && (
              <>
                <button
                  onClick={() => result && handleToggleShuffle(result.mcqs)}
                  className={`flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg transition-all ${shuffleMode ? "synapse-gradient text-white" : "glass-panel text-on-surface-variant hover:text-white"}`}
                >
                  <span className="material-symbols-outlined text-sm">shuffle</span>
                  {shuffleMode ? "Sectioned" : "Shuffle"}
                </button>
                <Link href="/dashboard" className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg glass-panel text-on-surface-variant hover:text-white transition-all">
                  <span className="material-symbols-outlined text-sm">home</span>
                  Home
                </Link>
              </>
            )}
            {!isLoggedIn && (
              <Link href="/" className="text-sm font-bold px-3 py-1.5 rounded-lg synapse-gradient text-white hover:-translate-y-0.5 transition-transform">
                Try cortexQ
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Mobile subbar: page-specific tools, logged-in users only ── */}
      {isLoggedIn && <div className="md:hidden fixed bottom-[56px] w-full z-[51]">
        {/* Label strip */}
        <div className="flex items-center gap-2 px-4 pt-1.5">
          <div className="h-px flex-1 bg-white/10" />
          <span className="text-[8px] font-black uppercase tracking-[0.2em] text-on-surface-variant/40">Page tools</span>
          <div className="h-px flex-1 bg-white/10" />
        </div>
        <div className="flex justify-around items-center py-1.5 px-4 bg-slate-800/80 backdrop-blur-xl border-t border-white/8">
          <Link
            href={`/shared/${token}/quiz`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-secondary/10 border border-secondary/25 text-secondary"
          >
            <span className="material-symbols-outlined text-[18px]">bolt</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">Quiz Mode</span>
          </Link>

          {isLoggedIn ? (
            <button
              onClick={() => result && handleToggleShuffle(result.mcqs)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
                shuffleMode
                  ? "bg-white/15 border-white/20 text-white"
                  : "bg-white/5 border-white/10 text-slate-400"
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">shuffle</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">{shuffleMode ? "Sectioned" : "Shuffle"}</span>
            </button>
          ) : (
            <Link href={`/auth?redirect=/shared/${token}`} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-slate-400">
              <span className="material-symbols-outlined text-[18px]">person_add</span>
              <span className="text-[10px] font-bold uppercase tracking-widest">Sign up</span>
            </Link>
          )}

          <button
            onClick={handleCopyLink}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
              copied
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                : "bg-white/5 border-white/10 text-slate-400"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{copied ? "check" : "share"}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{copied ? "Copied!" : "Share"}</span>
          </button>
        </div>
      </div>}

      {/* ── Mobile main nav: permanent app navigation ── */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center px-4 bg-slate-950/95 backdrop-blur-xl border-t border-white/5"
        style={{ paddingTop: "0.75rem", paddingBottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}>
        {isLoggedIn ? (
          <>
            <Link href="/dashboard" className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-[22px]">home</span>
              <span className="text-[10px] uppercase tracking-widest">Home</span>
            </Link>
            <Link href="/upload" className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-[22px]">upload_file</span>
              <span className="text-[10px] uppercase tracking-widest">Upload</span>
            </Link>
            <Link href="/analytics" className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-[22px]">insights</span>
              <span className="text-[10px] uppercase tracking-widest">Stats</span>
            </Link>
          </>
        ) : (
          <>
            <Link href="/" className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-[22px]">home</span>
              <span className="text-[10px] uppercase tracking-widest">Home</span>
            </Link>
            <Link href={`/shared/${token}/quiz`} className="flex flex-col items-center gap-0.5 text-secondary">
              <span className="material-symbols-outlined text-[22px]">bolt</span>
              <span className="text-[10px] uppercase tracking-widest">Quiz</span>
            </Link>
            <Link href={`/auth?redirect=/shared/${token}`} className="flex flex-col items-center gap-0.5 text-slate-400 hover:text-white transition-colors">
              <span className="material-symbols-outlined text-[22px]">person_add</span>
              <span className="text-[10px] uppercase tracking-widest">Sign up</span>
            </Link>
          </>
        )}
      </nav>

      <main className="pt-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="pt-6 mb-8">
          <p className="text-xs font-bold tracking-widest text-secondary uppercase mb-2">Shared Study Materials</p>
          <h2 className="text-2xl md:text-4xl font-extrabold text-white tracking-tight mb-4 break-words line-clamp-3 max-w-full">{result.lecture_title}</h2>
          <div className="flex flex-wrap gap-3">
            <span className="px-3 py-1 bg-surface-container-high rounded-full border border-outline-variant/20 text-xs font-medium text-primary flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">quiz</span>
              {totalCount} MCQs
            </span>
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

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-20">
          {/* Sidebar */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            <div className="glass-panel p-8 rounded-xl shadow-[0px_8px_24px_rgba(123,47,255,0.15)] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary-container/10 blur-3xl rounded-full -mr-16 -mt-16" />
              <div className="relative z-10">
                <p className="text-secondary font-bold uppercase tracking-[0.2em] text-xs mb-2">Your Score</p>
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
                {isLoggedIn && retakeCount > 0 && (
                  <p className="text-xs text-on-surface-variant/60 mb-2">
                    <span className="material-symbols-outlined text-xs align-middle mr-1">history</span>
                    {retakeCount} retake{retakeCount !== 1 ? "s" : ""} completed
                  </p>
                )}
                {(answeredCount === 0 && retakeCount === 0) && <div className="mb-6" />}
                {confirmRetake ? (
                  <div className="bg-error/10 border border-error/30 rounded-xl p-4 mb-3">
                    <p className="text-sm font-bold text-white mb-1">Clear all answers?</p>
                    <p className="text-xs text-on-surface-variant mb-3">Your current progress will be lost and a new retake will be recorded.</p>
                    <div className="flex gap-2">
                      <button onClick={handleReset} className="flex-1 py-2 bg-error text-white font-bold rounded-lg text-sm hover:bg-error/80 transition-colors">
                        Yes, retake
                      </button>
                      <button onClick={() => setConfirmRetake(false)} className="flex-1 py-2 glass-panel text-on-surface-variant font-bold rounded-lg text-sm hover:text-white transition-colors">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}

                {/* Feature 6: guest retake gate */}
                {guestRetakeBlocked ? (
                  <div className="border border-secondary/30 rounded-xl p-4 bg-secondary/5">
                    <p className="text-sm font-bold text-white mb-1">Sign up to retake</p>
                    <p className="text-xs text-on-surface-variant mb-3">Track improvement across unlimited retakes.</p>
                    <Link href={`/auth?redirect=/shared/${token}`} className="block text-center synapse-gradient text-white font-bold py-2.5 rounded-lg text-sm hover:-translate-y-0.5 transition-transform">
                      Sign up free
                    </Link>
                  </div>
                ) : (
                  <button
                    onClick={() => answeredCount > 0 ? setConfirmRetake(true) : handleReset()}
                    className="w-full py-3 synapse-gradient text-white font-bold rounded-xl shadow-lg hover:-translate-y-1 transition-transform flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    Retake
                  </button>
                )}
              </div>
            </div>

            {result.key_concepts.length > 0 && (
              <div className="glass-panel p-6 rounded-xl border border-outline-variant/10">
                <h4 className="text-sm font-bold text-white mb-4 uppercase tracking-widest">Key Concepts</h4>
                <div className="flex flex-wrap gap-2">
                  {result.key_concepts.slice(0, 6).map((concept, i) => (
                    <span key={i} className="text-xs px-3 py-1.5 rounded-full bg-surface-container-highest border border-outline-variant/10 text-on-surface-variant">
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="lg:col-span-8 space-y-6">
            {activeTab === "mcqs" && (
              shuffleMode ? (
                <MCQList mcqs={shuffledMcqs} />
              ) : Object.entries(grouped).map(([topic, mcqs]) => (
                <div key={topic}>
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-xl">{getEmoji(topic)}</span>
                    <h3 className="font-bold text-white">{topic}</h3>
                    <span className="text-xs text-on-surface-variant">{mcqs.length} questions</span>
                  </div>
                  <MCQList mcqs={mcqs as Array<MCQ & { _index: number }>} />
                </div>
              ))
            )}

            {activeTab === "summary" && (
              <div className="glass-panel p-8 rounded-xl">
                <div className="flex items-center gap-3 mb-6">
                  <span className="material-symbols-outlined text-primary">summarize</span>
                  <h3 className="font-bold text-white text-xl">Summary</h3>
                </div>
                <p className="text-on-surface-variant leading-relaxed">{result.summary}</p>
              </div>
            )}

            {activeTab === "concepts" && (
              <div className="glass-panel p-8 rounded-xl">
                <div className="flex items-center gap-3 mb-6">
                  <span className="material-symbols-outlined text-tertiary">lightbulb</span>
                  <h3 className="font-bold text-white text-xl">High-Yield Key Concepts</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  {result.key_concepts.map((concept, i) => (
                    <span key={i} className="px-4 py-2 rounded-full bg-tertiary/10 border border-tertiary/20 text-tertiary text-sm font-medium">
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

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
                <button onClick={() => setConfirmRetake(true)} className="synapse-gradient text-white font-bold px-6 py-2 rounded-xl text-sm hover:-translate-y-0.5 transition-transform">
                  Retake
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Desktop footer CTA for guests */}
      {!isLoggedIn && (
        <div className="hidden md:flex fixed bottom-0 w-full z-40 justify-center py-3 bg-slate-950/60 backdrop-blur-md border-t border-white/5">
          <Link href="/" className="flex items-center gap-2 text-xs text-on-surface-variant hover:text-white transition-colors">
            <span className="font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">cortexQ</span>
            <span>— Upload your own lecture and generate MCQs instantly</span>
            <span className="material-symbols-outlined text-sm">arrow_forward</span>
          </Link>
        </div>
      )}
    </div>
  );
}
