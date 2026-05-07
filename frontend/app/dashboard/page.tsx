"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getDashboard, getLectures, getMySharedSessions, getNextBestAction, getDailyMission, DailyMission } from "@/lib/api";
import { isAuthenticated, logout } from "@/lib/auth";
import { prefetch } from "@/lib/prefetch-cache";
import { AppHeader } from "@/components/app-header";
import { StepNav } from "@/components/step-nav";
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
  Sparkles,
  ChevronRight,
  BarChart3,
  Flame,
  Brain,
  Zap,
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
  const [loadingLectures, setLoadingLectures] = useState(true);
  const [loadingDash, setLoadingDash] = useState(true);
  const [loadingNextAction, setLoadingNextAction] = useState(true);
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
  const [dailyMission, setDailyMission] = useState<DailyMission | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = () => {
    (prefetch.dashboard ?? getDashboard())
      .then((res) => {
        if (!res) return;
        if (res.data.user.name) setUserName(res.data.user.name);
        setStats(res.data.lecture_stats);
      })
      .catch(() => setError("Failed to load dashboard data"))
      .finally(() => setLoadingDash(false));

    (prefetch.lectures ?? getLectures())
      .then((res) => { if (res) setLectures(res.data); })
      .catch(() => setError("Failed to load lectures"))
      .finally(() => setLoadingLectures(false));

    (prefetch.sharedSessions ?? getMySharedSessions())
      .then((res) => { if (res) setSharedSessions(res.data); })
      .catch(() => {});

    (prefetch.nextAction ?? getNextBestAction())
      .then((res) => { if (res) setNextAction(res.data); })
      .catch(() => {})
      .finally(() => setLoadingNextAction(false));

    (prefetch.dailyMission ?? getDailyMission())
      .then((res) => { if (res) setDailyMission(res.data); })
      .catch(() => {});
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      <AppHeader activePage="Dashboard" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
                    { label: "Total Uploads", icon: FileText, value: loadingDash ? "—" : String(stats.total_lectures) },
                    { label: "Processed", icon: CheckCircle2, value: loadingDash ? "—" : String(stats.processed_lectures) },
                    { label: "MCQs Answered", icon: Target, value: loadingDash ? "—" : String(stats.total_mcqs_answered) },
                    { label: "Avg. Score", icon: BarChart3, value: loadingDash ? "—" : stats.total_mcqs_answered > 0 ? `${stats.avg_score}%` : "—%" },
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

            {/* Daily Mission */}
            <Card className={dailyMission?.completed ? "border-emerald-500/40" : ""}>
              <CardContent className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-primary" />
                    <p className="text-sm font-bold text-foreground">Daily Mission</p>
                  </div>
                  {dailyMission && (
                    <div className="flex items-center gap-1.5">
                      <Flame className="h-3.5 w-3.5 text-orange-500" />
                      <span className="text-sm font-bold text-foreground">{dailyMission.streak_days}d</span>
                    </div>
                  )}
                </div>

                {!dailyMission ? (
                  <div className="animate-pulse space-y-2">
                    <div className="h-2 bg-muted rounded w-3/4" />
                    <div className="h-2 bg-muted rounded w-1/2" />
                  </div>
                ) : (
                  <>
                    <div className="flex items-end justify-between mb-2">
                      <span className="text-3xl font-bold text-foreground">{dailyMission.answered_today}</span>
                      <span className="text-sm text-muted-foreground mb-1">/ {dailyMission.goal} questions</span>
                    </div>
                    <Progress
                      value={Math.min(100, (dailyMission.answered_today / dailyMission.goal) * 100)}
                      className={`h-2 mb-3 ${dailyMission.completed ? "[&>div]:bg-emerald-500" : ""}`}
                    />
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>
                        {dailyMission.completed
                          ? "Mission complete!"
                          : `${dailyMission.goal - dailyMission.answered_today} left`}
                      </span>
                      {dailyMission.answered_today > 0 && (
                        <span className={dailyMission.accuracy_today >= 70 ? "text-emerald-500" : "text-orange-500"}>
                          {dailyMission.accuracy_today}% accuracy
                        </span>
                      )}
                    </div>
                    {dailyMission.fsrs_due_count > 0 && (
                      <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 border border-primary/15">
                        <Brain className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                        <p className="text-xs text-foreground">
                          <span className="font-bold text-primary">{dailyMission.fsrs_due_count}</span> questions due for spaced review
                        </p>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

          </div>

          {/* Right column */}
          <div className="lg:col-span-8 space-y-6">
            {/* Merged Coach / Hero Card */}
            <Card>
              <CardContent className="p-6">
                {/* Header row */}
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex-1">
                    <Badge variant="outline" className="mb-3 text-xs font-medium">
                      AI Study Advisor
                    </Badge>
                    <h2 className="text-xl sm:text-2xl font-bold text-foreground mb-1">
                      What do you want to work on?
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Ask the coach anything — study plans, weak points, practice sessions, or just motivation.
                    </p>
                  </div>
                  {/* Readiness score badge */}
                  <div className="hidden sm:flex flex-col items-center gap-1 flex-shrink-0">
                    <div className="relative w-20 h-20">
                      <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="32" fill="none" stroke="hsl(var(--border))" strokeWidth="6" />
                        <circle
                          cx="40" cy="40" r="32" fill="none"
                          stroke="hsl(var(--primary))" strokeWidth="6"
                          strokeDasharray={`${2 * Math.PI * 32}`}
                          strokeDashoffset={`${2 * Math.PI * 32 * (1 - (nextAction?.predicted_readiness_24h ?? 0) / 100)}`}
                          strokeLinecap="round"
                          className="transition-all duration-700"
                        />
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-sm font-bold text-foreground">
                          {nextAction?.predicted_readiness_24h != null ? `${nextAction.predicted_readiness_24h}%` : "—"}
                        </span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">Readiness</span>
                  </div>
                </div>

                {/* Next action box */}
                <div className={`rounded-xl bg-primary/5 border border-primary/20 p-4 mb-5 transition-opacity ${loadingNextAction ? "animate-pulse opacity-60" : ""}`}>
                  <p className="text-xs font-medium text-primary mb-1 capitalize">
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

                {/* Readiness bar (mobile only) */}
                <div className="sm:hidden mb-5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-muted-foreground">Readiness Score</span>
                    <span className="text-xs font-bold text-foreground">
                      {nextAction?.predicted_readiness_24h != null ? `${nextAction.predicted_readiness_24h}%` : "—%"}
                    </span>
                  </div>
                  <Progress value={nextAction?.predicted_readiness_24h ?? 0} className="h-2" />
                </div>

                {/* Suggestion chips — prefetch=false: these link to coach with query params,
                    prefetching them would fire redundant RSC requests */}
                <div className="flex flex-wrap gap-2 mb-5">
                  {[
                    { label: "Plan my study session", icon: "calendar_today" },
                    { label: "What are my weak points?", icon: "radio_button_checked" },
                    { label: "Quiz me on my worst topic", icon: "quiz" },
                    { label: "Review a topic", icon: "menu_book" },
                    { label: "Motivate me", icon: "bolt" },
                  ].map(({ label, icon }) => (
                    <Link
                      key={label}
                      href={`/coach?q=${encodeURIComponent(label)}`}
                      prefetch={false}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors bg-muted/50 border border-border text-muted-foreground hover:text-foreground hover:border-primary/40"
                    >
                      <span className="material-symbols-outlined text-[13px]">{icon}</span>
                      {label}
                    </Link>
                  ))}
                </div>

                {/* CTAs */}
                <div className="flex items-center gap-3">
                  <Button asChild>
                    <Link href="/coach" prefetch={false}>
                      <Bot className="w-4 h-4 mr-2" />
                      Open Coach
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href="/upload" prefetch={false}>+ Upload Lecture</Link>
                  </Button>
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
                        <Link key={s.share_token} href={`/shared/${s.share_token}`} prefetch={false}>
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
                  <Link href="/upload" prefetch={false}>+ New</Link>
                </Button>
              </CardHeader>
              <CardContent className="p-6">
                {loadingLectures ? (
                  <div className="flex items-center justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                  </div>
                ) : lectures.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <BookOpen className="h-10 w-10 text-muted-foreground mb-4" />
                    <p className="font-semibold text-foreground mb-2">No lectures yet</p>
                    <p className="text-sm text-muted-foreground mb-5">
                      Upload your first PDF and themcq will generate questions within seconds.
                    </p>
                    <Button variant="outline" asChild>
                      <Link href="/upload" prefetch={false}>+ Upload New Lecture</Link>
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
                              prefetch={false}
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
                      <Link href="/lectures" prefetch={false}>
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

    </div>
  );
}
