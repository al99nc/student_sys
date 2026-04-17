"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getLectures, getStats, getMySharedSessions, getNextBestAction } from "@/lib/api";
import { isAuthenticated, logout, getToken } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  LayoutGrid,
  Upload,
  BookOpen,
  TrendingUp,
  Target,
  Bell,
  Bot,
  ArrowRight,
  FileText,
  CheckCircle2,
  Clock,
  ExternalLink,
  Sparkles,
  ChevronRight,
  BarChart3,
  CircleDot,
  Coins,
} from "lucide-react";

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
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

function isValid(value: unknown): boolean {
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
  const [nextAction, setNextAction] = useState<{
    action_type?: string;
    topic?: string | null;
    next_step?: string | null;
    short_message?: string | null;
    predicted_readiness_24h?: number | null;
    reason?: string[];
  } | null>(null);
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
        getLectures(),
        getStats(),
        getMySharedSessions(),
        getNextBestAction()
      ]);
      setLectures(lecturesRes.data);
      setStats(statsRes.data);
      setSharedSessions(sharedRes.data);
      setNextAction(nextActionRes.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr?.response?.status === 404) {
        // No coach action yet
      } else {
        setError("Failed to load dashboard data");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => logout();
  const displayedLectures = lectures;
  const userInitial = userName.charAt(0).toUpperCase();

  const NAV_ITEMS = [
    { icon: LayoutGrid, label: "Dashboard", href: "/dashboard", active: true },
    { icon: BookOpen, label: "Lectures", href: "/lectures" },
    { icon: Clock, label: "Practice", href: "/practice" },
    { icon: TrendingUp, label: "Analytics", href: "/analytics" },
    { icon: Coins, label: "Credits", href: "/billing" },
    { icon: CircleDot, label: "Weak Points", href: "/weak-points" },
  ];

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex w-[240px] flex-shrink-0 flex-col border-r border-border/50 bg-card/50">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-6">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-sm synapse-gradient">
            cQ
          </div>
          <div>
            <p className="text-foreground font-bold text-sm">CortexQ</p>
            <p className="text-[10px] font-medium text-muted-foreground">BETA v0.9</p>
          </div>
        </div>

        <div className="mx-5 mb-5 h-px bg-border/50" />

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          <p className="text-[10px] font-bold uppercase tracking-widest px-3 mb-2 text-muted-foreground/60">Main</p>

          {NAV_ITEMS.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                item.active
                  ? "bg-muted text-foreground border-l-2 border-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              }`}
            >
              <item.icon className={`w-[18px] h-[18px] ${item.active ? "text-primary" : ""}`} />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* User Profile */}
        <div className="px-4 py-4 border-t border-border/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0 synapse-gradient">
              {userInitial}
            </div>
            <div className="min-w-0">
              <p className="text-foreground text-sm font-semibold truncate">{userName}</p>
              <p className="text-xs truncate text-muted-foreground">med student</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="flex items-center justify-between px-4 sm:px-8 py-4 sm:py-5 flex-shrink-0 border-b border-border/50">
          <div className="flex items-center gap-3">
            {/* Logo - mobile only */}
            <div className="flex lg:hidden w-8 h-8 rounded-xl items-center justify-center font-black text-white text-xs flex-shrink-0 synapse-gradient">
              cQ
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground">Dashboard</h1>
              <p className="text-xs sm:text-sm mt-0.5 hidden sm:block text-muted-foreground">
                {today} — {loading ? "..." : "00"} active sessions
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="outline" size="icon" className="w-9 h-9 rounded-xl">
              <Bell className="w-[18px] h-[18px]" />
            </Button>
            <Button variant="outline" asChild className="rounded-xl">
              <Link href="/upload">
                <span className="hidden sm:inline">Upload PDF</span>
                <span className="sm:hidden">Upload</span>
              </Link>
            </Button>
          </div>
        </header>

        {/* Scrollable Content */}
        <main className="flex-1 overflow-y-auto px-4 sm:px-8 py-4 sm:py-6 pb-24 lg:pb-6">
          {/* Hero - Sage/Coach Section */}
          <Card className="glass-panel border-border/50 mb-6 overflow-hidden">
            <CardContent className="p-5 sm:p-8">
              <div className="flex items-center justify-between">
                <div className="max-w-md">
                  <Badge className="mb-3 bg-primary/10 text-primary border-primary/20 text-[10px] font-bold uppercase tracking-wider">
                    Your AI Learning Coach
                  </Badge>
                  <h2 className="text-2xl sm:text-3xl font-black text-foreground leading-tight mb-3">
                    Hey {userName},{" "}
                    <span className="bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">
                      what do you want to work on?
                    </span>
                  </h2>
                  <p className="text-xs sm:text-sm mb-5 text-muted-foreground">
                    Ask Sage anything — study plans, weak points, practice sessions, or just motivation.
                  </p>

                  {/* Suggestion Chips */}
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
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all bg-muted/50 border border-border/50 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                      >
                        <span className="material-symbols-outlined text-[13px]">{icon}</span>
                        {label}
                      </Link>
                    ))}
                  </div>

                  <div className="flex items-center gap-3 sm:gap-5">
                    <Button asChild className="synapse-gradient text-white rounded-xl">
                      <Link href="/coach">
                        <Bot className="w-4 h-4 mr-2" />
                        Open Sage
                      </Link>
                    </Button>
                    <Button variant="outline" asChild className="rounded-xl">
                      <Link href="/upload">+ Upload Lecture</Link>
                    </Button>
                  </div>
                </div>

                {/* Orb Graphic - hidden on small */}
                <div className="relative hidden sm:flex flex-shrink-0 w-48 h-48 items-center justify-center">
                  <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                    <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(0,210,253,0.1)" strokeWidth="1" />
                    <circle cx="100" cy="100" r="72" fill="none" stroke="rgba(0,210,253,0.15)" strokeWidth="1" strokeDasharray="4 4" />
                    <circle cx="100" cy="100" r="54" fill="none" stroke="rgba(123,47,255,0.2)" strokeWidth="1" strokeDasharray="6 3" />
                    <circle cx="100" cy="100" r="36" fill="none" stroke="rgba(0,210,253,0.25)" strokeWidth="1.5" />
                  </svg>
                  <div
                    className="relative z-10 w-20 h-20 rounded-full flex items-center justify-center"
                    style={{
                      background: "radial-gradient(circle at 35% 35%, #e879f9, #a855f7, #7B2FFF)",
                      boxShadow: "0 0 40px rgba(168,85,247,0.5)",
                    }}
                  >
                    <Sparkles className="w-8 h-8 text-white/90" />
                  </div>
                  <Badge className="absolute bottom-6 right-0 bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[9px] font-black uppercase tracking-wider">
                    AI-POWERED
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
            {[
              { label: "TOTAL UPLOADS", icon: FileText, value: loading ? "—" : String(stats.total_lectures), sub: stats.total_lectures === 0 ? "awaiting upload" : `${stats.processed_lectures} processed` },
              { label: "PROCESSED", icon: CheckCircle2, value: loading ? "—" : String(stats.processed_lectures), sub: stats.processed_lectures === 0 ? "ready for MCQs" : "lectures ready" },
              { label: "MCQs ANSWERED", icon: Target, value: loading ? "—" : String(stats.total_mcqs_answered), sub: stats.total_mcqs_answered === 0 ? "start practicing" : "total answered" },
              { label: "AVG. SCORE", icon: BarChart3, value: loading ? "—" : stats.total_mcqs_answered > 0 ? `${stats.avg_score}%` : "—%", sub: stats.total_mcqs_answered > 0 ? (stats.avg_score >= 80 ? "great work" : "keep going") : "no data yet" },
            ].map((s) => (
              <Card key={s.label} className="glass-panel border-border/50">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{s.label}</p>
                    <s.icon className="w-5 h-5 text-muted-foreground/50" />
                  </div>
                  <p className="text-3xl font-black text-foreground mb-3">{s.value}</p>
                  <Badge variant="secondary" className="text-[11px] bg-muted/50 text-muted-foreground">
                    {s.sub}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Shared Sessions */}
          {sharedSessions.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-lg font-bold text-foreground">Shared With You</h3>
                <Badge className="bg-cyan-500/10 text-cyan-400 border-cyan-500/20">{sharedSessions.length}</Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sharedSessions.map((s) => {
                  const pct = s.total > 0 ? Math.round((s.answered / s.total) * 100) : 0;
                  const score = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
                  return (
                    <Link key={s.share_token} href={`/shared/${s.share_token}`}>
                      <Card className="glass-panel border-cyan-500/20 hover:-translate-y-1 transition-transform">
                        <div className="h-1 synapse-gradient" />
                        <CardContent className="p-5">
                          <Badge className="mb-3 bg-cyan-500/10 text-cyan-400 border-cyan-500/20 text-[9px] font-black uppercase">
                            SHARED
                          </Badge>
                          <h4 className="text-sm font-bold text-foreground mb-3 line-clamp-2">{s.lecture_title}</h4>
                          <div className="flex justify-between text-xs mb-1.5 text-muted-foreground">
                            <span>{s.answered}/{s.total} answered</span>
                            {s.answered > 0 && (
                              <span className={score >= 70 ? "text-emerald-400" : score >= 50 ? "text-yellow-400" : "text-destructive"}>
                                {score}%
                              </span>
                            )}
                          </div>
                          <Progress value={pct} className="h-1.5" />
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Bottom Grid: Lectures + Coach */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Your Lectures */}
            <Card className="glass-panel border-border/50">
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50">
                <CardTitle className="text-base font-bold">Your Lectures</CardTitle>
                <Button variant="outline" size="sm" asChild className="rounded-xl text-xs">
                  <Link href="/upload">+ New</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-6">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : displayedLectures.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <div className="relative w-16 h-16 mb-5">
                      {[2, 1, 0].map((i) => (
                        <div
                          key={i}
                          className="absolute rounded-xl border border-border/50"
                          style={{
                            width: 40,
                            height: 48,
                            left: 8 + i * 5,
                            top: i * 5,
                            background: i === 0 ? "var(--card)" : "var(--muted)",
                            zIndex: 3 - i,
                          }}
                        />
                      ))}
                    </div>
                    <p className="font-bold text-foreground mb-2">No lectures yet</p>
                    <p className="text-xs mb-5 text-muted-foreground">
                      Upload your first PDF and CortexQ will generate questions within seconds
                    </p>
                    <Button variant="outline" asChild className="rounded-xl">
                      <Link href="/upload">+ Upload New Lecture</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {/* Filter Pills */}
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                      {(["all", "processed", "processing", "unprocessed"] as Filter[]).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                            filter === f
                              ? "synapse-gradient text-white"
                              : "bg-muted/50 text-muted-foreground border border-border/50 hover:text-foreground"
                          }`}
                        >
                          {f === "all" ? "All" : f === "processed" ? "Processed" : f === "processing" ? "In Progress" : "Unprocessed"}
                        </button>
                      ))}
                    </div>
                    {displayedLectures.slice(0, 5).map((lecture) => (
                      <div
                        key={lecture.id}
                        className="flex items-center justify-between px-4 py-3 rounded-xl bg-muted/30 border border-border/30"
                      >
                        <div className="min-w-0 flex-1 mr-3">
                          <p className="text-sm font-semibold text-foreground truncate">{lecture.title}</p>
                          <p className="text-xs mt-0.5 text-muted-foreground">
                            {new Date(lecture.created_at).toLocaleDateString()}
                          </p>
                        </div>
                        <Button size="sm" asChild className="synapse-gradient text-white rounded-lg text-xs">
                          <Link href={`/results/${lecture.id}`}>View</Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* CortexQ Coach */}
            <Card className="glass-panel border-border/50">
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center synapse-gradient">
                    <Bot className="w-[18px] h-[18px] text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-bold">CortexQ Coach</CardTitle>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">AI Advisor</p>
                  </div>
                </div>
                <Button size="sm" asChild className="synapse-gradient text-white rounded-xl text-xs">
                  <Link href="/coach">
                    <ExternalLink className="w-3 h-3 mr-1.5" />
                    Open Sage
                  </Link>
                </Button>
              </CardHeader>
              <CardContent className="p-6 flex flex-col gap-4">
                {/* Action Card */}
                <div className="rounded-xl p-4 bg-muted/30 border-l-[3px] border-cyan-500">
                  {nextAction ? (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                          {nextAction.action_type?.replace(/_/g, " ") || "Exploration Mode"}
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground mb-1">
                        {isValid(nextAction?.next_step)
                          ? nextAction.next_step
                          : "Start with a new high-yield topic and do 5 focused questions."}
                      </p>
                      {isValid(nextAction?.topic) && (
                        <p className="text-xs text-muted-foreground">Topic: {nextAction.topic}</p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-500" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-cyan-400">
                          Exploration Mode
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-foreground mb-1">
                        Start with a new high-yield topic and do 5 focused questions.
                      </p>
                      <p className="text-xs text-muted-foreground">No weak points yet</p>
                    </>
                  )}
                </div>

                {/* Readiness Score */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Readiness Score
                    </span>
                    <span className="text-sm font-bold text-muted-foreground">
                      {nextAction?.predicted_readiness_24h != null ? `${nextAction.predicted_readiness_24h}%` : "—%"}
                    </span>
                  </div>
                  <Progress value={nextAction?.predicted_readiness_24h ?? 0} className="h-1.5" />
                </div>

                {/* Info Block */}
                <div className="rounded-xl p-3 flex items-start gap-2.5 bg-emerald-500/5 border border-emerald-500/10">
                  <TrendingUp className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    {lectures.length === 0
                      ? "Upload your first lecture to unlock AI-powered weak point tracking and daily study plans."
                      : isValid(nextAction?.short_message)
                      ? nextAction?.short_message
                      : "Keep practicing to improve your readiness score."}
                  </p>
                </div>

                {/* Quick Ask Chips */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Plan my next session", q: "Plan my next study session based on my weak points" },
                    { label: "Explain my weak points", q: "Explain my weakest topics and how to fix them" },
                    { label: "What should I do next?", q: "What should I study next?" },
                  ].map(({ label, q }) => (
                    <Link
                      key={label}
                      href={`/coach?q=${encodeURIComponent(q)}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium transition-all bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20"
                    >
                      <ArrowRight className="w-3 h-3" />
                      {label}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {error && (
            <div className="mt-4 rounded-xl px-4 py-3 text-sm bg-destructive/10 border border-destructive/20 text-destructive">
              {error}
            </div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-2 bg-card border-t border-border/50" style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}>
        <Link href="/dashboard" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-primary">
          <LayoutGrid className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Home</span>
        </Link>
        <Link href="/upload" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-muted-foreground">
          <Upload className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Upload</span>
        </Link>
        <Link href="/coach" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-muted-foreground">
          <Bot className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Coach</span>
        </Link>
        <Link href="/analytics" className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-muted-foreground">
          <TrendingUp className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Analytics</span>
        </Link>
      </nav>
    </div>
  );
}
