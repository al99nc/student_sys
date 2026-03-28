"use client";
import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { getResults, processLecture, createShareLink, getActiveViewers, getQuizSession, saveQuizSession, retakeQuizSession } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";

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

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const lectureId = parseInt(params.id as string);

  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
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
  const viewerPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    fetchResults();
  }, [lectureId, router]);

  // Start polling for active viewers when a share token exists
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
      // Restore saved session
      try {
        const sessionRes = await getQuizSession(lectureId);
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
        }
      } catch {}
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      setError(axiosErr.response?.status === 404 ? "not_found" : "Failed to load results");
    } finally {
      setLoading(false);
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

  const handleShare = async () => {
    setSharing(true);
    try {
      const res = await createShareLink(lectureId);
      const token = res.data.share_token;
      setShareToken(token);
      const url = `${window.location.origin}/shared/${token}`;
      await copyToClipboard(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Failed to create share link");
    } finally {
      setSharing(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareToken) return;
    const url = `${window.location.origin}/shared/${shareToken}`;
    await copyToClipboard(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleProcess = async () => {
    setProcessing(true);
    setError("");
    try {
      await processLecture(lectureId);
      setSelectedAnswers({});
      setScore(0);
      // MCQs changed — clear saved answers so stale indices don't restore
      try { await saveQuizSession(lectureId, {}); } catch {}
      await fetchResults();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const detail = axiosErr.response?.data?.detail;
      if (typeof detail === "string") setError(detail);
      else if (Array.isArray(detail)) setError(detail.map((d: { msg?: string }) => d?.msg ?? String(d)).join("; "));
      else setError("Processing failed");
    } finally {
      setProcessing(false);
    }
  };

  const handleSelectAnswer = (globalIndex: number, letter: string) => {
    if (selectedAnswers[globalIndex] !== undefined) return;
    const updated = { ...selectedAnswers, [globalIndex]: letter };
    if (results) {
      const correct = results.mcqs.filter((mcq, i) => updated[i] === mcq.answer).length;
      setScore(correct);
    }
    setSelectedAnswers(updated);
    // Debounced auto-save
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaveStatus("saving");
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveQuizSession(lectureId, updated);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2000);
      } catch {
        setSaveStatus("idle");
      }
    }, 800);
  };

  const handleReset = async () => {
    setConfirmRetake(false);
    try {
      const res = await retakeQuizSession(lectureId);
      setRetakeCount(res.data.retake_count);
    } catch {}
    setSelectedAnswers({});
    setScore(0);
    setSaveStatus("idle");
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
        <div className="text-center glass-panel rounded-3xl p-12 max-w-md mx-4 relative z-10">
          <div className="w-16 h-16 rounded-2xl bg-tertiary/20 flex items-center justify-center mx-auto mb-6">
            <span className="material-symbols-outlined text-3xl text-tertiary">warning</span>
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Not Processed Yet</h2>
          <p className="text-on-surface-variant mb-8">Click below to generate study materials for this lecture.</p>
          <button
            onClick={handleProcess}
            disabled={processing}
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

  const answeredCount = Object.keys(selectedAnswers).length;
  const totalCount = results.mcqs.length;
  const grouped = groupByTopic(results.mcqs);
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
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative min-h-screen text-on-surface pb-36 md:pb-0" style={{ backgroundColor: "#111220", backgroundImage: "radial-gradient(at 0% 0%, rgba(123,47,255,0.1) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(0,210,253,0.05) 0px, transparent 50%)", backgroundAttachment: "fixed" }}>
      <div className="grain-overlay" />

      {/* Header */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)]">
        <Link href="/dashboard" className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">
          cortexQ
        </Link>
        <div className="flex items-center gap-3">
          {/* Views + active solvers */}
          {shareToken && (totalViews > 0 || activeViewers > 0) && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface-container-high border border-outline-variant/20">
              {totalViews > 0 && (
                <span className="flex items-center gap-1 text-xs text-on-surface-variant">
                  <span className="material-symbols-outlined text-sm">visibility</span>
                  {totalViews}
                </span>
              )}
              {totalViews > 0 && activeViewers > 0 && (
                <span className="text-outline-variant text-xs">·</span>
              )}
              {activeViewers > 0 && (
                <span className="flex items-center gap-1 text-xs font-bold text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
                  {activeViewers} solving
                </span>
              )}
            </div>
          )}
          {/* Desktop-only actions */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-1 text-xs">
              {saveStatus === "saving" && <span className="material-symbols-outlined text-sm text-on-surface-variant animate-spin">sync</span>}
              {saveStatus === "saved" && <><span className="material-symbols-outlined text-sm text-emerald-400">cloud_done</span><span className="text-emerald-400">Saved</span></>}
              {saveStatus === "idle" && <span className="material-symbols-outlined text-sm text-on-surface-variant/40">cloud_done</span>}
            </div>
            <Link
              href={`/quiz/${lectureId}`}
              className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg glass-panel border border-secondary/30 text-secondary hover:text-white transition-all"
            >
              <span className="material-symbols-outlined text-sm">bolt</span>
              Quiz Mode
            </Link>
            <button
              onClick={shareToken ? handleCopyLink : handleShare}
              disabled={sharing}
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

      <main className="pt-24 px-6 md:px-12 max-w-7xl mx-auto">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-xs font-bold tracking-widest text-secondary mb-4 uppercase pt-6">
          <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
          <span className="material-symbols-outlined text-sm">chevron_right</span>
          <span className="text-on-surface-variant">Lecture #{lectureId}</span>
        </nav>

        {/* Title + Actions */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-8">
          <div>
            <h2 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight mb-4">Study Materials</h2>
            <div className="flex flex-wrap gap-3">
              <span className="px-3 py-1 bg-surface-container-high rounded-full border border-outline-variant/20 text-xs font-medium text-primary flex items-center gap-1">
                <span className="material-symbols-outlined text-sm">quiz</span>
                {totalCount} MCQs
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
            <div className="glass-panel p-8 rounded-xl shadow-[0px_8px_24px_rgba(123,47,255,0.15)] relative overflow-hidden">
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
                <div className="flex gap-3">
                  <button
                    onClick={() => answeredCount > 0 ? setConfirmRetake(true) : handleReset()}
                    className="flex-1 py-3 synapse-gradient text-white font-bold rounded-xl shadow-lg hover:-translate-y-1 transition-transform flex items-center justify-center gap-2"
                  >
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    Retake
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

          {/* Main Content */}
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
              <div className="glass-panel p-8 rounded-xl">
                <div className="flex items-center gap-3 mb-6">
                  <span className="material-symbols-outlined text-primary">summarize</span>
                  <h3 className="font-bold text-white text-xl">Summary</h3>
                </div>
                <p className="text-on-surface-variant leading-relaxed">{results.summary}</p>
              </div>
            )}

            {activeTab === "concepts" && (
              <div className="glass-panel p-8 rounded-xl">
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

            {/* Score Banner */}
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

      {/* Mobile PAGE TOOLS subbar */}
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
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
              shuffleMode ? "bg-white/15 border-white/20 text-white" : "bg-white/5 border-white/10 text-slate-400"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">shuffle</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{shuffleMode ? "Sectioned" : "Shuffle"}</span>
          </button>
          <button
            onClick={shareToken ? handleCopyLink : handleShare}
            disabled={sharing}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-colors ${
              copied ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400" : "bg-white/5 border-white/10 text-slate-400"
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">{copied ? "check" : "share"}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest">{copied ? "Copied!" : shareToken ? "Copy Link" : "Share"}</span>
          </button>
        </div>
      </div>

      {/* Mobile Bottom Nav */}
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
    </div>
  );
}
