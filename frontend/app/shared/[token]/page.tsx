"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import { getSharedResult, pingSharedSession } from "@/lib/api";
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

  const [result, setResult] = useState<SharedResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [score, setScore] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("mcqs");
  const sessionIdRef = useRef<string>("");
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Check auth token from localStorage (SSR-safe — runs client-side only)
    setIsLoggedIn(isAuthenticated());

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
    setSelectedAnswers((prev) => {
      const updated = { ...prev, [globalIndex]: letter };
      if (result) {
        const correct = result.mcqs.filter((mcq, i) => updated[i] === mcq.answer).length;
        setScore(correct);
      }
      return updated;
    });
  };

  const handleReset = () => { setSelectedAnswers({}); setScore(0); };

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
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="relative min-h-screen text-on-surface pb-24 md:pb-16" style={{ backgroundColor: "#111220", backgroundImage: "radial-gradient(at 0% 0%, rgba(123,47,255,0.1) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(0,210,253,0.05) 0px, transparent 50%)", backgroundAttachment: "fixed" }}>
      <div className="grain-overlay" />

      {/* Header */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)]">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">cortexQ</h1>
          <span className="hidden md:inline px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant bg-surface-container-high border border-outline-variant/20 rounded">Shared</span>
        </div>
        <div className="flex items-center gap-3">
          {result.view_count > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-on-surface-variant">
              <span className="material-symbols-outlined text-sm">visibility</span>
              {result.view_count} views
            </span>
          )}
          {/* Cloud save indicator — checks for a valid auth token */}
          {isLoggedIn ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-panel border border-emerald-500/20 text-emerald-400">
              <span className="material-symbols-outlined text-sm">cloud_done</span>
              <span className="hidden md:inline text-xs font-semibold">Cloud saving ON</span>
            </div>
          ) : (
            <div className="relative group">
              <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg glass-panel border border-orange-500/20 text-orange-400 hover:border-orange-400/40 transition-colors">
                <span className="material-symbols-outlined text-sm">cloud_off</span>
                <span className="hidden md:inline text-xs font-semibold">Cloud saving OFF</span>
              </button>
              <div className="absolute top-full right-0 mt-2 w-64 glass-panel rounded-xl p-4 invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-all duration-150 z-50 border border-outline-variant/20 shadow-xl">
                <p className="font-bold text-white text-sm mb-1">Your answers are not saved</p>
                <p className="text-on-surface-variant text-xs mb-3 leading-relaxed">Create a free cortexQ account to auto-save your answers, track retakes, upload your own PDFs, and generate MCQs instantly.</p>
                <Link href="/" className="block text-center synapse-gradient text-white font-bold py-2 rounded-lg text-xs hover:-translate-y-0.5 transition-transform">
                  Create Free Account
                </Link>
              </div>
            </div>
          )}
          <Link href="/" className="text-sm font-bold px-3 py-1.5 rounded-lg synapse-gradient text-white hover:-translate-y-0.5 transition-transform">
            Try cortexQ
          </Link>
        </div>
      </header>

      <main className="pt-24 px-6 md:px-12 max-w-7xl mx-auto">
        <div className="pt-6 mb-8">
          <p className="text-xs font-bold tracking-widest text-secondary uppercase mb-2">Shared Study Materials</p>
          <h2 className="text-3xl md:text-5xl font-extrabold text-white tracking-tight mb-4">{result.lecture_title}</h2>
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
                  <p className="text-sm text-on-surface-variant mb-6">
                    {scorePercent}% accuracy · {answeredCount}/{totalCount} answered
                  </p>
                )}
                <button
                  onClick={handleReset}
                  className="w-full py-3 synapse-gradient text-white font-bold rounded-xl shadow-lg hover:-translate-y-1 transition-transform flex items-center justify-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">refresh</span>
                  Retake
                </button>
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
                <button onClick={handleReset} className="synapse-gradient text-white font-bold px-6 py-2 rounded-xl text-sm hover:-translate-y-0.5 transition-transform">
                  Retake
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer CTA */}
      <div className="fixed bottom-0 w-full z-40 flex justify-center py-3 bg-slate-950/60 backdrop-blur-md border-t border-white/5">
        <Link href="/" className="flex items-center gap-2 text-xs text-on-surface-variant hover:text-white transition-colors">
          <span className="font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">cortexQ</span>
          <span>— Upload your own lecture and generate MCQs instantly</span>
          <span className="material-symbols-outlined text-sm">arrow_forward</span>
        </Link>
      </div>
    </div>
  );
}
