"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getLectures, getStats, getMySharedSessions, getNextBestAction } from "@/lib/api";
import { isAuthenticated, logout, getToken } from "@/lib/auth";
import Link from "next/link";

interface Lecture {
  id: number;
  title: string;
  file_path: string;
  created_at: string;
}

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

type Filter = "all" | "processed" | "processing" | "unprocessed";

function getUsernameFromToken(): string {
  const token = getToken();
  if (!token) return "Student";
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || payload.username || payload.name || "Student";
  } catch {
    return "Student";
  }
}

function formatDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function isValid(value: any): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized !== "" && normalized !== "null" && normalized !== "none";
  }
  return true;
}

export default function DashboardPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [stats, setStats] = useState({ total_lectures: 0, processed_lectures: 0, total_mcqs_answered: 0, avg_score: 0 });
  const [sharedSessions, setSharedSessions] = useState<SharedSession[]>([]);
  const [nextAction, setNextAction] = useState<any>(null);
  const [nextActionError, setNextActionError] = useState("");
  const [userName, setUserName] = useState("Student");
  const today = formatDate(new Date());

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    setUserName(getUsernameFromToken());
    fetchData();
  }, [router]);

  const fetchData = async () => {
    try {
      const [lecturesRes, statsRes, sharedRes, nextActionRes] = await Promise.all([
        getLectures(), getStats(), getMySharedSessions(), getNextBestAction()
      ]);
      setLectures(lecturesRes.data);
      setStats(statsRes.data);
      setSharedSessions(sharedRes.data);
      setNextAction(nextActionRes.data);
      setNextActionError("");
    } catch (err: any) {
      if (err?.response?.status === 404) {
        setNextActionError("No coach action available yet. Start answering questions.");
      } else {
        setNextActionError("Failed to load your coach recommendation.");
      }
      setError("Failed to load lectures");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => logout();

  const displayedLectures = lectures;
  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <div className="flex h-screen overflow-hidden" style={{ backgroundColor: "#0d0f1c", color: "#e2e8f0" }}>

      {/* ── SIDEBAR — hidden on mobile, visible on large screens ── */}
      <aside className="hidden lg:flex w-[230px] flex-shrink-0 flex-col border-r" style={{ borderColor: "rgba(255,255,255,0.06)", backgroundColor: "#0b0d1a" }}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-sm" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
            cQ
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">CortexQ</p>
            <p className="text-[10px] font-medium" style={{ color: "#4a5280" }}>BETA · v0.9</p>
          </div>
        </div>

        <div className="mx-5 mb-5" style={{ height: 1, backgroundColor: "rgba(255,255,255,0.06)" }} />

        {/* Nav */}
        <nav className="flex-1 px-3 space-y-0.5 overflow-y-auto">
          <p className="text-[10px] font-bold uppercase tracking-widest px-3 mb-2" style={{ color: "#3a3f60" }}>Main</p>

          <a className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-white font-medium text-sm cursor-pointer" style={{ background: "rgba(255,255,255,0.06)", borderLeft: "2px solid #00D2FD" }}>
            <span className="material-symbols-outlined text-[18px]" style={{ color: "#00D2FD" }}>grid_view</span>
            Dashboard
          </a>

          <Link href="/lectures" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors" style={{ color: "#6b7280" }} onMouseEnter={e => (e.currentTarget.style.color="#e2e8f0")} onMouseLeave={e => (e.currentTarget.style.color="#6b7280")}>
            <span className="material-symbols-outlined text-[18px]">menu_book</span>
            Lectures
          </Link>

          <Link href="/practice" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors" style={{ color: "#6b7280" }} onMouseEnter={e => (e.currentTarget.style.color="#e2e8f0")} onMouseLeave={e => (e.currentTarget.style.color="#6b7280")}>
            <span className="material-symbols-outlined text-[18px]">timer</span>
            Practice
          </Link>

          <p className="text-[10px] font-bold uppercase tracking-widest px-3 pt-4 mb-2" style={{ color: "#3a3f60" }}>Insights</p>

          <Link href="/analytics" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors" style={{ color: "#6b7280" }} onMouseEnter={e => (e.currentTarget.style.color="#e2e8f0")} onMouseLeave={e => (e.currentTarget.style.color="#6b7280")}>
            <span className="material-symbols-outlined text-[18px]">trending_up</span>
            Analytics
          </Link>

          <Link href="/weak-points" className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors" style={{ color: "#6b7280" }} onMouseEnter={e => (e.currentTarget.style.color="#e2e8f0")} onMouseLeave={e => (e.currentTarget.style.color="#6b7280")}>
            <span className="material-symbols-outlined text-[18px]">radio_button_checked</span>
            Weak Points
          </Link>
        </nav>

        {/* User profile */}
        <div className="px-4 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
              {userInitial}
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold truncate">{userName}</p>
              <p className="text-xs truncate" style={{ color: "#4a5280" }}>med student</p>
            </div>
          </div>
        </div>
      </aside>

      {/* ── MAIN AREA ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top header */}
        <header className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-5 flex-shrink-0" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <div className="flex items-center gap-3">
            {/* Logo — mobile only */}
            <div className="flex lg:hidden w-8 h-8 rounded-xl items-center justify-center font-black text-white text-xs flex-shrink-0" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
              cQ
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-white">Dashboard</h1>
              <p className="text-xs sm:text-sm mt-0.5 hidden sm:block" style={{ color: "#4a5280" }}>// {today} — {loading ? "…" : "00"} active sessions</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <button className="w-9 h-9 rounded-xl flex items-center justify-center transition-colors" style={{ border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#6b7280" }}>
              <span className="material-symbols-outlined text-[18px]">notifications</span>
            </button>
            <Link href="/upload" className="flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-white text-sm font-semibold transition-all" style={{ border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.04)" }}>
              <span className="hidden sm:inline">Upload PDF</span>
              <span className="sm:hidden">Upload</span>
            </Link>
          </div>
        </header>

        {/* Scrollable content */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6 pb-24 lg:pb-6">

          {/* ── HERO — Sage-first ── */}
          <div className="relative rounded-2xl overflow-hidden mb-4 sm:mb-6" style={{ background: "#131525", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div className="flex items-center justify-between p-5 sm:p-8">
              {/* Left: Sage greeting */}
              <div className="max-w-md">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-3 sm:mb-4" style={{ color: "#00D2FD" }}>— Your AI Learning Coach</p>
                <h2 className="text-2xl sm:text-3xl font-black text-white leading-tight mb-3 sm:mb-4">
                  Hey {userName},{" "}
                  <span style={{ background: "linear-gradient(90deg, #00D2FD, #7B2FFF)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                    what do you want to work on?
                  </span>
                </h2>
                <p className="text-xs sm:text-sm mb-5" style={{ color: "#6b7280" }}>
                  Ask Sage anything — study plans, weak points, practice sessions, or just motivation.
                </p>
                {/* Suggestion chips */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {[
                    { label: "Plan my study session", icon: "calendar_today" },
                    { label: "What are my weak points?", icon: "radio_button_checked" },
                    { label: "Quiz me on my worst topic", icon: "quiz" },
                    { label: "Motivate me", icon: "bolt" },
                  ].map(({ label, icon }) => (
                    <Link
                      key={label}
                      href={`/coach?q=${encodeURIComponent(label)}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                      style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(123,47,255,0.5)"; (e.currentTarget as HTMLElement).style.color = "#e2e8f0"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.1)"; (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                    >
                      <span className="material-symbols-outlined text-[13px]">{icon}</span>
                      {label}
                    </Link>
                  ))}
                </div>
                <div className="flex items-center gap-3 sm:gap-5">
                  <Link href="/coach" className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-white text-sm font-semibold transition-all flex items-center gap-2" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
                    <span className="material-symbols-outlined text-[16px]">smart_toy</span>
                    Open Sage
                  </Link>
                  <Link href="/upload" className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-white text-sm font-semibold transition-all" style={{ background: "#1e2235", border: "1px solid rgba(255,255,255,0.12)" }}>
                    + Upload Lecture
                  </Link>
                </div>
              </div>

              {/* Right orb graphic — hidden on small screens */}
              <div className="relative hidden sm:flex flex-shrink-0 w-48 h-48 items-center justify-center">
                {/* Concentric rings */}
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                  <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(0,210,253,0.1)" strokeWidth="1" />
                  <circle cx="100" cy="100" r="72" fill="none" stroke="rgba(0,210,253,0.15)" strokeWidth="1" strokeDasharray="4 4" />
                  <circle cx="100" cy="100" r="54" fill="none" stroke="rgba(123,47,255,0.2)" strokeWidth="1" strokeDasharray="6 3" />
                  <circle cx="100" cy="100" r="36" fill="none" stroke="rgba(0,210,253,0.25)" strokeWidth="1.5" />
                </svg>
                {/* Core orb */}
                <div className="relative z-10 w-20 h-20 rounded-full flex items-center justify-center" style={{ background: "radial-gradient(circle at 35% 35%, #e879f9, #a855f7, #7B2FFF)", boxShadow: "0 0 40px rgba(168,85,247,0.5)" }}>
                  <span className="material-symbols-outlined text-3xl text-white/90">neurology</span>
                </div>
                {/* AI-POWERED badge */}
                <div className="absolute bottom-6 right-0 px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-widest" style={{ background: "rgba(0,210,253,0.15)", border: "1px solid rgba(0,210,253,0.3)", color: "#00D2FD" }}>
                  AI-POWERED
                </div>
              </div>
            </div>
          </div>

          {/* ── STATS ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
            {[
              { label: "TOTAL UPLOADS", emoji: "📄", value: loading ? "—" : String(stats.total_lectures), sub: stats.total_lectures === 0 ? "— awaiting upload" : `${stats.processed_lectures} processed` },
              { label: "PROCESSED", emoji: "✅", value: loading ? "—" : String(stats.processed_lectures), sub: stats.processed_lectures === 0 ? "— ready for MCQs" : "lectures ready" },
              { label: "MCQs ANSWERED", emoji: "🎯", value: loading ? "—" : String(stats.total_mcqs_answered), sub: stats.total_mcqs_answered === 0 ? "— start practicing" : "total answered" },
              { label: "AVG. SCORE", emoji: "📊", value: loading ? "—" : stats.total_mcqs_answered > 0 ? `${stats.avg_score}%` : "—.—%", sub: stats.total_mcqs_answered > 0 ? (stats.avg_score >= 80 ? "great work" : "keep going") : "— no data yet" },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl p-5" style={{ background: "#131525", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-start justify-between mb-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#4a5280" }}>{s.label}</p>
                  <span className="text-lg leading-none">{s.emoji}</span>
                </div>
                <p className="text-3xl font-black text-white mb-3">{s.value}</p>
                <span className="text-[11px] font-medium px-2.5 py-1 rounded-lg" style={{ background: "rgba(255,255,255,0.05)", color: "#4a5280" }}>{s.sub}</span>
              </div>
            ))}
          </div>

          {/* ── SHARED SESSIONS (if any) ── */}
          {sharedSessions.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-lg font-bold text-white">Shared With You</h3>
                <span className="text-xs font-black px-2 py-0.5 rounded-full" style={{ background: "rgba(0,210,253,0.1)", color: "#00D2FD", border: "1px solid rgba(0,210,253,0.2)" }}>{sharedSessions.length}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sharedSessions.map((s) => {
                  const pct = s.total > 0 ? Math.round((s.answered / s.total) * 100) : 0;
                  const score = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
                  return (
                    <Link key={s.share_token} href={`/shared/${s.share_token}`} className="rounded-2xl overflow-hidden block transition-transform hover:-translate-y-1" style={{ background: "#131525", border: "1px solid rgba(0,210,253,0.1)" }}>
                      <div className="h-1" style={{ background: "linear-gradient(90deg, #00D2FD, #7B2FFF)" }} />
                      <div className="p-5">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full mb-3 inline-block" style={{ background: "rgba(0,210,253,0.1)", color: "#00D2FD" }}>SHARED</span>
                        <h4 className="text-sm font-bold text-white mb-3 line-clamp-2">{s.lecture_title}</h4>
                        <div className="flex justify-between text-xs mb-1.5" style={{ color: "#4a5280" }}>
                          <span>{s.answered}/{s.total} answered</span>
                          {s.answered > 0 && <span style={{ color: score >= 70 ? "#4ade80" : score >= 50 ? "#fbbf24" : "#f87171" }}>{score}%</span>}
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #00D2FD, #7B2FFF)" }} />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── BOTTOM GRID: Coach (primary) + Lectures ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">

            {/* Your Lectures */}
            <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "#131525", border: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <h3 className="font-bold text-white">Your Lectures</h3>
                <Link href="/upload" className="text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#6b7280" }}>
                  + New
                </Link>
              </div>

              <div className="flex-1 p-6">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: "#7B2FFF" }} />
                  </div>
                ) : displayedLectures.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    {/* Stacked cards icon */}
                    <div className="relative w-16 h-16 mb-5">
                      {[2, 1, 0].map((i) => (
                        <div key={i} className="absolute rounded-xl" style={{ width: 40, height: 48, left: 8 + i * 5, top: i * 5, background: i === 0 ? "#1e2235" : i === 1 ? "#181b2e" : "#131525", border: "1px solid rgba(255,255,255,0.08)", zIndex: 3 - i }} />
                      ))}
                    </div>
                    <p className="font-bold text-white mb-2">No lectures yet</p>
                    <p className="text-xs mb-5" style={{ color: "#4a5280" }}>Upload your first PDF and CortexQ will generate questions within seconds</p>
                    <Link href="/upload" className="text-sm font-semibold px-4 py-2 rounded-xl transition-all" style={{ background: "#1e2235", border: "1px solid rgba(255,255,255,0.1)", color: "#e2e8f0" }}>
                      + Upload New Lecture
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Filter pills */}
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                      {(["all", "processed", "processing", "unprocessed"] as Filter[]).map((f) => (
                        <button key={f} onClick={() => setFilter(f)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0" style={filter === f ? { background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "#fff" } : { background: "rgba(255,255,255,0.05)", color: "#6b7280", border: "1px solid rgba(255,255,255,0.06)" }}>
                          {f === "all" ? "All" : f === "processed" ? "Processed ✓" : f === "processing" ? "In Progress" : "Unprocessed"}
                        </button>
                      ))}
                    </div>
                    {displayedLectures.slice(0, 5).map((lecture) => (
                      <div key={lecture.id} className="flex items-center justify-between px-4 py-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-sm font-semibold text-white truncate">{lecture.title}</p>
                          <p className="text-xs mt-0.5" style={{ color: "#4a5280" }}>{new Date(lecture.created_at).toLocaleDateString()}</p>
                        </div>
                        <Link href={`/results/${lecture.id}`} className="text-xs font-bold px-3 py-1.5 rounded-lg flex-shrink-0 transition-all" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "#fff" }}>
                          View
                        </Link>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* CortexQ Coach */}
            <div className="rounded-2xl overflow-hidden flex flex-col" style={{ background: "#131525", border: "1px solid rgba(255,255,255,0.06)" }}>
              {/* Card header */}
              <div className="flex items-center justify-between px-6 py-5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
                    <span className="material-symbols-outlined text-[18px] text-white">smart_toy</span>
                  </div>
                  <div>
                    <p className="font-bold text-white text-sm">CortexQ Coach</p>
                    <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#4a5280" }}>AI Advisor</p>
                  </div>
                </div>
                <Link href="/coach" className="text-xs font-bold px-3 py-1.5 rounded-xl flex items-center gap-1.5 transition-all text-white" style={{ background: "linear-gradient(135deg, #7B2FFF, #00D2FD)" }}>
                  <span className="material-symbols-outlined text-[14px]">open_in_new</span>
                  Open Sage
                </Link>
              </div>

              <div className="flex-1 p-6 flex flex-col gap-4">
                {/* Action card */}
                <div className="rounded-xl p-4" style={{ background: "rgba(255,255,255,0.03)", borderLeft: "3px solid #00D2FD" }}>
                  {nextAction ? (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#00D2FD" }} />
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#00D2FD" }}>
                          {nextAction.action_type?.replace(/_/g, " ") || "Exploration Mode"}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-white mb-1">
                        {isValid(nextAction?.next_step) ? nextAction.next_step : "Start with a new high-yield topic and do 5 focused questions."}
                      </p>
                      {isValid(nextAction?.topic) && (
                        <p className="text-xs" style={{ color: "#4a5280" }}>· Topic: {nextAction.topic}</p>
                      )}
                      {(!nextAction.topic && (!nextAction.reason || nextAction.reason.length === 0)) && (
                        <p className="text-xs" style={{ color: "#4a5280" }}>· No weak points yet</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ background: "#00D2FD" }} />
                        <span className="text-[10px] font-black uppercase tracking-widest" style={{ color: "#00D2FD" }}>Exploration Mode</span>
                      </div>
                      <p className="text-sm font-semibold text-white mb-1">Start with a new high-yield topic and do 5 focused questions.</p>
                      <p className="text-xs" style={{ color: "#4a5280" }}>· No weak points yet</p>
                    </>
                  )}
                </div>

                {/* Readiness score */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#4a5280" }}>Readiness Score</span>
                    <span className="text-sm font-bold" style={{ color: "#4a5280" }}>
                      {nextAction?.predicted_readiness_24h != null ? `${nextAction.predicted_readiness_24h}%` : "—%"}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${nextAction?.predicted_readiness_24h ?? 0}%`, background: "linear-gradient(90deg, #7B2FFF, #00D2FD)" }} />
                  </div>
                </div>

                {/* Info block */}
                <div className="rounded-xl p-3 flex items-start gap-2.5" style={{ background: "rgba(0,210,100,0.06)", border: "1px solid rgba(0,210,100,0.15)" }}>
                  <span className="text-xs mt-0.5" style={{ color: "#4ade80" }}>↗</span>
                  <p className="text-xs" style={{ color: "#6b7280" }}>
                    {lectures.length === 0
                      ? "Upload your first lecture to unlock AI-powered weak point tracking and daily study plans."
                      : isValid(nextAction?.short_message) ? nextAction.short_message : "Keep practicing to improve your readiness score."}
                  </p>
                </div>

                {/* Quick ask chips */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Plan my next session", q: "Plan my next study session based on my weak points" },
                    { label: "Explain my weak points", q: "Explain my weakest topics and how to fix them" },
                    { label: "What should I do next?", q: "What should I study next?" },
                  ].map(({ label, q }) => (
                    <Link
                      key={label}
                      href={`/coach?q=${encodeURIComponent(q)}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all"
                      style={{ background: "rgba(123,47,255,0.1)", border: "1px solid rgba(123,47,255,0.2)", color: "#a78bfa" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(123,47,255,0.2)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(123,47,255,0.1)"; }}
                    >
                      <span className="material-symbols-outlined text-[12px]">arrow_forward</span>
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171" }}>{error}</div>
          )}

        </main>
      </div>

      {/* ── MOBILE BOTTOM NAV — visible only on mobile ── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-2" style={{ backgroundColor: "#0b0d1a", borderTop: "1px solid rgba(255,255,255,0.08)", paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}>
        <a className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl" style={{ color: "#00D2FD" }}>
          <span className="material-symbols-outlined text-[22px]">grid_view</span>
          <span className="text-[10px] font-semibold">Home</span>
        </a>
        <Link href="/upload" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl" style={{ color: "#6b7280" }}>
          <span className="material-symbols-outlined text-[22px]">upload_file</span>
          <span className="text-[10px] font-semibold">Upload</span>
        </Link>
        <Link href="/coach" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl" style={{ color: "#6b7280" }}>
          <span className="material-symbols-outlined text-[22px]">smart_toy</span>
          <span className="text-[10px] font-semibold">Coach</span>
        </Link>
        <Link href="/analytics" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl" style={{ color: "#6b7280" }}>
          <span className="material-symbols-outlined text-[22px]">trending_up</span>
          <span className="text-[10px] font-semibold">Analytics</span>
        </Link>
      </nav>
    </div>
  );
}
