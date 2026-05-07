"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getToken } from "@/lib/auth";

type JobStatus = "pending" | "processing" | "done" | "failed";

const RADIUS = 80;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatRemaining(seconds: number | null): string {
  if (seconds === null) return "Calculating...";
  if (seconds > 90) return `About ${Math.ceil(seconds / 60)} minutes remaining`;
  if (seconds > 30) return "About 1 minute remaining";
  if (seconds > 0) return "Almost done...";
  return "Wrapping up...";
}

export default function JobWaitingRoom() {
  const router = useRouter();
  const params = useParams();
  const jobId = params?.jobId as string;

  const [status, setStatus] = useState<JobStatus>("pending");
  const [progress, setProgress] = useState(0);
  const [label, setLabel] = useState("Starting up...");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
          setTimeout(() => {
            router.push(`/results/${data.lecture_id}`);
          }, 1000);
        }
        if (data.status === "failed") {
          setError(data.error_message ?? "Generation failed. Please try again.");
        }
      } catch {
        // network error — keep polling
      }
    };

    poll(); // immediate first check
    const interval = setInterval(poll, 2000);
    return () => clearInterval(interval);
  }, [jobId, status, router]);

  const strokeDashoffset = CIRCUMFERENCE - (progress / 100) * CIRCUMFERENCE;

  const statusBadge = {
    pending:    { color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30", label: "Queued" },
    processing: { color: "bg-blue-500/20 text-blue-400 border-blue-500/30",       label: "Generating" },
    done:       { color: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", label: "Done" },
    failed:     { color: "bg-red-500/20 text-red-400 border-red-500/30",           label: "Failed" },
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
            onClick={() => router.push("/upload")}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl synapse-gradient text-white font-bold shadow-lg hover:-translate-y-0.5 transition-all"
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
      <main className="flex-1 flex flex-col items-center justify-center px-4 py-12 space-y-8">
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground text-center">
          Generating your questions
        </h1>

        {/* Progress ring */}
        <div className="relative flex items-center justify-center">
          <svg width="200" height="200" viewBox="0 0 200 200">
            <circle cx="100" cy="100" r={RADIUS} fill="none" stroke="#1f2937" strokeWidth="10" />
            <circle
              cx="100" cy="100" r={RADIUS} fill="none"
              stroke="#6366f1"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={strokeDashoffset}
              transform="rotate(-90 100 100)"
              style={{ transition: "stroke-dashoffset 0.5s ease" }}
            />
            <text
              x="100" y="95" textAnchor="middle" dominantBaseline="middle"
              fontSize="28" fontWeight="bold" fill="#f9fafb"
            >
              {progress}%
            </text>
            <text
              x="100" y="120" textAnchor="middle" dominantBaseline="middle"
              fontSize="11" fill="#9ca3af"
            >
              {status === "done" ? "Complete!" : "working..."}
            </text>
          </svg>
        </div>

        {/* Status badge */}
        <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${statusBadge.color}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current" />
          {statusBadge.label}
        </span>

        {/* Progress label */}
        <p className="text-sm text-muted-foreground text-center max-w-xs">
          {label}
        </p>

        {/* Time remaining */}
        {status !== "done" && (
          <p className="text-xs text-muted-foreground/60 text-center">
            {formatRemaining(remaining)}
          </p>
        )}

        {/* Persistence info card */}
        <div className="w-full max-w-sm rounded-xl border border-border/40 bg-muted/20 px-5 py-4 space-y-2">
          <div className="flex items-start gap-3">
            <svg className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
            </svg>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You can close this tab — your generation will continue and you&apos;ll pick up where you left off when you return.
            </p>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <svg className="w-3.5 h-3.5 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
            <span className="text-xs text-muted-foreground/60">Bookmark this URL to return here anytime</span>
          </div>
        </div>
      </main>
    </div>
  );
}
