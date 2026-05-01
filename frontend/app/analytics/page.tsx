"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getDashboard, getAnalyticsTimeline } from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Target, TrendingUp, Flame, AlertTriangle } from "lucide-react";

interface Overview {
  total_sessions: number;
  total_questions_answered: number;
  overall_accuracy: number;
  current_streak: number;
}

interface TimelineDay {
  date: string;
  accuracy: number;
  questions_answered: number;
}

interface WeakTopic {
  topic: string;
  accuracy: number;
  attempts: number;
}

interface ConfidenceData {
  confidence_level: string;
  accuracy: number;
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
  const isInitialLoad = useRef(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    getDashboard(days)
      .then(({ data }) => {
        const o = data.overview;
        setOverview({
          total_sessions: o.sessions_this_week ?? 0,
          total_questions_answered: o.total_attempted ?? 0,
          overall_accuracy: o.overall_accuracy ?? 0,
          current_streak: o.current_streak ?? 0,
        });
        setTimeline(
          (data.accuracy_timeline.data ?? []).map((d) => ({
            date: d.date,
            accuracy: d.accuracy_percent ?? 0,
            questions_answered: d.total ?? 0,
          }))
        );
        setWeakTopics(
          (data.weak_topics.topics ?? []).map((t) => ({
            topic: t.subtopic ?? "",
            accuracy: t.accuracy_rate ?? 0,
            attempts: t.total_attempts ?? 0,
          }))
        );
        setConfidence(
          (data.confidence_calibration.data ?? []).map((c) => ({
            confidence_level: String(c.confidence_level),
            accuracy: c.accuracy_percent ?? 0,
            count: c.attempts ?? 0,
          }))
        );
        setCoFailures(data.co_failures.topic_pairs ?? []);
      })
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        isInitialLoad.current = false;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  useEffect(() => {
    if (isInitialLoad.current) return;
    if (!isAuthenticated()) return;
    getAnalyticsTimeline(days)
      .then((res) => {
        const arr = Array.isArray(res.data) ? res.data : (res.data?.data ?? []);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setTimeline(arr.map((d: any) => ({
          date: d.date,
          accuracy: d.accuracy_percent ?? d.accuracy ?? 0,
          questions_answered: d.total ?? 0,
        })));
      })
      .catch(() => {});
  }, [days]);

  const safeTimeline = Array.isArray(timeline) ? timeline : [];
  const maxAccuracy = Math.max(...safeTimeline.map((d) => d.accuracy || 0), 1);
  const hasData = safeTimeline.some((d) => d.accuracy > 0);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const stats = overview
    ? [
        { label: "Sessions", value: overview.total_sessions, icon: BarChart3 },
        { label: "Questions", value: overview.total_questions_answered, icon: Target },
        { label: "Accuracy", value: `${Math.round(overview.overall_accuracy)}%`, icon: TrendingUp },
        { label: "Streak", value: `${overview.current_streak}d`, icon: Flame },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background text-foreground pb-20 md:pb-0">
      <AppHeader activePage="Analytics" />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page title + day filter */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Your performance across all study sessions</p>
          </div>
          <div className="flex items-center gap-1.5 p-1 bg-muted rounded-lg">
            {[7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  days === d
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {/* Stats row */}
        {overview && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {stats.map(({ label, value, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
                    <Icon className="w-4 h-4 text-muted-foreground/50" />
                  </div>
                  <p className="text-2xl font-bold text-foreground tabular-nums">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Accuracy timeline — full width */}
        <Card className="mb-6">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Accuracy Timeline</CardTitle>
              {hasData && (
                <span className="text-xs text-muted-foreground">
                  peak {Math.round(maxAccuracy)}%
                </span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!hasData ? (
              <div className="flex flex-col items-center justify-center h-40 gap-2">
                <BarChart3 className="w-8 h-8 text-muted-foreground/30" />
                <p className="text-sm text-muted-foreground">No quiz activity in this period</p>
              </div>
            ) : (
              <>
                {/* Y-axis guide lines */}
                <div className="relative h-48">
                  {[100, 75, 50, 25].map((pct) => (
                    <div
                      key={pct}
                      className="absolute left-0 right-0 border-t border-border/30 flex items-center"
                      style={{ top: `${100 - pct}%` }}
                    >
                      <span className="text-[10px] text-muted-foreground/50 pr-2 leading-none -mt-2.5">{pct}</span>
                    </div>
                  ))}
                  {/* Bars */}
                  <div className="absolute inset-0 pl-6 flex items-end gap-1">
                    {safeTimeline.map((d) => {
                      const pct = maxAccuracy > 0 ? (d.accuracy / maxAccuracy) * 100 : 0;
                      return (
                        <div key={d.date} className="flex-1 flex flex-col items-center gap-1 group relative h-full justify-end">
                          <div
                            className="absolute -top-7 left-1/2 -translate-x-1/2 bg-popover border text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none"
                          >
                            {Math.round(d.accuracy)}%
                            {d.questions_answered > 0 && (
                              <span className="text-muted-foreground ml-1">· {d.questions_answered}q</span>
                            )}
                          </div>
                          <div
                            className={`w-full rounded-t transition-all ${
                              d.accuracy > 0 ? "bg-foreground/80 hover:bg-foreground" : "bg-muted/20"
                            }`}
                            style={{ height: `${d.accuracy > 0 ? Math.max(pct, 6) : 2}%` }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
                {/* X-axis labels */}
                <div className="flex pl-6 mt-2">
                  {safeTimeline.map((d) => (
                    <span key={d.date} className="flex-1 text-center text-[10px] text-muted-foreground truncate">
                      {new Date(d.date).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}
                    </span>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Bottom row: Confidence + Weak topics + Co-failures */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Confidence calibration */}
          <div className="lg:col-span-4">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Confidence vs Accuracy</CardTitle>
              </CardHeader>
              <CardContent>
                {confidence.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No confidence data yet</p>
                ) : (
                  <div className="space-y-4">
                    {confidence.map((c) => (
                      <div key={c.confidence_level}>
                        <div className="flex items-center justify-between text-xs mb-1.5">
                          <span className="text-muted-foreground">Level {c.confidence_level}</span>
                          <span className="font-semibold text-foreground tabular-nums">
                            {Math.round(c.accuracy)}%
                            <span className="text-muted-foreground font-normal ml-1">({c.count})</span>
                          </span>
                        </div>
                        <Progress value={c.accuracy} className="h-1.5" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Weak topics */}
          <div className="lg:col-span-5">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Weak Topics</CardTitle>
              </CardHeader>
              <CardContent>
                {weakTopics.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">No weak topics identified yet</p>
                ) : (
                  <div className="space-y-3">
                    {weakTopics.slice(0, 6).map((t) => {
                      const pct = Math.round(t.accuracy * 100);
                      const isWeak = pct < 50;
                      const isMid = pct >= 50 && pct < 70;
                      return (
                        <div key={t.topic}>
                          <div className="flex items-center justify-between text-xs mb-1.5">
                            <span className="text-foreground font-medium line-clamp-1 flex-1 mr-4">{t.topic}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {isWeak && <AlertTriangle className="w-3 h-3 text-destructive" />}
                              <span className={`tabular-nums font-semibold ${isWeak ? "text-destructive" : isMid ? "text-yellow-500" : "text-foreground"}`}>
                                {pct}%
                              </span>
                              <span className="text-muted-foreground">· {t.attempts}</span>
                            </div>
                          </div>
                          <Progress
                            value={pct}
                            className={`h-1 ${isWeak ? "[&>div]:bg-destructive" : isMid ? "[&>div]:bg-yellow-500" : ""}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Co-failing topics */}
          <div className="lg:col-span-3">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Co-Failing Topics</CardTitle>
              </CardHeader>
              <CardContent>
                {coFailures.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">None found</p>
                ) : (
                  <div className="space-y-2.5">
                    {coFailures.slice(0, 5).map((cf, i) => (
                      <div key={i} className="rounded-lg border border-border/50 p-2.5 space-y-1.5">
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{cf.topic_a}</Badge>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{cf.topic_b}</Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Failed together {cf.co_fail_count}×
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Full empty state */}
        {!overview && weakTopics.length === 0 && timeline.length === 0 && (
          <Card className="mt-6">
            <CardContent className="py-20 text-center">
              <BarChart3 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
              <p className="text-sm font-semibold text-foreground">No analytics yet</p>
              <p className="text-xs text-muted-foreground mt-1">Complete some quizzes to see your performance data here.</p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
