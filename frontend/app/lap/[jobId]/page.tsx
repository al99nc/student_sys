"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getToken } from "@/lib/auth";
import { McqLoadingWaiter } from "@/components/McqLoadingWaiter";

type JobStatus = "pending" | "processing" | "done" | "failed";

const RADIUS = 72;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatRemainingShort(seconds: number | null): { value: string; unit: string } {
  if (seconds === null) return { value: "—", unit: "calculating" };
  if (seconds > 90) {
    const mins = Math.ceil(seconds / 60);
    return { value: String(mins), unit: mins === 1 ? "minute left" : "minutes left" };
  }
  if (seconds > 0) return { value: String(seconds), unit: "seconds left" };
  return { value: "✓", unit: "wrapping up" };
}

const TIPS = [
  "Your questions will be exam-quality MCQs with 4 plausible options.",
  "You can re-quiz on the same lecture as many times as you like.",
  "Spaced repetition schedules review so you retain more with less effort.",
  "Flashcards are generated from the same lecture — zero extra work.",
  "Share your session with classmates so they can practice too.",
  "The AI coach can build a study plan around your weakest topics.",
];

export default function JobWaitingRoom() {
  const router = useRouter();
  const params = useParams();
  const jobId = params?.jobId as string;

  const [status, setStatus] = useState<JobStatus>("pending");
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("Starting up...");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setTipIndex((i) => (i + 1) % TIPS.length), 4000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    if (status === "done" || status === "failed") return;

    const token = getToken();

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const data = await res.json();

        setProgress(data.progress_pct ?? 0);
        setLabel(data.progress_label ?? "");
        setRemaining(data.estimated_seconds_remaining ?? null);
        setStatus(data.status as JobStatus);

        if (data.status === "done") {
          setTimeout(() => router.push(`/results/${data.lecture_id}?processed=true`), 800);
        }
        if (data.status === "failed") {
          setError(data.error_message ?? "Generation failed. Please try again.");
        }
      } catch {
        // network error — keep polling
      }
    };

    poll();
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [jobId, status, router]);

  const strokeDashoffset = CIRCUMFERENCE - (progress / 100) * CIRCUMFERENCE;
  const timeDisplay = formatRemainingShort(remaining);

  const statusBadge = {
    pending:    { color: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25", label: "Queued" },
    processing: { color: "bg-blue-500/15 text-blue-400 border-blue-500/25",       label: "Generating" },
    done:       { color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25", label: "Done" },
    failed:     { color: "bg-red-500/15 text-red-400 border-red-500/25",           label: "Failed" },
  }[status];

  if (status === "failed") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="w-20 h-20 rounded-2xl bg-red-500/20 flex items-center justify-center mx-auto">
            <svg className="w-10 h-10 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-foreground">Generation Failed</h2>
          {error && (
            <p className="text-sm text-muted-foreground bg-muted/40 rounded-xl px-4 py-3">{error}</p>
          )}
          <button
            onClick={() => router.push("/lap")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-bold shadow-lg hover:-translate-y-0.5 transition-all"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      {/* Header */}
      <header className="px-6 py-4 flex items-center gap-3">
        <span className="text-lg font-extrabold tracking-tight text-foreground">themcq</span>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-10">

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground text-center mb-10">
          Generating your questions
        </h1>

        {/* Central Component */}
        <div className="w-full max-w-sm">
          {status === "done" ? (
            <div className="flex flex-col items-center justify-center min-h-[140px] text-center space-y-4">
              <div className="text-5xl font-black text-emerald-500 animate-in zoom-in duration-300">Done!</div>
              <div className="text-sm font-semibold text-muted-foreground uppercase tracking-widest animate-pulse">redirecting…</div>
            </div>
          ) : (
            <McqLoadingWaiter />
          )}
        </div>

        {/* Rotating tip */}
        <div className="w-full max-w-sm mt-12 rounded-xl border border-border/40 bg-muted/20 px-5 py-4 min-h-[72px] flex items-center gap-3">
          <svg className="w-4 h-4 text-primary flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
          <p className="text-xs text-muted-foreground leading-relaxed transition-all">
            {TIPS[tipIndex]}
          </p>
        </div>

        {/* Status indicators for dev/debug visibility (subtle) */}
        <div className="mt-8 flex items-center gap-4 opacity-30 hover:opacity-100 transition-opacity">
           <span className={`text-[10px] font-bold uppercase tracking-widest ${statusBadge.color} px-2 py-0.5 rounded-full border`}>
             {statusBadge.label}
           </span>
           <span className="text-[10px] font-bold text-muted-foreground tabular-nums">
             {progress}% COMPLETED
           </span>
        </div>

        {/* Close-tab info */}
        <p className="mt-12 text-xs text-muted-foreground/50 text-center max-w-xs leading-relaxed">
          You can close this tab — generation continues in the background.
        </p>
      </main>
    </div>
  );
}
