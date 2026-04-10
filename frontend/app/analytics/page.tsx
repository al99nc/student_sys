"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth";

const subjects = [
  { name: "Neuroscience: The Synaptic Gap", score: 92, color: "bg-secondary-container", textColor: "text-secondary", date: "Oct 24, 2023", time: "1h 12m" },
  { name: "Intro to Quantum Mechanics", score: 74, color: "bg-tertiary", textColor: "text-tertiary", date: "Oct 22, 2023", time: "58m" },
  { name: "Cognitive Psychology 101", score: 88, color: "bg-secondary-container", textColor: "text-secondary", date: "Oct 19, 2023", time: "2h 05m" },
  { name: "Bioethics in the Digital Age", score: 45, color: "bg-error", textColor: "text-error", date: "Oct 15, 2023", time: "42m" },
];

const barHeights = ["40%", "65%", "90%", "55%", "30%", "75%", "20%"];

export default function AnalyticsPage() {
  const router = useRouter();
  const handleLogout = () => logout();

  return (
    <div className="relative min-h-screen text-on-surface" style={{ backgroundColor: "#111220" }}>
      <div className="grain-overlay" />

      {/* Top Nav */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)]">
        <div className="flex items-center gap-4">
          <span className="material-symbols-outlined text-white cursor-pointer">menu</span>
          <span className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">cortexQ</span>
        </div>
        <div className="hidden md:flex items-center gap-8">
          <nav className="flex gap-6">
            <Link href="/dashboard" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Dashboard</Link>
            <a className="text-[#00D2FD] font-bold text-sm">Analytics</a>
          </nav>
          <Link href="/upload" className="bg-gradient-to-r from-primary-container to-secondary-container text-white px-5 py-2 rounded-lg font-bold text-sm hover:-translate-y-1 transition-transform duration-300 shadow-lg shadow-primary-container/20">
            + Upload
          </Link>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-72 z-[60] flex-col bg-slate-950/95 backdrop-blur-2xl rounded-r-2xl border-r border-white/10 shadow-2xl pt-24 pb-8">
        <div className="px-6 mb-8 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-container to-secondary-container p-[2px]">
            <div className="w-full h-full rounded-full bg-surface-dim flex items-center justify-center">
              <span className="material-symbols-outlined text-primary">person</span>
            </div>
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">Intelligence Explorer</h3>
            <p className="text-slate-400 text-xs">Pro Plan</p>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {[
            { icon: "dashboard", label: "Dashboard", href: "/dashboard" },
            { icon: "play_circle", label: "My Lectures", href: "/dashboard" },
            { icon: "upload_file", label: "Upload", href: "/upload" },
          ].map((item) => (
            <Link key={item.label} href={item.href} className="text-slate-400 px-4 py-3 hover:bg-white/5 flex items-center gap-3 rounded-xl transition-all hover:text-[#00D2FD]">
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
          <div className="bg-gradient-to-r from-[#7B2FFF]/20 to-[#00D2FD]/20 text-white border-l-4 border-[#00D2FD] px-4 py-3 flex items-center gap-3 rounded-r-xl">
            <span className="material-symbols-outlined text-[#00D2FD]">analytics</span>
            <span className="text-sm font-medium">Analytics</span>
          </div>
        </nav>
        <div className="px-6 mt-auto">
          <div className="bg-surface-container-high p-4 rounded-xl border border-white/5">
            <p className="text-xs text-[#00D2FD] font-bold mb-1">Upgrade to Pro</p>
            <p className="text-[10px] text-slate-400 mb-3">Unlock unlimited AI transcription &amp; insights.</p>
            <button className="w-full py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-bold rounded-lg transition-colors">Learn More</button>
          </div>
        </div>
      </aside>

      <main className="lg:ml-72 pt-20 sm:pt-28 pb-32 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 7rem)" }}>
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">Your Study Analytics</h1>
            <p className="text-primary-fixed-dim text-lg font-medium">Visualizing your cognitive growth.</p>
          </div>
          <div className="relative inline-block w-full md:w-auto">
            <select className="appearance-none bg-surface-container-low border-none text-on-surface py-3 pl-5 pr-12 rounded-xl text-sm font-medium w-full cursor-pointer shadow-lg outline-none">
              <option>Last 30 Days</option>
              <option>Last 7 Days</option>
              <option>This Semester</option>
              <option>All Time</option>
            </select>
            <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">expand_more</span>
          </div>
        </header>

        {/* Achievements */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          {[
            { icon: "rocket_launch", color: "bg-primary-container/20", iconColor: "text-primary", glow: "rgba(123,47,255,0.3)", label: "First Upload", status: "Unlocked" },
            { icon: "military_tech", color: "bg-tertiary-container/30", iconColor: "text-tertiary", glow: "rgba(255,185,85,0.3)", label: "Perfect Score", status: "Unlocked" },
            { icon: "local_fire_department", color: "bg-secondary-container/20", iconColor: "text-secondary", glow: "rgba(0,210,253,0.3)", label: "7-Day Streak", status: "Unlocked" },
            { icon: "school", color: "bg-slate-700/50", iconColor: "text-slate-400", glow: "transparent", label: "10 Lectures", status: "6/10 Completed", locked: true },
          ].map((b) => (
            <div key={b.label} className={`bg-surface-container-low p-6 rounded-xl border border-white/5 hover:-translate-y-1 transition-all duration-300 ${b.locked ? "grayscale opacity-60" : ""}`}>
              <div className={`w-12 h-12 ${b.color} rounded-full flex items-center justify-center mb-4`} style={{ boxShadow: `0 0 20px ${b.glow}` }}>
                <span className={`material-symbols-outlined ${b.iconColor} text-3xl`}>{b.icon}</span>
              </div>
              <h4 className="text-white font-bold text-sm mb-1">{b.label}</h4>
              <p className="text-slate-400 text-[10px] uppercase tracking-wider font-bold">{b.status}</p>
            </div>
          ))}
        </section>

        {/* Line Chart */}
        <section className="bg-surface-container-low p-8 rounded-xl border border-white/5 mb-8 shadow-xl">
          <div className="flex justify-between items-center mb-10">
            <div>
              <h2 className="text-xl font-bold text-white mb-1">MCQ Score Over Time</h2>
              <p className="text-slate-400 text-sm">Aggregated performance across all subjects.</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest text-slate-500">
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-primary-container" /> Average</div>
              <div className="flex items-center gap-2"><span className="w-3 h-3 rounded-full bg-secondary-container" /> Current</div>
            </div>
          </div>
          <div className="h-64 w-full relative flex items-end justify-between px-4">
            <div className="absolute inset-0 flex justify-between pointer-events-none opacity-10">
              {[...Array(6)].map((_, i) => <div key={i} className="w-px h-full bg-white" />)}
            </div>
            <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
              <defs>
                <linearGradient id="lineGrad" x1="0%" x2="100%" y1="0%" y2="0%">
                  <stop offset="0%" style={{ stopColor: "#7B2FFF", stopOpacity: 1 }} />
                  <stop offset="100%" style={{ stopColor: "#00D2FD", stopOpacity: 1 }} />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur result="coloredBlur" stdDeviation="4" />
                  <feMerge><feMergeNode in="coloredBlur" /><feMergeNode in="SourceGraphic" /></feMerge>
                </filter>
              </defs>
              <path d="M0,180 Q100,220 200,120 T400,140 T600,60 T800,100 T1000,40" fill="none" filter="url(#glow)" stroke="url(#lineGrad)" strokeWidth="4" />
              <circle cx="200" cy="120" fill="#7B2FFF" r="6" />
              <circle cx="400" cy="140" fill="#7B2FFF" r="6" />
              <circle cx="600" cy="60" fill="#00D2FD" r="6" />
              <circle cx="1000" cy="40" fill="#00D2FD" r="8" stroke="white" strokeWidth="3" />
            </svg>
          </div>
          <div className="flex justify-between mt-6 text-xs font-bold text-slate-500 uppercase px-4">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}
          </div>
        </section>

        {/* Side-by-side Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Bar Chart */}
          <section className="bg-surface-container-low p-8 rounded-xl border border-white/5 shadow-xl">
            <h3 className="text-white font-bold mb-6">Lectures Per Week</h3>
            <div className="flex items-end justify-between gap-2 h-48">
              {barHeights.map((h, i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-t-lg transition-colors duration-300 ${i === 2 ? "bg-secondary-container shadow-[0_0_15px_rgba(0,210,253,0.3)]" : "bg-surface-container-highest hover:bg-secondary-container"}`}
                  style={{ height: h }}
                />
              ))}
            </div>
            <div className="flex justify-between mt-4 text-[10px] font-bold text-slate-500">
              {["W1", "W2", "W3", "W4", "W5", "W6", "W7"].map((w) => <span key={w}>{w}</span>)}
            </div>
          </section>

          {/* Donut Chart */}
          <section className="bg-surface-container-low p-8 rounded-xl border border-white/5 shadow-xl flex flex-col items-center">
            <h3 className="text-white font-bold self-start mb-6">Score Distribution</h3>
            <div className="relative w-40 h-40">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" fill="transparent" r="40" stroke="#93000a" strokeDasharray="251.2" strokeDashoffset="200" strokeWidth="12" />
                <circle cx="50" cy="50" fill="transparent" r="40" stroke="#ffb955" strokeDasharray="251.2" strokeDashoffset="150" strokeWidth="12" />
                <circle cx="50" cy="50" fill="transparent" r="40" stroke="#3cd7ff" strokeDasharray="251.2" strokeDashoffset="80" strokeWidth="12" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-black text-white">84%</span>
                <span className="text-[8px] text-slate-400 uppercase tracking-widest font-bold">Overall</span>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-8 w-full">
              <div className="text-center">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Mastered</p>
                <p className="text-secondary font-bold">62%</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Improving</p>
                <p className="text-tertiary font-bold">28%</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Critical</p>
                <p className="text-error font-bold">10%</p>
              </div>
            </div>
          </section>
        </div>

        {/* Subject Table */}
        <section className="bg-surface-container-low rounded-xl border border-white/5 shadow-2xl overflow-hidden">
          <div className="p-8 border-b border-white/5 flex justify-between items-center">
            <h3 className="text-white font-bold">Subject Performance Breakdown</h3>
            <button className="text-secondary text-sm font-bold flex items-center gap-1 hover:underline">
              <span className="material-symbols-outlined text-sm">download</span> Export
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-slate-500 text-[10px] uppercase tracking-widest font-bold border-b border-white/5">
                  <th className="px-8 py-4">Lecture Name</th>
                  <th className="px-8 py-4">Score</th>
                  <th className="px-8 py-4">Date</th>
                  <th className="px-8 py-4">Time</th>
                  <th className="px-8 py-4" />
                </tr>
              </thead>
              <tbody className="text-sm">
                {subjects.map((s, i) => (
                  <tr key={s.name} className={`${i % 2 === 1 ? "bg-surface-container-highest/30" : ""} hover:bg-white/5 transition-colors`}>
                    <td className="px-8 py-5 text-white font-medium">{s.name}</td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                          <div className={`h-full ${s.color}`} style={{ width: `${s.score}%` }} />
                        </div>
                        <span className={`font-bold ${s.textColor}`}>{s.score}%</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-slate-400">{s.date}</td>
                    <td className="px-8 py-5 text-slate-400">{s.time}</td>
                    <td className="px-8 py-5">
                      <button className="material-symbols-outlined text-slate-500 hover:text-white">more_vert</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Mobile Bottom Nav */}
      <footer className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-slate-950/95 backdrop-blur-xl border-t border-white/5">
        <Link href="/dashboard" className="flex flex-col items-center gap-0.5 text-slate-500 hover:text-white transition-colors">
          <span className="material-symbols-outlined text-[22px]">home</span>
          <span className="text-[10px] uppercase tracking-widest">Home</span>
        </Link>
        <Link href="/upload" className="flex flex-col items-center gap-0.5 text-slate-500 hover:text-white transition-colors">
          <span className="material-symbols-outlined text-[22px]">upload_file</span>
          <span className="text-[10px] uppercase tracking-widest">Upload</span>
        </Link>
        <div className="flex flex-col items-center gap-0.5 text-[#00D2FD]">
          <span className="material-symbols-outlined text-[22px]" style={{ fontVariationSettings: "'FILL' 1" }}>insights</span>
          <span className="text-[10px] uppercase tracking-widest">Stats</span>
        </div>
        <button onClick={handleLogout} className="flex flex-col items-center gap-0.5 text-slate-500 hover:text-white transition-colors">
          <span className="material-symbols-outlined text-[22px]">logout</span>
          <span className="text-[10px] uppercase tracking-widest">Logout</span>
        </button>
      </footer>
    </div>
  );
}
