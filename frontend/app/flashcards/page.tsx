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
  Clock,
  Flame,
  Play,
  TrendingUp,
  Layers,
} from "lucide-react";
import {
  getDueFlashcards,
  getFlashcardStats,
  getFlashcardSchedule,
  getLectures,
  FlashcardStats,
  FlashcardScheduleTopic,
  LectureOut,
} from "@/lib/api";

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
    Promise.all([
      getFlashcardStats(),
      getFlashcardSchedule(),
      getLectures(),
    ])
      .then(([statsRes, schedRes, lecRes]) => {
        setStats(statsRes.data);
        setSchedule(schedRes.data.topics.slice(0, 5));
        const all = lecRes.data as LectureOut[];
        setLectures(all.filter((l) => l.is_processed));
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [router]);

  const dueToday = stats?.cards_due_today ?? 0;

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <AppHeader />
      <main className="max-w-4xl mx-auto px-4 py-8 space-y-8">

        {/* Hero: start review */}
        <div className="rounded-2xl bg-gradient-to-br from-indigo-900/60 to-purple-900/40 border border-indigo-500/30 p-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">Flashcards</h1>
            <p className="text-indigo-300 text-sm">
              {dueToday > 0
                ? `${dueToday} card${dueToday !== 1 ? "s" : ""} waiting for review`
                : "You're all caught up!"}
            </p>
          </div>
          <Button
            onClick={() => router.push("/flashcards/review")}
            disabled={dueToday === 0}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 text-lg rounded-xl disabled:opacity-40"
          >
            <Play className="w-5 h-5 mr-2" />
            Start Review
          </Button>
        </div>

        {/* Stats row */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatCard icon={<Flame className="w-5 h-5 text-orange-400" />} label="Streak" value={`${stats.streak_days}d`} />
            <StatCard icon={<CheckCircle2 className="w-5 h-5 text-green-400" />} label="Mastered" value={stats.cards_mastered} />
            <StatCard icon={<Brain className="w-5 h-5 text-purple-400" />} label="Seen" value={stats.total_cards_seen} />
            <StatCard icon={<TrendingUp className="w-5 h-5 text-blue-400" />} label="Reviews" value={stats.total_reviews} />
          </div>
        )}

        {/* Retention schedule */}
        {schedule.length > 0 && (
          <Card className="bg-[#0f0f1f] border-white/10">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-400" />
                Retention by Topic
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {schedule.map((t) => (
                <div key={t.topic}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-white/80 truncate max-w-[60%]">{t.topic}</span>
                    <span className={`font-mono text-xs ${t.retention_pct < 60 ? "text-red-400" : t.retention_pct < 80 ? "text-yellow-400" : "text-green-400"}`}>
                      {t.retention_pct.toFixed(0)}%
                    </span>
                  </div>
                  <Progress value={t.retention_pct} className="h-1.5 bg-white/10" />
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Lectures */}
        {lectures.length > 0 && (
          <Card className="bg-[#0f0f1f] border-white/10">
            <CardHeader>
              <CardTitle className="text-white text-lg flex items-center gap-2">
                <Layers className="w-5 h-5 text-indigo-400" />
                By Lecture
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {lectures.map((lec) => (
                <div key={lec.id} className="flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
                    <span className="text-white/90 text-sm truncate">{lec.title}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-indigo-300 hover:text-white text-xs"
                      onClick={() => router.push(`/flashcards/review?document_id=${lec.id}`)}
                    >
                      Review
                    </Button>
                    <Link href={`/flashcards/browse/${lec.id}`}>
                      <Button variant="ghost" size="sm" className="text-white/50 hover:text-white text-xs">
                        Browse
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {loading && (
          <div className="text-center py-12 text-white/40">Loading...</div>
        )}
      </main>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <Card className="bg-[#0f0f1f] border-white/10">
      <CardContent className="pt-4 pb-4 flex flex-col items-center gap-1">
        {icon}
        <div className="text-2xl font-bold text-white">{value}</div>
        <div className="text-xs text-white/50">{label}</div>
      </CardContent>
    </Card>
  );
}
