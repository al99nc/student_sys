"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getLectures, getStats, getMySharedSessions, getNextBestAction, getMe } from "@/lib/api";
import { isAuthenticated, logout } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload,
  BookOpen,
  TrendingUp,
  Target,
  Bot,
  ArrowRight,
  FileText,
  CheckCircle2,
  Clock,
  ExternalLink,
  Sparkles,
  ChevronRight,
  BarChart3,
} from "lucide-react";

interface Lecture {
  id: number;
  title: string;
  file_path: string;
  created_at: string;
  is_processed: boolean;
  has_essays: boolean;
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

type Filter = "all" | "processed" | "unprocessed";


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

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = async () => {
    try {
      const [lecturesRes, statsRes, sharedRes, nextActionRes, meRes] = await Promise.all([
        getLectures(),
        getStats(),
        getMySharedSessions(),
        getNextBestAction(),
        getMe(),
      ]);
      setLectures(lecturesRes.data);
      setStats(statsRes.data);
      setSharedSessions(sharedRes.data);
      setNextAction(nextActionRes.data);
      if (meRes.data.name) setUserName(meRes.data.name);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      if (axiosErr?.response?.status !== 404) {
        setError("Failed to load dashboard data");
      }
    } finally {
      setLoading(false);
    }
  };

  const userInitial = userName.charAt(0).toUpperCase();

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      {/* Header — identical structure to results page */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="text-xl font-bold text-foreground">
            cortexQ
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {[
              { label: "Dashboard", href: "/dashboard", active: true },
              { label: "Lectures", href: "/lectures" },
              { label: "Analytics", href: "/analytics" },
              { label: "Coach", href: "/coach" },
              { label: "Credits", href: "/billing" },
            ].map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  item.active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/upload">
                <Upload className="h-4 w-4 mr-1.5" />
                Upload
              </Link>
            </Button>
            <Link href="/account" className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white font-bold text-sm hover:opacity-80 transition-opacity">
              {userInitial}
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <span className="text-foreground font-medium">Dashboard</span>
        </nav>

        {/* Title */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-3">
              Hey {userName}
            </h1>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">
                <FileText className="h-3 w-3 mr-1" />
                {stats.total_lectures} lectures
              </Badge>
              <Badge variant="outline">
                <Target className="h-3 w-3 mr-1" />
                {stats.total_mcqs_answered} answered
              </Badge>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column */}
          <div className="lg:col-span-4 space-y-6">
            {/* Stats */}
            <Card>
              <CardContent className="p-6">
                <p className="text-sm font-medium text-muted-foreground mb-4">Overview</p>
                <div className="space-y-4">
                  {[
                    { label: "Total Uploads", icon: FileText, value: loading ? "—" : String(stats.total_lectures) },
                    { label: "Processed", icon: CheckCircle2, value: loading ? "—" : String(stats.processed_lectures) },
                    { label: "MCQs Answered", icon: Target, value: loading ? "—" : String(stats.total_mcqs_answered) },
                    { label: "Avg. Score", icon: BarChart3, value: loading ? "—" : stats.total_mcqs_answered > 0 ? `${stats.avg_score}%` : "—%" },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <s.icon className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">{s.label}</span>
                      </div>
                      <span className="text-sm font-semibold text-foreground">{s.value}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Coach Card */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-9 h-9 rounded-xl bg-primary flex items-center justify-center">
                    <Bot className="w-[18px] h-[18px] text-primary-foreground" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">AI Coach</p>
                    <p className="text-xs text-muted-foreground">Powered by Gemini</p>
                  </div>
                  <Button size="sm" variant="outline" asChild className="ml-auto">
                    <Link href="/coach">
                      <ExternalLink className="w-3 h-3 mr-1.5" />
                      Open
                    </Link>
                  </Button>
                </div>

                {/* Next action */}
                <div className="rounded-xl bg-primary/5 border border-primary/20 p-4 mb-4">
                  <p className="text-xs font-medium text-primary mb-1">
                    {nextAction?.action_type?.replace(/_/g, " ") || "Exploration Mode"}
                  </p>
                  <p className="text-sm font-medium text-foreground">
                    {isValid(nextAction?.next_step)
                      ? nextAction?.next_step
                      : "Start with a new high-yield topic and do 5 focused questions."}
                  </p>
                  {isValid(nextAction?.topic) && (
                    <Badge variant="secondary" className="mt-2 text-xs">
                      {nextAction?.topic}
                    </Badge>
                  )}
                </div>

                {/* Readiness */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground">Readiness Score</span>
                    <span className="text-sm font-bold text-foreground">
                      {nextAction?.predicted_readiness_24h != null ? `${nextAction.predicted_readiness_24h}%` : "—%"}
                    </span>
                  </div>
                  <Progress value={nextAction?.predicted_readiness_24h ?? 0} className="h-2" />
                </div>

                {/* Quick chips */}
                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Plan session", q: "Plan my next study session based on my weak points" },
                    { label: "Weak points", q: "Explain my weakest topics and how to fix them" },
                    { label: "What's next?", q: "What should I study next?" },
                  ].map(({ label, q }) => (
                    <Link
                      key={label}
                      href={`/coach?q=${encodeURIComponent(q)}`}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors bg-muted/50 border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                    >
                      <ArrowRight className="w-3 h-3" />
                      {label}
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right column */}
          <div className="lg:col-span-8 space-y-6">
            {/* Hero / Sage suggestion chips */}
            <Card>
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <Badge variant="outline" className="mb-3 text-xs font-medium">
                      AI Study Advisor
                    </Badge>
                    <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-2">
                      What do you want to work on?
                    </h2>
                    <p className="text-sm text-muted-foreground mb-5">
                      Ask the coach anything — study plans, weak points, practice sessions, or just motivation.
                    </p>
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
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors bg-muted/50 border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                        >
                          <span className="material-symbols-outlined text-[13px]">{icon}</span>
                          {label}
                        </Link>
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <Button asChild>
                        <Link href="/coach">
                          <Bot className="w-4 h-4 mr-2" />
                          Open Coach
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link href="/upload">+ Upload Lecture</Link>
                      </Button>
                    </div>
                  </div>
                  <div className="relative hidden sm:flex flex-shrink-0 w-32 h-32 items-center justify-center">
                    <svg className="absolute inset-0 w-full h-full" viewBox="0 0 200 200">
                      <circle cx="100" cy="100" r="90" fill="none" stroke="hsl(var(--border))" strokeWidth="1" />
                      <circle cx="100" cy="100" r="66" fill="none" stroke="hsl(var(--border))" strokeWidth="1" strokeDasharray="4 4" />
                    </svg>
                    <div className="relative z-10 w-14 h-14 rounded-full bg-primary flex items-center justify-center">
                      <Sparkles className="w-6 h-6 text-primary-foreground" />
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Shared Sessions */}
            {sharedSessions.length > 0 && (
              <Card>
                <CardHeader className="pb-4 border-b">
                  <div className="flex items-center gap-3">
                    <CardTitle className="text-base font-bold">Shared With You</CardTitle>
                    <Badge variant="secondary">{sharedSessions.length}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {sharedSessions.map((s) => {
                      const pct = s.total > 0 ? Math.round((s.answered / s.total) * 100) : 0;
                      const score = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
                      return (
                        <Link key={s.share_token} href={`/shared/${s.share_token}`}>
                          <div className="rounded-xl border p-4 hover:-translate-y-0.5 transition-transform">
                            <Badge variant="outline" className="mb-2 text-xs">Shared</Badge>
                            <h4 className="text-sm font-semibold text-foreground mb-3 line-clamp-2">{s.lecture_title}</h4>
                            <div className="flex justify-between text-xs mb-1.5 text-muted-foreground">
                              <span>{s.answered}/{s.total} answered</span>
                              {s.answered > 0 && (
                                <span className={score >= 70 ? "text-emerald-500" : score >= 50 ? "text-yellow-500" : "text-destructive"}>
                                  {score}%
                                </span>
                              )}
                            </div>
                            <Progress value={pct} className="h-1.5" />
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Lectures */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                <CardTitle className="text-base font-bold">Your Lectures</CardTitle>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/upload">+ New</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-6">
                {loading ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : lectures.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <BookOpen className="h-10 w-10 text-muted-foreground mb-4" />
                    <p className="font-semibold text-foreground mb-2">No lectures yet</p>
                    <p className="text-sm text-muted-foreground mb-5">
                      Upload your first PDF and CortexQ will generate questions within seconds.
                    </p>
                    <Button variant="outline" asChild>
                      <Link href="/upload">+ Upload New Lecture</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
                      {(["all", "processed", "unprocessed"] as Filter[]).map((f) => (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors flex-shrink-0 ${
                            filter === f
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted/50 text-muted-foreground border border-border hover:text-foreground"
                          }`}
                        >
                          {f === "all" ? "All" : f === "processed" ? "Processed" : "Unprocessed"}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-2 mb-4">
                      {lectures
                        .filter((l) =>
                          filter === "all" ? true :
                          filter === "processed" ? l.is_processed :
                          !l.is_processed
                        )
                        .slice(0, 5)
                        .map((lecture) => {
                          const href = lecture.is_processed ? `/results/${lecture.id}` : `/upload`;
                          return (
                            <Link
                              key={lecture.id}
                              href={href}
                              className="flex items-center justify-between px-4 py-3 rounded-xl border hover:border-primary/40 hover:bg-muted/20 transition-all duration-150"
                            >
                              <div className="min-w-0 flex-1 mr-3">
                                <p className="text-sm font-semibold text-foreground truncate">{lecture.title}</p>
                                <p className="text-xs mt-0.5 text-muted-foreground">
                                  {new Date(lecture.created_at).toLocaleDateString()}
                                </p>
                              </div>
                              <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            </Link>
                          );
                        })}
                    </div>
                    <Button variant="outline" className="w-full" asChild>
                      <Link href="/lectures">
                        <BookOpen className="w-4 h-4 mr-2" />
                        View All MCQs
                      </Link>
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around px-2 py-2 bg-background/95 backdrop-blur border-t border-border" style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}>
        <Link href="/dashboard" className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-primary">
          <BarChart3 className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Home</span>
        </Link>
        <Link href="/upload" className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-muted-foreground">
          <Upload className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Upload</span>
        </Link>
        <Link href="/coach" className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-muted-foreground">
          <Bot className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Coach</span>
        </Link>
        <Link href="/analytics" className="flex flex-col items-center gap-0.5 px-3 py-1.5 text-muted-foreground">
          <TrendingUp className="w-[22px] h-[22px]" />
          <span className="text-[10px] font-semibold">Analytics</span>
        </Link>
      </nav>
    </div>
  );
}
