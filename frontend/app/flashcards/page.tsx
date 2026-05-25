"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen,
  Brain,
  CheckCircle2,
  Flame,
  Play,
  TrendingUp,
  Layers,
  Sparkles,
  CloudUpload,
} from "lucide-react";
import {
  getFlashcardStats,
  getFlashcardSchedule,
  getLectures,
  FlashcardStats,
  FlashcardScheduleTopic,
  LectureOut,
} from "@/lib/api";

import { FlashcardsSkeleton } from "./FlashcardsSkeleton";

export default function FlashcardsPage() {
  const router = useRouter();
  const [stats, setStats] = useState<FlashcardStats | null>(null);
  const [schedule, setSchedule] = useState<FlashcardScheduleTopic[]>([]);
  const [lectures, setLectures] = useState<LectureOut[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/auth");
      return;
    }
    Promise.all([getFlashcardStats(), getFlashcardSchedule(), getLectures()])
      .then(([statsRes, schedRes, lecRes]) => {
        setStats(statsRes.data);
        setSchedule(schedRes.data.topics.slice(0, 5));
        const all = lecRes.data as LectureOut[];
        setLectures(all.filter((l) => l.is_processed));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return <FlashcardsSkeleton />;
  }

  const dueToday = stats?.cards_due_today ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground pb-32 md:pb-0">
      <AppHeader activePage="Flashcards" />

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-foreground tracking-tight mb-2">
              Flashcards
            </h1>
            <div className="flex flex-wrap gap-2">
              {stats && (
                <>
                  <Badge variant="secondary">
                    <Brain className="h-3 w-3 mr-1" />
                    {stats.total_cards_seen} seen
                  </Badge>
                  <Badge variant="outline">
                    <Flame className="h-3 w-3 mr-1" />
                    {stats.streak_days}d streak
                  </Badge>
                </>
              )}
            </div>
          </div>
          <Button
            onClick={() => router.push("/flashcards/review")}
            disabled={dueToday === 0 || loading}
            className="sm:self-end"
          >
            <Play className="w-4 h-4 mr-2" />
            {dueToday > 0
              ? `Review ${dueToday} card${dueToday !== 1 ? "s" : ""}`
              : "All caught up"}
          </Button>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard
              icon={<Flame className="h-4 w-4 text-orange-500" />}
              label="Streak"
              value={`${stats.streak_days}d`}
            />
            <StatCard
              icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />}
              label="Mastered"
              value={stats.cards_mastered}
            />
            <StatCard
              icon={<Brain className="h-4 w-4 text-primary" />}
              label="Seen"
              value={stats.total_cards_seen}
            />
            <StatCard
              icon={<TrendingUp className="h-4 w-4 text-blue-500" />}
              label="Reviews"
              value={stats.total_reviews}
            />
          </div>
        )}

        {/* Retention by Topic */}
        {schedule.length > 0 && (
          <Card>
            <CardHeader className="pb-4 border-b">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                Retention by Topic
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {schedule.map((t) => (
                <div key={t.topic}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-foreground truncate max-w-[65%]">{t.topic}</span>
                    <span
                      className={`font-mono text-xs font-semibold ${
                        t.retention_pct < 60
                          ? "text-destructive"
                          : t.retention_pct < 80
                          ? "text-yellow-500"
                          : "text-emerald-500"
                      }`}
                    >
                      {t.retention_pct.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={t.retention_pct} className="h-1.5" />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* How it works - quick guide */}
        {lectures.length > 0 && (
          <div className="bg-muted/20 rounded-xl border border-border/40 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3 text-sm">
            <Sparkles className="w-5 h-5 text-primary shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-foreground">
                <strong>How it works:</strong> Review cards due today, then browse all cards by lecture below.
              </p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Cards use spaced repetition — you see the right card at the right time.
              </p>
            </div>
            <Button
              size="sm"
              onClick={() => router.push("/flashcards/review")}
              disabled={dueToday === 0}
            >
              <Play className="w-3.5 h-3.5 mr-1.5" />
              Start Review
            </Button>
          </div>
        )}

        {/* By Lecture */}
        {lectures.length > 0 && (
          <Card>
            <CardHeader className="pb-4 border-b flex flex-row items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                By Lecture
              </CardTitle>
              <span className="text-xs text-muted-foreground">{lectures.length} lecture{lectures.length !== 1 ? "s" : ""}</span>
            </CardHeader>
            <CardContent className="p-6 space-y-2">
              {lectures.map((lec) => (
                <div
                  key={lec.id}
                  className="flex items-center justify-between px-4 py-3 rounded-xl border hover:border-primary/40 hover:bg-muted/20 transition-all duration-150"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1 mr-3">
                    <BookOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-medium text-foreground truncate">{lec.title}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      onClick={() => router.push(`/flashcards/review?document_id=${lec.id}`)}
                    >
                      Review
                    </Button>
                    <Button variant="outline"
                      size="sm"
                      className="text-xs"
                      onClick={() => router.push(`/upload?section=create&lecture_id=${lec.id}`)}
                    >
                      Generate Flashcards
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Empty state */}
        {!loading && lectures.length === 0 && (
          <Card>
            <CardContent className="p-10 flex flex-col items-center justify-center text-center">
              <BookOpen className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="font-semibold text-foreground mb-1">No flashcards yet</p>
              <p className="text-sm text-muted-foreground mb-2 max-w-sm">
                Flashcards are generated after you upload and process a lecture. Here&apos;s how:
              </p>
              <ol className="text-sm text-left text-muted-foreground mb-5 space-y-1.5">
                <li>1. Upload a PDF or paste your notes</li>
                <li>2. Choose what to generate (MCQs, flashcards, etc.)</li>
                <li>3. Come back here to review with spaced repetition</li>
              </ol>
              <Button asChild>
                <Link href="/upload">
                  <CloudUpload className="w-4 h-4 mr-2" />
                  Upload a Lecture
                </Link>
              </Button>
            </CardContent>
          </Card>
        )}

      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <Card>
      <CardContent className="p-6 flex flex-col items-center gap-1.5">
        {icon}
        <div className="text-2xl font-bold text-foreground">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
