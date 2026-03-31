"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getLectures, getStats, getMySharedSessions } from "@/lib/api";
import { isAuthenticated, logout } from "@/lib/auth";
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

export default function DashboardPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [stats, setStats] = useState({ total_lectures: 0, processed_lectures: 0, total_mcqs_answered: 0, avg_score: 0 });
  const [sharedSessions, setSharedSessions] = useState<SharedSession[]>([]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    fetchLectures();
  }, [router]);

  const fetchLectures = async () => {
    try {
      const [lecturesRes, statsRes, sharedRes] = await Promise.all([
        getLectures(), getStats(), getMySharedSessions()
      ]);
      setLectures(lecturesRes.data);
      setStats(statsRes.data);
      setSharedSessions(sharedRes.data);
    } catch {
      setError("Failed to load lectures");
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => logout();

  const displayedLectures = filter === "all" ? lectures : lectures;

  return (
    <div className="relative min-h-screen text-on-surface" style={{ backgroundColor: "#111220", backgroundImage: "radial-gradient(at 0% 0%, rgba(123,47,255,0.05) 0px, transparent 50%), radial-gradient(at 100% 0%, rgba(0,210,253,0.05) 0px, transparent 50%)", backgroundAttachment: "fixed" }}>
      <div className="grain-overlay" />

      {/* Top Nav */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)] border-b border-white/5">
        <div className="flex items-center gap-8">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent tracking-tight">cortexQ</h1>
          <nav className="hidden md:flex gap-6 items-center">
            <a className="text-[#00D2FD] font-bold text-sm">Dashboard</a>
            <Link href="/analytics" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Analytics</Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/upload" className="hidden md:flex items-center gap-2 synapse-gradient text-white font-bold py-2 px-4 rounded-lg text-sm shadow-lg hover:-translate-y-0.5 transition-transform">
            <span className="material-symbols-outlined text-sm">add</span>
            Upload
          </Link>
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-white transition-colors">
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="fixed left-0 top-0 h-full w-20 lg:w-72 z-[60] flex-col bg-slate-950/95 backdrop-blur-2xl border-r border-white/10 hidden md:flex pt-24">
        <div className="px-6 mb-10 hidden lg:block">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5">
            <p className="text-xs font-bold text-secondary uppercase tracking-widest mb-1">Welcome back</p>
            <p className="text-sm text-slate-400">Your lecture library</p>
          </div>
        </div>
        <nav className="flex-1 flex flex-col gap-2 px-4">
          <a className="flex items-center gap-4 bg-gradient-to-r from-[#7B2FFF]/20 to-[#00D2FD]/20 text-white border-l-4 border-[#00D2FD] px-4 py-3 rounded-r-xl">
            <span className="material-symbols-outlined">dashboard</span>
            <span className="hidden lg:inline font-medium">Dashboard</span>
          </a>
          <Link href="/upload" className="flex items-center gap-4 text-slate-400 px-4 py-3 hover:bg-white/5 rounded-xl hover:text-[#00D2FD] transition-all duration-300">
            <span className="material-symbols-outlined">upload_file</span>
            <span className="hidden lg:inline font-medium">Upload</span>
          </Link>
          <Link href="/analytics" className="flex items-center gap-4 text-slate-400 px-4 py-3 hover:bg-white/5 rounded-xl hover:text-[#00D2FD] transition-all duration-300">
            <span className="material-symbols-outlined">analytics</span>
            <span className="hidden lg:inline font-medium">Analytics</span>
          </Link>
          <button onClick={handleLogout} className="flex items-center gap-4 text-slate-400 px-4 py-3 hover:bg-white/5 rounded-xl hover:text-[#00D2FD] transition-all duration-300 mt-auto mb-6 text-left w-full">
            <span className="material-symbols-outlined">logout</span>
            <span className="hidden lg:inline font-medium">Logout</span>
          </button>
        </nav>
      </aside>

      {/* Main */}
      <main className="md:ml-20 lg:ml-72 pt-24 pb-32 px-6 md:px-10 max-w-7xl mx-auto">

        {/* Welcome Banner */}
        <section className="mb-10">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-primary-container via-primary-container to-secondary-container p-8 md:p-12 shadow-2xl shadow-primary-container/20">
            <div className="absolute top-0 right-0 w-1/2 h-full opacity-20 pointer-events-none">
              <svg className="w-full h-full scale-150 rotate-12" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
                <path d="M47.5,-63.2C60.1,-55.4,68,-40.1,73.4,-24.1C78.9,-8,81.9,8.7,77.5,23.6C73,38.5,61,51.6,46.8,61C32.5,70.5,16.3,76.3,-1.2,78C-18.7,79.7,-37.4,77.2,-52.1,67.7C-66.8,58.2,-77.6,41.6,-81,24.1C-84.5,6.6,-80.7,-11.8,-71.7,-26.8C-62.7,-41.8,-48.5,-53.5,-34.2,-60.5C-20,-67.5,-5.7,-69.8,10.9,-68.1C27.5,-66.4,47.5,-63.2,47.5,-63.2Z" fill="white" transform="translate(200 200)" />
              </svg>
            </div>
            <div className="relative z-10">
              <h2 className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight">Your Lectures</h2>
              <p className="text-white/80 text-lg font-medium max-w-xl">
                {loading ? "Loading..." : lectures.length === 0
                  ? "No lectures yet. Upload your first PDF to get started."
                  : `You have ${lectures.length} lecture${lectures.length !== 1 ? "s" : ""} ready to study.`}
              </p>
              <Link href="/upload" className="mt-8 inline-block px-8 py-4 rounded-xl bg-white text-primary-container font-bold hover:-translate-y-1 transition-transform shadow-xl">
                + Upload New Lecture
              </Link>
            </div>
          </div>
        </section>

        {/* Stats */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {[
            { icon: "upload_file", color: "#00D2FD", colorBg: "#00D2FD", label: "Total Uploads", value: loading ? "—" : String(stats.total_lectures), badge: `${stats.processed_lectures} processed`, badgeColor: "text-secondary" },
            { icon: "task_alt", color: "#7B2FFF", colorBg: "#7B2FFF", label: "Processed", value: loading ? "—" : String(stats.processed_lectures), badge: "Ready", badgeColor: "text-primary" },
            { icon: "quiz", color: "#ffb955", colorBg: "#ffb955", label: "MCQs Answered", value: loading ? "—" : String(stats.total_mcqs_answered), badge: "Total", badgeColor: "text-tertiary" },
            { icon: "insights", color: "#a2e7ff", colorBg: "#a2e7ff", label: "Avg. Score", value: loading ? "—" : stats.total_mcqs_answered > 0 ? `${stats.avg_score}%` : "—", badge: stats.avg_score >= 80 ? "Great" : stats.avg_score >= 60 ? "Good" : stats.total_mcqs_answered > 0 ? "Keep going" : "No data", badgeColor: "text-secondary" },
          ].map((s) => (
            <div key={s.label} className="bg-surface-container-low/40 backdrop-blur-xl border border-white/5 p-6 rounded-2xl hover:-translate-y-1 transition-transform duration-300">
              <div className="flex justify-between items-start mb-4">
                <span className="material-symbols-outlined p-2 rounded-lg text-sm" style={{ color: s.color, backgroundColor: `${s.colorBg}1a` }}>{s.icon}</span>
                <span className={`text-xs font-bold uppercase tracking-widest ${s.badgeColor}`}>{s.badge}</span>
              </div>
              <p className="text-slate-400 text-sm font-medium mb-1">{s.label}</p>
              <h3 className="text-3xl font-bold text-white">{s.value}</h3>
            </div>
          ))}
        </section>

        {/* Shared Files Section */}
        {sharedSessions.length > 0 && (
          <section id="shared-section" className="mb-12">
            <div className="flex items-center gap-3 mb-6">
              <h3 className="text-2xl font-bold text-white tracking-tight">Shared With You</h3>
              <span className="px-2.5 py-1 rounded-full text-xs font-black tracking-widest text-[#00D2FD] bg-[#00D2FD]/10 border border-[#00D2FD]/20">
                {sharedSessions.length}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              {sharedSessions.map((s) => {
                const pct = s.total > 0 ? Math.round((s.answered / s.total) * 100) : 0;
                const score = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
                return (
                  <Link
                    key={s.share_token}
                    href={`/shared/${s.share_token}`}
                    className="group relative bg-surface-container-low/30 backdrop-blur-md border border-[#00D2FD]/15 rounded-3xl overflow-hidden hover:-translate-y-2 transition-all duration-300 hover:shadow-2xl hover:shadow-[#00D2FD]/10 hover:border-[#00D2FD]/30"
                  >
                    {/* Top accent — teal to distinguish from own lectures */}
                    <div className="h-1.5 w-full bg-gradient-to-r from-[#00D2FD] to-[#7B2FFF]" />
                    <div className="p-6">
                      <div className="flex items-center justify-between mb-4">
                        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#00D2FD] bg-[#00D2FD]/10 px-3 py-1 rounded-full">
                          <span className="material-symbols-outlined text-xs">folder_shared</span>
                          SHARED
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-base text-[#00D2FD]/50">cloud_sync</span>
                          {s.updated_at && (
                            <span className="text-xs text-slate-500">{new Date(s.updated_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                      <h4 className="text-base font-bold text-white mb-4 group-hover:text-[#00D2FD] transition-colors leading-tight line-clamp-2 break-words min-w-0">
                        {s.lecture_title}
                      </h4>
                      {/* Progress bar */}
                      <div className="mb-3">
                        <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                          <span>{s.answered}/{s.total} answered</span>
                          {s.answered > 0 && <span className={score >= 70 ? "text-green-400" : score >= 50 ? "text-yellow-400" : "text-red-400"}>{score}% correct</span>}
                        </div>
                        <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[#00D2FD] to-[#7B2FFF] transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        {pct === 0 ? "Not started" : pct === 100 ? "Completed" : `${pct}% complete`}
                        {s.retake_count > 0 && ` · ${s.retake_count} retake${s.retake_count > 1 ? "s" : ""}`}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Filter + Grid */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <h3 className="text-2xl font-bold text-white tracking-tight">Recent Lectures</h3>
          <div className="flex items-center gap-3 overflow-x-auto pb-2 md:pb-0 scrollbar-hide">
            {(["all", "processed", "processing", "unprocessed"] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-5 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filter === f ? "synapse-gradient text-white shadow-lg" : "bg-white/5 border border-white/5 text-slate-400 hover:text-white"}`}
              >
                {f === "all" ? "All" : f === "processed" ? "Processed ✓" : f === "processing" ? "In Progress ⏳" : "Unprocessed"}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-container" />
          </div>
        )}

        {error && (
          <div className="bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">{error}</div>
        )}

        {!loading && displayedLectures.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-2xl bg-surface-container-highest flex items-center justify-center mx-auto mb-6">
              <span className="material-symbols-outlined text-4xl text-on-surface-variant">description</span>
            </div>
            <h3 className="text-white font-bold text-xl mb-2">No lectures yet</h3>
            <p className="text-on-surface-variant mb-6">Upload your first lecture PDF to get started</p>
            <Link href="/upload" className="inline-block synapse-gradient text-white font-bold px-8 py-3 rounded-xl shadow-lg hover:-translate-y-1 transition-transform">
              Upload Lecture
            </Link>
          </div>
        )}

        {!loading && displayedLectures.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8">
            {displayedLectures.map((lecture) => (
              <div key={lecture.id} className="group relative bg-surface-container-low/30 backdrop-blur-md border border-white/10 rounded-3xl overflow-hidden hover:-translate-y-2 transition-all duration-300 hover:shadow-2xl hover:shadow-primary-container/10">
                <div className="h-1.5 w-full bg-gradient-to-r from-primary-container to-secondary-container" />
                <div className="p-8">
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00D2FD] bg-[#00D2FD]/10 px-3 py-1 rounded-full">PROCESSED</span>
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-slate-500">cloud_done</span>
                      <span className="text-xs text-slate-500 font-medium">{new Date(lecture.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  <h4 className="text-xl font-bold text-white mb-6 group-hover:text-secondary transition-colors leading-tight line-clamp-2 break-words">{lecture.title}</h4>
                  <div className="flex gap-3">
                    <Link href={`/results/${lecture.id}`} className="flex-1 text-center py-3 rounded-xl synapse-gradient text-white font-bold text-sm hover:opacity-90 transition-opacity">
                      View Results
                    </Link>
                    <Link href={`/upload?process=${lecture.id}`} className="flex-1 text-center py-3 rounded-xl bg-white/5 border border-white/10 text-slate-400 hover:text-white font-bold text-sm transition-colors">
                      Process
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Mobile Bottom Nav */}
      <footer className="fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-slate-950/90 backdrop-blur-lg border-t border-white/5 md:hidden">
        <a className="flex flex-col items-center text-[#00D2FD]">
          <span className="material-symbols-outlined">home</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Home</span>
        </a>
        <Link href="/upload" className="flex flex-col items-center text-slate-500">
          <span className="material-symbols-outlined">upload_file</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Upload</span>
        </Link>
        {/* Shared tab — shows badge when there are active shared sessions */}
        <a
          href="#shared-section"
          onClick={(e) => { e.preventDefault(); document.getElementById("shared-section")?.scrollIntoView({ behavior: "smooth" }); }}
          className="flex flex-col items-center text-slate-500 relative"
        >
          <span className="relative">
            <span className="material-symbols-outlined">cloud_sync</span>
            {sharedSessions.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#00D2FD] text-[9px] font-black text-slate-950 flex items-center justify-center leading-none">
                {sharedSessions.length > 9 ? "9+" : sharedSessions.length}
              </span>
            )}
          </span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Shared</span>
        </a>
        <Link href="/analytics" className="flex flex-col items-center text-slate-500">
          <span className="material-symbols-outlined">insights</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Stats</span>
        </Link>
        <button onClick={handleLogout} className="flex flex-col items-center text-slate-500">
          <span className="material-symbols-outlined">logout</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Logout</span>
        </button>
      </footer>

      {/* FAB */}
      <Link href="/upload" className="fixed right-6 bottom-24 md:bottom-10 z-[70] w-14 h-14 rounded-full synapse-gradient text-white shadow-2xl flex items-center justify-center hover:scale-110 active:scale-95 transition-all">
        <span className="material-symbols-outlined text-3xl">add</span>
      </Link>
    </div>
  );
}
