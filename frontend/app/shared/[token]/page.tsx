"use client";
import { useEffect, useState, useRef } from "react";
import { useParams } from "next/navigation";
import {
  getSharedResult, pingSharedSession,
  getQuizSession, saveQuizSession, retakeQuizSession,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  Share2, Shuffle, RefreshCw, Check, X,
  BookOpen, Lightbulb, AlertTriangle,
  CheckCircle2, XCircle, Loader2,
  Cloud, CloudOff,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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

type ActiveTab = "mcqs" | "summary" | "concepts";

function groupByTopic(mcqs: MCQ[]): Record<string, MCQ[]> {
  return mcqs.reduce((acc, mcq, idx) => {
    const topic = mcq.topic || "General";
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push({ ...mcq, _index: idx } as MCQ & { _index: number });
    return acc;
  }, {} as Record<string, MCQ[]>);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function SharedPage() {
  const params = useParams();
  const token  = params.token as string;

  const [result,           setResult]           = useState<SharedResult | null>(null);
  const [loading,          setLoading]          = useState(true);
  const [error,            setError]            = useState("");
  const [selectedAnswers,  setSelectedAnswers]  = useState<Record<number, string>>({});
  const [score,            setScore]            = useState(0);
  const [isLoggedIn,       setIsLoggedIn]       = useState(false);
  const [saveStatus,       setSaveStatus]       = useState<"idle" | "saving" | "saved">("idle");
  const [retakeCount,      setRetakeCount]      = useState(0);
  const [confirmRetake,    setConfirmRetake]    = useState(false);
  const [shuffleMode,      setShuffleMode]      = useState(false);
  const [shuffledMcqs,     setShuffledMcqs]     = useState<Array<MCQ & { _index: number }>>([]);
  const [copied,           setCopied]           = useState(false);
  const [activeTab,        setActiveTab]        = useState<ActiveTab>("mcqs");
  const [guestRetakeBlocked, setGuestRetakeBlocked] = useState(false);

  const sessionIdRef    = useRef<string>("");
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const saveTimeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loggedIn = isAuthenticated();
    setIsLoggedIn(loggedIn);

    let sid = sessionStorage.getItem(`themcq_sid_${token}`);
    if (!sid) {
      sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(`themcq_sid_${token}`, sid);
    }
    sessionIdRef.current = sid;

    const load = async () => {
      try {
        const res = await getSharedResult(token);
        setResult(res.data);
        if (loggedIn) {
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

    const ping = () => {
      pingSharedSession(token, sessionIdRef.current).then(res => {
        sessionIdRef.current = res.data.session_id;
        sessionStorage.setItem(`themcq_sid_${token}`, res.data.session_id);
      }).catch(() => {});
    };
    ping();
    pingIntervalRef.current = setInterval(ping, 15000);
    return () => { if (pingIntervalRef.current) clearInterval(pingIntervalRef.current); };
  }, [token]);

  const handleSelectAnswer = (globalIndex: number, letter: string) => {
    if (selectedAnswers[globalIndex] !== undefined) return;
    const updated = { ...selectedAnswers, [globalIndex]: letter };
    if (result) {
      const correct = result.mcqs.filter((mcq, i) => updated[i] === mcq.answer).length;
      setScore(correct);
    }
    setSelectedAnswers(updated);
    if (isLoggedIn && result) {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      setSaveStatus("saving");
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          await saveQuizSession(result.lecture_id, updated);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        } catch { setSaveStatus("idle"); }
      }, 800);
    }
  };

  const handleToggleShuffle = () => {
    if (!shuffleMode && result) {
      const indexed = result.mcqs.map((mcq, i) => ({ ...mcq, _index: i }));
      setShuffledMcqs([...indexed].sort(() => Math.random() - 0.5));
      setShuffleMode(true);
    } else {
      setShuffleMode(false);
    }
  };

  const handleCopyLink = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(window.location.href);
      } else {
        const el = document.createElement("textarea");
        el.value = window.location.href;
        el.style.position = "fixed"; el.style.opacity = "0";
        document.body.appendChild(el); el.select();
        document.execCommand("copy"); document.body.removeChild(el);
      }
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    } catch {}
  };

  const handleReset = async () => {
    setConfirmRetake(false);
    if (!isLoggedIn) {
      const key = `themcq_guest_shared_retakes_${token}`;
      const count = parseInt(localStorage.getItem(key) || "0");
      if (count >= 1) { setGuestRetakeBlocked(true); return; }
      localStorage.setItem(key, String(count + 1));
    }
    if (isLoggedIn && result) {
      try {
        const res = await retakeQuizSession(result.lecture_id);
        setRetakeCount(res.data.retake_count);
      } catch {}
    }
    setSelectedAnswers({}); setScore(0); setSaveStatus("idle"); setGuestRetakeBlocked(false);
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

  if (error === "not_found" || !result) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader activePage="Lectures" />
        <div className="flex items-center justify-center px-4 py-20">
          <div className="max-w-sm w-full bg-card rounded-2xl border border-border p-8 text-center">
            <div className="w-16 h-16 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-7 h-7 text-muted-foreground" />
            </div>
            <h2 className="text-[22px] font-extrabold tracking-tight text-foreground mb-2">Link Not Found</h2>
            <p className="text-sm text-muted-foreground mb-7 leading-relaxed">
              This share link is invalid or has been removed.
            </p>
            <Button asChild size="lg" className="w-full">
              <Link href="/">Go to themcq</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const answeredCount = Object.keys(selectedAnswers).length;
  const totalCount    = result.mcqs.length;
  const grouped       = groupByTopic(result.mcqs);
  const scorePercent  = totalCount > 0 ? Math.round((score / totalCount) * 100) : 0;

  // ── MCQ List ─────────────────────────────────────────────────────────────────

  const MCQList = ({ mcqs }: { mcqs: Array<MCQ & { _index: number }> }) => (
    <div className="flex flex-col gap-3.5">
      {mcqs.map((mcq, displayIdx) => {
        const globalIdx  = mcq._index;
        const selected   = selectedAnswers[globalIdx];
        const isAnswered = selected !== undefined;
        const isCorrect  = selected === mcq.answer;

        return (
          <div
            key={globalIdx}
            id={`mcq-${globalIdx}`}
            className={cn(
              "bg-muted/5 border border-border rounded-2xl px-[22px] py-5 scroll-mt-[72px] transition-colors",
              isAnswered && isCorrect  && "border-l-[3px] border-l-emerald-400",
              isAnswered && !isCorrect && "border-l-[3px] border-l-red-400",
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
            <p className="text-sm font-medium text-foreground mb-4 leading-relaxed">{mcq.question}</p>

            {/* Options */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {mcq.options.map((option, j) => {
                const letter         = option.charAt(0);
                const isThisSelected = selected === letter;
                const isThisCorrect  = letter === mcq.answer;

                return (
                  <button
                    key={j}
                    onClick={() => handleSelectAnswer(globalIdx, letter)}
                    disabled={isAnswered}
                    className={cn(
                      "px-3.5 py-2.5 rounded-xl text-[13px] text-left transition-all border flex justify-between items-center gap-2 leading-snug",
                      isAnswered ? (
                        isThisCorrect
                          ? "bg-emerald-500/10 border-emerald-500/30 text-foreground cursor-default"
                          : isThisSelected
                            ? "bg-red-500/10 border-red-500/30 text-muted-foreground cursor-default"
                            : "bg-muted/10 border-border text-muted-foreground/30 cursor-default"
                      ) : "bg-muted/15 border-border text-muted-foreground hover:bg-violet-600/10 hover:border-violet-500/30 hover:text-violet-300 cursor-pointer"
                    )}
                  >
                    <span>{option}</span>
                    {isAnswered && isThisCorrect    && <Check className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                    {isAnswered && isThisSelected && !isThisCorrect && <X className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Explanation */}
            {isAnswered && mcq.explanation && (
              <div className={cn(
                "mt-3.5 p-3.5 rounded-xl border text-sm",
                isCorrect ? "bg-emerald-500/5 border-emerald-500/20" : "bg-violet-600/5 border-violet-600/20"
              )}>
                <p className="text-muted-foreground leading-relaxed">
                  <span className="font-semibold text-foreground">Answer: {mcq.answer}</span>
                  {" — "}{mcq.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}
                </p>
              </div>
            )}

            {/* Guest upsell on wrong answer */}
            {isAnswered && !isCorrect && !isLoggedIn && (
              <div className="mt-2 flex items-center justify-between px-1">
                <span className="text-xs text-muted-foreground/50">Track your weak spots</span>
                <Link href={`/auth?redirect=/shared/${token}`} className="text-xs font-semibold text-violet-400 hover:text-violet-300 transition-colors">
                  Sign up free →
                </Link>
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

      <main className="max-w-7xl mx-auto px-4 py-6 md:px-8 md:py-10">

        {/* Title */}
        <div className="mb-8">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/40 mb-2">Shared Study Materials</p>
          <h1 className="text-3xl sm:text-4xl font-semibold text-foreground mb-3 break-words">
            {result.lecture_title}
          </h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary" className="gap-1.5 text-xs">
              <BookOpen className="w-3 h-3" />{totalCount} MCQs
            </Badge>
            {result.view_count > 0 && (
              <Badge variant="outline" className="gap-1.5 text-xs text-muted-foreground">
                {result.view_count} views
              </Badge>
            )}
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

        {/* Content grid */}
        <div className="grid gap-5 items-start grid-cols-1 lg:grid-cols-[300px_1fr]">

          {/* Sidebar */}
          <div className="flex flex-col gap-4">
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
                {isLoggedIn && retakeCount > 0 && (
                  <p className="text-xs text-muted-foreground/40 mb-3.5">{retakeCount} retake{retakeCount !== 1 ? "s" : ""} completed</p>
                )}

                {/* Cloud save indicator */}
                <div className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium mb-3.5",
                  isLoggedIn
                    ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-400"
                    : "bg-orange-500/5 border-orange-500/20 text-orange-400"
                )}>
                  {isLoggedIn ? (
                    <>
                      {saveStatus === "saving"
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <Cloud className="w-3.5 h-3.5" />}
                      {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved to your account" : "Cloud saving on"}
                    </>
                  ) : (
                    <>
                      <CloudOff className="w-3.5 h-3.5" />
                      Answers not saved —{" "}
                      <Link href={`/auth?redirect=/shared/${token}`} className="underline underline-offset-2 hover:text-orange-300 transition-colors">
                        sign up free
                      </Link>
                    </>
                  )}
                </div>

                {/* Guest retake gate */}
                {guestRetakeBlocked ? (
                  <div className="rounded-xl bg-violet-600/10 border border-violet-600/20 p-3.5 mb-3.5">
                    <p className="text-[13px] font-semibold text-foreground mb-1">Sign up to retake</p>
                    <p className="text-xs text-muted-foreground mb-3">Track improvement across unlimited retakes.</p>
                    <Button asChild size="sm" className="w-full">
                      <Link href={`/auth?redirect=/shared/${token}`}>Sign up free</Link>
                    </Button>
                  </div>
                ) : null}

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

                <div className={cn("flex gap-2.5", (confirmRetake || guestRetakeBlocked) ? "" : "mt-3.5")}>
                  {!guestRetakeBlocked && (
                    <Button
                      onClick={() => answeredCount > 0 ? setConfirmRetake(true) : handleReset()}
                      size="sm"
                      className="flex-1"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />Retake
                    </Button>
                  )}
                  <Button
                    onClick={handleToggleShuffle}
                    variant={shuffleMode ? "default" : "outline"}
                    size="sm"
                    className="w-10 px-0"
                    title="Shuffle"
                  >
                    <Shuffle className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    onClick={handleCopyLink}
                    variant="outline"
                    size="sm"
                    className="w-10 px-0"
                    title="Copy share link"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Share2 className="w-3.5 h-3.5" />}
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
                  <div className="flex items-center gap-2.5 text-base font-semibold">
                    <BookOpen className="w-[17px] h-[17px] text-violet-500" />Summary
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-muted-foreground leading-[1.75]">{result.summary}</p>
                </CardContent>
              </Card>
            )}

            {activeTab === "concepts" && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2.5 text-base font-semibold">
                    <Lightbulb className="w-[17px] h-[17px] text-violet-500" />High-Yield Key Concepts
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap gap-2.5">
                    {result.key_concepts.map((concept, i) => (
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
                    {scorePercent >= 70
                      ? "You're well-prepared for this topic."
                      : "Review the explanations for questions you missed."}
                  </p>
                </div>
                <Button onClick={() => setConfirmRetake(true)} size="sm" className="flex-shrink-0">
                  Retake
                </Button>
              </div>
            )}

            {/* Guest CTA */}
            {!isLoggedIn && (
              <div className="bg-muted/5 border border-border rounded-2xl px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-bold text-[14px] text-foreground mb-0.5">Generate MCQs from your own notes</p>
                  <p className="text-[13px] text-muted-foreground">Upload any lecture PDF and get MCQs instantly — free.</p>
                </div>
                <Button asChild size="sm" className="flex-shrink-0">
                  <Link href="/">Try themcq</Link>
                </Button>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

