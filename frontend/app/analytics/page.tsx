"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  LayoutGrid,
  Upload,
  TrendingUp,
  Rocket,
  Medal,
  Flame,
  GraduationCap,
  Download,
  MoreVertical,
  Home,
  Bot,
  LogOut,
  BarChart3,
  Menu,
  User
} from "lucide-react";

const subjects = [
  { name: "Neuroscience: The Synaptic Gap", score: 92, color: "bg-cyan-500", textColor: "text-cyan-400", date: "Oct 24, 2023", time: "1h 12m" },
  { name: "Intro to Quantum Mechanics", score: 74, color: "bg-yellow-500", textColor: "text-yellow-400", date: "Oct 22, 2023", time: "58m" },
  { name: "Cognitive Psychology 101", score: 88, color: "bg-cyan-500", textColor: "text-cyan-400", date: "Oct 19, 2023", time: "2h 05m" },
  { name: "Bioethics in the Digital Age", score: 45, color: "bg-destructive", textColor: "text-destructive", date: "Oct 15, 2023", time: "42m" },
];

const barHeights = ["40%", "65%", "90%", "55%", "30%", "75%", "20%"];

export default function AnalyticsPage() {
  const router = useRouter();
  const handleLogout = () => logout();

  const NAV_ITEMS = [
    { icon: LayoutGrid, label: "Dashboard", href: "/dashboard" },
    { icon: Upload, label: "Upload", href: "/upload" },
    { icon: TrendingUp, label: "Analytics", href: "/analytics", active: true },
  ];

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <div className="grain-overlay" />

      {/* Top Nav */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-card/80 backdrop-blur-xl z-50 border-b border-border/50">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="lg:hidden">
            <Menu className="w-5 h-5" />
          </Button>
          <Link href="/dashboard" className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">
            cortexQ
          </Link>
        </div>
        <div className="hidden md:flex items-center gap-8">
          <nav className="flex gap-6">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
              Dashboard
            </Link>
            <span className="text-primary font-bold text-sm">Analytics</span>
          </nav>
          <Button asChild className="synapse-gradient text-white rounded-lg">
            <Link href="/upload">+ Upload</Link>
          </Button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 h-full w-72 z-[60] flex-col bg-card/95 backdrop-blur-2xl rounded-r-2xl border-r border-border/50 pt-24 pb-8">
        <div className="px-6 mb-8 flex items-center gap-3">
          <div className="w-12 h-12 rounded-full synapse-gradient p-[2px]">
            <div className="w-full h-full rounded-full bg-card flex items-center justify-center">
              <User className="w-5 h-5 text-primary" />
            </div>
          </div>
          <div>
            <h3 className="text-foreground font-bold text-sm">Intelligence Explorer</h3>
            <p className="text-muted-foreground text-xs">Pro Plan</p>
          </div>
        </div>
        <nav className="flex-1 px-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                item.active
                  ? "bg-gradient-to-r from-primary/20 to-cyan-500/10 text-foreground border-l-4 border-cyan-500"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-primary"
              }`}
            >
              <item.icon className={`w-5 h-5 ${item.active ? "text-cyan-500" : ""}`} />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="px-6 mt-auto">
          <Card className="glass-panel border-border/50">
            <CardContent className="p-4">
              <p className="text-xs text-cyan-400 font-bold mb-1">Upgrade to Pro</p>
              <p className="text-[10px] text-muted-foreground mb-3">Unlock unlimited AI transcription & insights.</p>
              <Button variant="outline" size="sm" className="w-full rounded-lg">
                Learn More
              </Button>
            </CardContent>
          </Card>
        </div>
      </aside>

      <main className="lg:ml-72 pt-20 sm:pt-28 pb-32 px-4 sm:px-6 md:px-12 max-w-7xl mx-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 7rem)" }}>
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-12">
          <div className="space-y-2">
            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-foreground tracking-tight">
              Your Study Analytics
            </h1>
            <p className="text-primary text-lg font-medium">Visualizing your cognitive growth.</p>
          </div>
          <div className="relative inline-block w-full md:w-auto">
            <select className="appearance-none bg-card border border-border/50 text-foreground py-3 pl-5 pr-12 rounded-xl text-sm font-medium w-full cursor-pointer shadow-lg outline-none focus:ring-2 focus:ring-primary/50">
              <option>Last 30 Days</option>
              <option>Last 7 Days</option>
              <option>This Semester</option>
              <option>All Time</option>
            </select>
            <span className="material-symbols-outlined absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">expand_more</span>
          </div>
        </header>

        {/* Achievements */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          {[
            { icon: Rocket, color: "bg-primary/20", iconColor: "text-primary", glow: "rgba(123,47,255,0.3)", label: "First Upload", status: "Unlocked" },
            { icon: Medal, color: "bg-yellow-500/20", iconColor: "text-yellow-500", glow: "rgba(255,185,85,0.3)", label: "Perfect Score", status: "Unlocked" },
            { icon: Flame, color: "bg-cyan-500/20", iconColor: "text-cyan-500", glow: "rgba(0,210,253,0.3)", label: "7-Day Streak", status: "Unlocked" },
            { icon: GraduationCap, color: "bg-muted", iconColor: "text-muted-foreground", glow: "transparent", label: "10 Lectures", status: "6/10 Completed", locked: true },
          ].map((b) => (
            <Card key={b.label} className={`glass-panel border-border/50 hover:-translate-y-1 transition-all duration-300 ${b.locked ? "grayscale opacity-60" : ""}`}>
              <CardContent className="p-6">
                <div
                  className={`w-12 h-12 ${b.color} rounded-full flex items-center justify-center mb-4`}
                  style={{ boxShadow: `0 0 20px ${b.glow}` }}
                >
                  <b.icon className={`w-6 h-6 ${b.iconColor}`} />
                </div>
                <h4 className="text-foreground font-bold text-sm mb-1">{b.label}</h4>
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider font-bold">{b.status}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        {/* Line Chart */}
        <Card className="glass-panel border-border/50 mb-8">
          <CardContent className="p-8">
            <div className="flex justify-between items-center mb-10">
              <div>
                <h2 className="text-xl font-bold text-foreground mb-1">MCQ Score Over Time</h2>
                <p className="text-muted-foreground text-sm">Aggregated performance across all subjects.</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-primary" /> Average
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-cyan-500" /> Current
                </div>
              </div>
            </div>
            <div className="h-64 w-full relative flex items-end justify-between px-4">
              <div className="absolute inset-0 flex justify-between pointer-events-none opacity-10">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="w-px h-full bg-foreground" />
                ))}
              </div>
              <svg className="absolute inset-0 w-full h-full overflow-visible" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="lineGrad" x1="0%" x2="100%" y1="0%" y2="0%">
                    <stop offset="0%" style={{ stopColor: "#7B2FFF", stopOpacity: 1 }} />
                    <stop offset="100%" style={{ stopColor: "#00D2FD", stopOpacity: 1 }} />
                  </linearGradient>
                  <filter id="glow">
                    <feGaussianBlur result="coloredBlur" stdDeviation="4" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                <path
                  d="M0,180 Q100,220 200,120 T400,140 T600,60 T800,100 T1000,40"
                  fill="none"
                  filter="url(#glow)"
                  stroke="url(#lineGrad)"
                  strokeWidth="4"
                />
                <circle cx="200" cy="120" fill="#7B2FFF" r="6" />
                <circle cx="400" cy="140" fill="#7B2FFF" r="6" />
                <circle cx="600" cy="60" fill="#00D2FD" r="6" />
                <circle cx="1000" cy="40" fill="#00D2FD" r="8" stroke="white" strokeWidth="3" />
              </svg>
            </div>
            <div className="flex justify-between mt-6 text-xs font-bold text-muted-foreground uppercase px-4">
              {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Side-by-side Charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {/* Bar Chart */}
          <Card className="glass-panel border-border/50">
            <CardContent className="p-8">
              <h3 className="text-foreground font-bold mb-6">Lectures Per Week</h3>
              <div className="flex items-end justify-between gap-2 h-48">
                {barHeights.map((h, i) => (
                  <div
                    key={i}
                    className={`flex-1 rounded-t-lg transition-colors duration-300 ${
                      i === 2 ? "bg-cyan-500 shadow-[0_0_15px_rgba(0,210,253,0.3)]" : "bg-muted hover:bg-cyan-500/50"
                    }`}
                    style={{ height: h }}
                  />
                ))}
              </div>
              <div className="flex justify-between mt-4 text-[10px] font-bold text-muted-foreground">
                {["W1", "W2", "W3", "W4", "W5", "W6", "W7"].map((w) => (
                  <span key={w}>{w}</span>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Donut Chart */}
          <Card className="glass-panel border-border/50">
            <CardContent className="p-8 flex flex-col items-center">
              <h3 className="text-foreground font-bold self-start mb-6">Score Distribution</h3>
              <div className="relative w-40 h-40">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" fill="transparent" r="40" stroke="#93000a" strokeDasharray="251.2" strokeDashoffset="200" strokeWidth="12" />
                  <circle cx="50" cy="50" fill="transparent" r="40" stroke="#ffb955" strokeDasharray="251.2" strokeDashoffset="150" strokeWidth="12" />
                  <circle cx="50" cy="50" fill="transparent" r="40" stroke="#3cd7ff" strokeDasharray="251.2" strokeDashoffset="80" strokeWidth="12" />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-2xl font-black text-foreground">84%</span>
                  <span className="text-[8px] text-muted-foreground uppercase tracking-widest font-bold">Overall</span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-8 w-full">
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Mastered</p>
                  <p className="text-cyan-400 font-bold">62%</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Improving</p>
                  <p className="text-yellow-400 font-bold">28%</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] text-muted-foreground uppercase font-bold">Critical</p>
                  <p className="text-destructive font-bold">10%</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Subject Table */}
        <Card className="glass-panel border-border/50 overflow-hidden">
          <CardHeader className="px-8 py-6 border-b border-border/50 flex flex-row items-center justify-between">
            <CardTitle className="text-base font-bold">Subject Performance Breakdown</CardTitle>
            <Button variant="ghost" size="sm" className="text-cyan-400 hover:text-cyan-300">
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="text-muted-foreground text-[10px] uppercase tracking-widest font-bold border-b border-border/50">
                  <th className="px-8 py-4">Lecture Name</th>
                  <th className="px-8 py-4">Score</th>
                  <th className="px-8 py-4">Date</th>
                  <th className="px-8 py-4">Time</th>
                  <th className="px-8 py-4" />
                </tr>
              </thead>
              <tbody className="text-sm">
                {subjects.map((s, i) => (
                  <tr key={s.name} className={`${i % 2 === 1 ? "bg-muted/30" : ""} hover:bg-muted/50 transition-colors`}>
                    <td className="px-8 py-5 text-foreground font-medium">{s.name}</td>
                    <td className="px-8 py-5">
                      <div className="flex items-center gap-2">
                        <div className="w-24 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${s.color}`} style={{ width: `${s.score}%` }} />
                        </div>
                        <span className={`font-bold ${s.textColor}`}>{s.score}%</span>
                      </div>
                    </td>
                    <td className="px-8 py-5 text-muted-foreground">{s.date}</td>
                    <td className="px-8 py-5 text-muted-foreground">{s.time}</td>
                    <td className="px-8 py-5">
                      <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-foreground">
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>

      {/* Mobile Bottom Nav */}
      <footer className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-card/95 backdrop-blur-xl border-t border-border/50">
        <Link href="/dashboard" className="flex flex-col items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <Home className="w-[22px] h-[22px]" />
          <span className="text-[10px] uppercase tracking-widest">Home</span>
        </Link>
        <Link href="/upload" className="flex flex-col items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <Upload className="w-[22px] h-[22px]" />
          <span className="text-[10px] uppercase tracking-widest">Upload</span>
        </Link>
        <div className="flex flex-col items-center gap-0.5 text-primary">
          <BarChart3 className="w-[22px] h-[22px]" />
          <span className="text-[10px] uppercase tracking-widest">Stats</span>
        </div>
        <button onClick={handleLogout} className="flex flex-col items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors">
          <LogOut className="w-[22px] h-[22px]" />
          <span className="text-[10px] uppercase tracking-widest">Logout</span>
        </button>
      </footer>
    </div>
  );
}
