"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import {
  getAnalyticsOverview,
  getAnalyticsTimeline,
  getAnalyticsWeakTopics,
  getAnalyticsConfidence,
  getAnalyticsCoFailures,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  TrendingUp,
  Target,
  BarChart3,
  Home,
  Upload,
  Bot,
} from "lucide-react";

interface Overview {
  total_sessions: number;
  total_questions_answered: number;
  overall_accuracy: number; // 0–100
  current_streak: number;
}

interface TimelineDay {
  date: string;
  accuracy: number; // 0–100
  questions_answered: number;
}

interface WeakTopic {
  topic: string;
  accuracy: number; // 0–1 decimal
  attempts: number;
}

interface ConfidenceData {
  confidence_level: string;
  accuracy: number; // 0–100
  count: number;
}

interface CoFailure {
  topic_a: string;
  topic_b: string;
  co_fail_count: number;
}

export default function AnalyticsPage() {
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [timeline, setTimeline] = useState<TimelineDay[]>([]);
  const [weakTopics, setWeakTopics] = useState<WeakTopic[]>([]);
  const [confidence, setConfidence] = useState<ConfidenceData[]>([]);
  const [coFailures, setCoFailures] = useState<CoFailure[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    Promise.all([
      getAnalyticsOverview(),
      getAnalyticsTimeline(days),
      getAnalyticsWeakTopics(10),
      getAnalyticsConfidence(),
      getAnalyticsCoFailures(),
    ])
      .then(([ov, tl, wt, cf, cofail]) => {
        const o = ov.data;
        setOverview({
          total_sessions: o.sessions_this_week ?? 0,
          total_questions_answered: o.total_attempted ?? 0,
          overall_accuracy: o.overall_accuracy ?? 0,
          current_streak: o.current_streak ?? 0,
        });
        const tlArr = Array.isArray(tl.data) ? tl.data : (tl.data?.data ?? []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTimeline(tlArr.map((d: any) => ({ date: d.date, accuracy: d.accuracy_percent ?? d.accuracy ?? 0, questions_answered: d.total ?? 0 })));
        const wtArr: WeakTopic[] = (wt.data?.topics ?? []).map((t: any) => ({
          topic: t.subtopic ?? t.topic ?? "",
          accuracy: t.accuracy_rate ?? 0,
          attempts: t.total_attempts ?? 0,
        }));
        setWeakTopics(wtArr);
        const cfArr = Array.isArray(cf.data) ? cf.data : (cf.data?.data ?? []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setConfidence(cfArr.map((c: any) => ({ confidence_level: String(c.confidence_level), accuracy: c.accuracy_percent ?? c.accuracy ?? 0, count: c.attempts ?? c.count ?? 0 })));
        setCoFailures(cofail.data?.topic_pairs ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [router]);

  useEffect(() => {
    if (!isAuthenticated()) return;
    getAnalyticsTimeline(days)
      .then((res) => {
        const arr = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTimeline(arr.map((d: any) => ({ date: d.date, accuracy: d.accuracy_percent ?? d.accuracy ?? 0, questions_answered: d.total ?? 0 })));
      })
      .catch(() => {});
  }, [days]);

  const safeTimeline = Array.isArray(timeline) ? timeline : [];
  const maxAccuracy = Math.max(...safeTimeline.map((d) => d.accuracy || 0), 1);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 md:pb-0">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="max-w-7xl mx-auto flex h-14 items-center justify-between px-4 sm:px-6">
          <Link href="/dashboard" className="text-xl font-bold text-foreground">
            cortexQ
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">Dashboard</Link>
            <Link href="/upload" className="text-muted-foreground hover:text-foreground transition-colors">Upload</Link>
            <Link href="/coach" className="text-muted-foreground hover:text-foreground transition-colors">Coach</Link>
            <span className="text-foreground">Analytics</span>
          </nav>
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors font-medium"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Breadcrumb */}
        <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6">
          <Link href="/dashboard" className="hover:text-foreground transition-colors">Dashboard</Link>
          <span>/</span>
          <span className="text-foreground">Analytics</span>
        </nav>

        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">Your performance across all study sessions</p>
          </div>
          <div className="flex items-center gap-2">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  days === d
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Overview stats */}
        {overview && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {[
              { label: "Total Sessions", value: overview.total_sessions, icon: BarChart3 },
              { label: "Questions Answered", value: overview.total_questions_answered, icon: Target },
              { label: "Overall Accuracy", value: `${Math.round(overview.overall_accuracy)}%`, icon: TrendingUp },
              { label: "Current Streak", value: `${overview.current_streak}d`, icon: TrendingUp },
            ].map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">{label}</p>
                  </div>
                  <p className="text-xl font-bold text-foreground">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column */}
          <div className="lg:col-span-4 space-y-6">
            {/* Confidence calibration */}
            {confidence.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Confidence vs Accuracy</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {confidence.map((c) => (
                    <div key={c.confidence_level}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground capitalize">Level {c.confidence_level}</span>
                        <span className="font-medium text-foreground tabular-nums">
                          {Math.round(c.accuracy)}% ({c.count})
                        </span>
                      </div>
                      <Progress value={c.accuracy} className="h-1.5" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Co-failures */}
            {coFailures.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Co-Failing Topics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {coFailures.slice(0, 5).map((cf, i) => (
                    <div key={i} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-center gap-2 text-xs flex-wrap">
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{cf.topic_a}</Badge>
                        <span className="text-muted-foreground">+</span>
                        <Badge variant="destructive" className="text-[10px] px-1.5 py-0">{cf.topic_b}</Badge>
                      </div>
                      <p className="text-[11px] text-muted-foreground">Failed together {cf.co_fail_count}×</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right column */}
          <div className="lg:col-span-8 space-y-6">
            {/* Accuracy timeline */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Accuracy Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {safeTimeline.length === 0 || safeTimeline.every((d) => d.accuracy === 0) ? (
                  <p className="text-sm text-muted-foreground text-center py-8">No data for this period.</p>
                ) : (
                  <>
                    <div className="flex items-end gap-1.5 h-40">
                      {safeTimeline.map((d) => {
                        const pct = maxAccuracy > 0 ? (d.accuracy / maxAccuracy) * 100 : 0;
                        return (
                          <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative">
                            <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-popover border text-xs px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none">
                              {Math.round(d.accuracy)}%
                            </div>
                            <div
                              className={`w-full rounded-t transition-colors ${d.accuracy > 0 ? "bg-primary/70 hover:bg-primary" : "bg-muted/30"}`}
                              style={{ height: `${d.accuracy > 0 ? Math.max(pct, 8) : 2}%` }}
                            />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex justify-between mt-2 text-[10px] text-muted-foreground">
                      {safeTimeline.map((d) => (
                        <span key={d.date} className="flex-1 text-center truncate">
                          {new Date(d.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Weak topics */}
            {weakTopics.length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Weak Topics</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {weakTopics.map((t) => (
                    <div key={t.topic}>
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-foreground font-medium line-clamp-1 flex-1 mr-4">{t.topic}</span>
                        <span className="tabular-nums text-muted-foreground shrink-0">
                          {Math.round(t.accuracy * 100)}% · {t.attempts} attempts
                        </span>
                      </div>
                      <Progress
                        value={t.accuracy * 100}
                        className={`h-1.5 ${t.accuracy < 0.5 ? "[&>div]:bg-destructive" : t.accuracy < 0.7 ? "[&>div]:bg-yellow-500" : ""}`}
                      />
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Empty state */}
            {!overview && weakTopics.length === 0 && timeline.length === 0 && (
              <Card>
                <CardContent className="py-16 text-center">
                  <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-medium text-foreground">No analytics yet</p>
                  <p className="text-xs text-muted-foreground mt-1">Complete some quizzes to see your performance data.</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex justify-around items-center py-2 px-4">
          <Link href="/dashboard" className="flex flex-col items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors py-1">
            <Home className="w-5 h-5" />
            <span className="text-[10px]">Home</span>
          </Link>
          <Link href="/upload" className="flex flex-col items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors py-1">
            <Upload className="w-5 h-5" />
            <span className="text-[10px]">Upload</span>
          </Link>
          <Link href="/coach" className="flex flex-col items-center gap-0.5 text-muted-foreground hover:text-foreground transition-colors py-1">
            <Bot className="w-5 h-5" />
            <span className="text-[10px]">Coach</span>
          </Link>
          <div className="flex flex-col items-center gap-0.5 text-foreground py-1">
            <BarChart3 className="w-5 h-5" />
            <span className="text-[10px]">Analytics</span>
          </div>
        </div>
      </nav>
    </div>
  );
}
