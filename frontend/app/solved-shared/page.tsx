"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMySharedSessions } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";

interface SharedSession {
  lecture_id: number;
  lecture_title: string;
  share_token: string;
  answered: number;
  total: number;
  correct: number;
  retake_count: number;
  updated_at: string | null;
}

export default function SolvedSharedPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SharedSession[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    getMySharedSessions()
      .then(res => setSessions(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  return (
    <div className="relative min-h-screen text-on-surface" style={{ backgroundColor: "#111220", backgroundImage: "radial-gradient(at 0% 0%, rgba(123,47,255,0.05) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(0,210,253,0.05) 0px, transparent 50%)", backgroundAttachment: "fixed" }}>
      <div className="grain-overlay" />

      {/* Top Nav */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)] border-b border-white/5">
        <div className="flex items-center gap-8">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent tracking-tight">cortexQ</h1>
          <nav className="hidden md:flex gap-6 items-center">
            <Link href="/dashboard" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Dashboard</Link>
            <a className="text-[#00D2FD] font-bold text-sm">Solved Shared</a>
          </nav>
        </div>
        <Link href="/dashboard" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
          <span className="material-symbols-outlined text-sm">arrow_back</span>
          Dashboard
        </Link>
      </header>

      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-20 lg:w-72 z-[60] flex-col bg-slate-950/95 backdrop-blur-2xl border-r border-white/10 hidden md:flex pt-24">
        <nav className="flex-1 flex flex-col gap-2 px-4 pt-6">
          <Link href="/dashboard" className="flex items-center gap-4 text-slate-400 px-4 py-3 hover:bg-white/5 rounded-xl hover:text-[#00D2FD] transition-all duration-300">
            <span className="material-symbols-outlined">dashboard</span>
            <span className="hidden lg:inline font-medium">Dashboard</span>
          </Link>
          <Link href="/upload" className="flex items-center gap-4 text-slate-400 px-4 py-3 hover:bg-white/5 rounded-xl hover:text-[#00D2FD] transition-all duration-300">
            <span className="material-symbols-outlined">upload_file</span>
            <span className="hidden lg:inline font-medium">Upload</span>
          </Link>
          <a className="flex items-center gap-4 bg-gradient-to-r from-[#7B2FFF]/20 to-[#00D2FD]/20 text-white border-l-4 border-[#00D2FD] px-4 py-3 rounded-r-xl">
            <span className="material-symbols-outlined">folder_shared</span>
            <span className="hidden lg:inline font-medium">Solved Shared</span>
          </a>
          <Link href="/analytics" className="flex items-center gap-4 text-slate-400 px-4 py-3 hover:bg-white/5 rounded-xl hover:text-[#00D2FD] transition-all duration-300">
            <span className="material-symbols-outlined">analytics</span>
            <span className="hidden lg:inline font-medium">Analytics</span>
          </Link>
        </nav>
      </aside>

      <main className="md:ml-20 lg:ml-72 pt-24 pb-32 px-6 md:px-10 max-w-5xl mx-auto">
        <div className="pt-8 mb-10">
          <p className="text-xs font-bold tracking-widest text-secondary uppercase mb-2">Your practice history</p>
          <h2 className="text-4xl font-extrabold text-white tracking-tight">Solved Shared</h2>
          <p className="text-on-surface-variant mt-2 text-sm">MCQ sets shared with you that you've started or completed. Pick up right where you left off.</p>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-container" />
          </div>
        )}

        {!loading && sessions.length === 0 && (
          <div className="text-center glass-panel rounded-3xl p-16 max-w-md mx-auto">
            <span className="material-symbols-outlined text-5xl text-on-surface-variant mb-4 block">folder_shared</span>
            <h3 className="text-xl font-bold text-white mb-2">No shared MCQs yet</h3>
            <p className="text-on-surface-variant text-sm">When someone shares a link with you and you start answering, it'll appear here.</p>
          </div>
        )}

        {!loading && sessions.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {sessions.map((s) => {
              const progress = s.total > 0 ? Math.round((s.answered / s.total) * 100) : 0;
              const accuracy = s.answered > 0 ? Math.round((s.correct / s.answered) * 100) : null;
              const isComplete = s.answered === s.total && s.total > 0;
              const updatedDate = s.updated_at ? new Date(s.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;

              return (
                <div key={s.lecture_id} className="glass-panel rounded-2xl p-6 border border-outline-variant/10 hover:-translate-y-1 transition-transform duration-200 flex flex-col gap-4">
                  {/* Title + status */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold text-white text-lg leading-snug truncate">{s.lecture_title}</h3>
                      {updatedDate && (
                        <p className="text-xs text-on-surface-variant mt-0.5">Last studied {updatedDate}</p>
                      )}
                    </div>
                    {isComplete ? (
                      <span className="flex-shrink-0 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">Done</span>
                    ) : (
                      <span className="flex-shrink-0 px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full bg-primary-container/20 border border-primary/20 text-primary">In progress</span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs text-on-surface-variant mb-1.5">
                      <span>{s.answered}/{s.total} answered</span>
                      {accuracy !== null && <span>{accuracy}% accuracy</span>}
                    </div>
                    <div className="h-2 w-full bg-surface-container-highest rounded-full overflow-hidden">
                      <div
                        className="h-full synapse-gradient rounded-full transition-all duration-500"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-sm text-green-400">check_circle</span>
                      {s.correct} correct
                    </span>
                    {s.retake_count > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">history</span>
                        {s.retake_count} retake{s.retake_count !== 1 ? "s" : ""}
                      </span>
                    )}
                  </div>

                  {/* Continue button */}
                  <Link
                    href={`/shared/${s.share_token}`}
                    className="mt-auto flex items-center justify-center gap-2 py-3 synapse-gradient text-white font-bold rounded-xl text-sm hover:-translate-y-0.5 transition-transform shadow-lg"
                  >
                    <span className="material-symbols-outlined text-sm">{isComplete ? "replay" : "play_arrow"}</span>
                    {isComplete ? "Review / Retake" : "Continue"}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
