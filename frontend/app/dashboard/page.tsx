"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getDashboard, getLectures, getDailyMission, DailyMission, getFlashcardStats, FlashcardStats, getDueFlashcards, FlashcardOut, getDailyTest, DailyTestData } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { prefetch } from "@/lib/prefetch-cache";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  BookOpen,
  Target,
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
  CloudUpload,
} from "lucide-react";



import { Skeleton } from "@/components/ui/skeleton";
import { DashboardSkeleton } from "./DashboardSkeleton";

interface Lecture {
  id: number;
  title: string;
  file_path: string;
  created_at: string;
  is_processed: boolean;
  has_essays: boolean;
  pending_job_id?: string | null;
}

type Filter = "all" | "processed" | "unprocessed";

export default function DashboardPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(true);
  const [loadingDash, setLoadingDash] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [stats, setStats] = useState({ total_lectures: 0, processed_lectures: 0, total_mcqs_answered: 0, avg_score: 0 });
  const [userName, setUserName] = useState("Student");
  const [dailyMission, setDailyMission] = useState<DailyMission | null>(null);
  const [dailyTest, setDailyTest] = useState<DailyTestData | null>(null);
  const [loadingDailyTest, setLoadingDailyTest] = useState(true);
  const [flashcardStats, setFlashcardStats] = useState<FlashcardStats | null>(null);
  const [loadingFlashcards, setLoadingFlashcards] = useState(true);
  const [previewFlashcard, setPreviewFlashcard] = useState<FlashcardOut | null>(null);

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

    (prefetch.dailyMission ?? getDailyMission())
      .then((res) => { if (res) setDailyMission(res.data); })
      .catch(() => {});

    getDailyTest()
      .then((res) => { if (res) setDailyTest(res.data); })
      .catch(() => {})
      .finally(() => setLoadingDailyTest(false));

    getFlashcardStats()
      .then((res) => { if (res) setFlashcardStats(res.data); })
      .catch(() => {})
      .finally(() => setLoadingFlashcards(false));

    getDueFlashcards(undefined, 1)
      .then((res) => { if (res?.data?.cards?.length) setPreviewFlashcard(res.data.cards[0]); })
      .catch(() => {});
  };

  if (loadingDash && loadingLectures && loadingDailyTest && loadingFlashcards) {
    return <DashboardSkeleton />;
  }

  // Determine user onboarding status
  const isNewUser = !loadingLectures && lectures.length === 0 && !loadingDash && stats.total_lectures === 0;

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

        {/* ── Welcome banner for new users ── */}
        {isNewUser && (
          <div className="mb-6 rounded-xl border border-primary/30 bg-primary/5 p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-lg font-bold text-foreground mb-1">Welcome to themcq!</h2>
                <p className="text-sm text-muted-foreground">Get started in 3 simple steps:</p>
                <ol className="text-sm text-muted-foreground mt-2 space-y-1">
                  <li>1. <strong>Upload</strong> a PDF or paste your notes</li>
                  <li>2. <strong>Generate</strong> MCQs or flashcards with AI</li>
                  <li>3. <strong>Practice</strong> and track your progress</li>
                </ol>
              </div>
              <Button asChild size="default" className="shrink-0">
                <Link href="/lap" prefetch={false}>
                  <CloudUpload className="w-4 h-4 mr-2" />
                  Upload Your First File
                </Link>
              </Button>
            </div>
          </div>
        )}

        {/* ── Overview ── */}
        {!isNewUser && (
          <div className="mb-6 sm:mb-8">
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
          </div>
        )}

        {/* ── Daily Test (main card) ── */}
        <div className="mb-6 sm:mb-8">
          <Card className="overflow-hidden border-primary/20 shadow-lg shadow-primary/5">
            <div className="h-1.5 bg-gradient-to-r from-white/80 via-gray-300 to-gray-900 dark:from-white/20 dark:via-gray-600 dark:to-gray-950" />
            <CardContent className="p-5 sm:p-8">

                {/* header row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-3">
                    <Brain className="h-6 w-6 text-primary flex-shrink-0" />
                    <span className="text-lg font-black uppercase tracking-tight text-foreground">
                      Daily Test
                    </span>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap">
                    {dailyMission && (
                      <div className="flex items-center gap-1.5">
                        <Flame className="h-5 w-5 text-orange-500" />
                        <span className="text-sm font-extrabold text-foreground whitespace-nowrap">{dailyMission.streak_days}d streak</span>
                      </div>
                    )}
                    <Badge variant="outline" className="text-xs px-3 py-1">
                      <Zap className="h-3 w-3 mr-1 text-primary" />
                      AI-picked · refreshes daily
                    </Badge>
                  </div>
                </div>

                {/* loading skeleton */}
                {loadingDailyTest ? (
                  <div className="space-y-3">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-16 w-full rounded-xl" />
                    <Skeleton className="h-3 w-3/4" />
                    {[1,2,3,4].map(i => (
                      <div key={i} className="flex items-center gap-2 mt-1">
                        <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
                        <Skeleton className="h-3 flex-1" />
                      </div>
                    ))}
                  </div>

                ) : !dailyTest || !dailyTest.has_questions ? (
                  <div className="flex flex-col items-center text-center gap-3 py-8">
                    <BookOpen className="h-12 w-12 text-muted-foreground" />
                    <p className="text-base font-bold text-foreground">No test yet</p>
                    <p className="text-sm text-muted-foreground max-w-xs">Upload and process a lecture to get your daily test.</p>
                    <Button variant="default" size="default" className="mt-2" asChild>
                      <Link href="/lap" prefetch={false}>Upload Lecture</Link>
                    </Button>
                  </div>

                ) : (
                  <>
                    {/* Question preview — larger */}
                    <div className="rounded-xl border-2 border-primary/25 bg-primary/5 p-4 sm:p-5 mb-4">
                      <p className="text-[11px] sm:text-xs font-bold text-primary uppercase tracking-wider mb-2">
                        {dailyTest.questions[0].topic}
                      </p>
                      <p className="text-sm sm:text-base font-semibold text-foreground leading-relaxed line-clamp-3">
                        {dailyTest.questions[0].question_text}
                      </p>
                    </div>

                    {/* Option preview — blurred to tease */}
                    <div className="space-y-2 mb-5">
                      {(["A","B","C","D"] as const).map((letter) => {
                        const key = `option_${letter.toLowerCase()}` as "option_a"|"option_b"|"option_c"|"option_d";
                        return (
                          <div
                            key={letter}
                            className="flex items-center gap-3 px-3 sm:px-4 py-2.5 sm:py-3 rounded-xl border border-border bg-card"
                          >
                            <span className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-[11px] sm:text-xs font-bold bg-muted text-muted-foreground flex-shrink-0">
                              {letter}
                            </span>
                            <span className="text-xs sm:text-sm text-foreground/80 blur-sm select-none flex-1 line-clamp-1">
                              {dailyTest.questions[0][key]}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* Progress bar if mission in progress */}
                    {dailyMission && dailyMission.answered_today > 0 && (
                      <div className="mb-4">
                        <div className="flex justify-between text-xs sm:text-sm text-muted-foreground mb-1.5">
                          <span className="font-medium">{dailyMission.answered_today} answered today</span>
                          <span className={dailyMission.accuracy_today >= 70 ? "font-bold text-emerald-500" : "font-bold text-orange-500"}>
                            {dailyMission.accuracy_today}% accuracy
                          </span>
                        </div>
                        <Progress
                          value={Math.min(100, (dailyMission.answered_today / dailyMission.goal) * 100)}
                          className={`h-2 ${dailyMission.completed ? "[&>div]:bg-emerald-500" : ""}`}
                        />
                      </div>
                    )}

                    <Button size="lg" className="w-full text-sm sm:text-base font-bold" asChild>
                      <Link href="/daily-test" prefetch={false}>
                        <Target className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                        Start Your Daily Test
                        <ArrowRight className="h-4 w-4 sm:h-5 sm:w-5 ml-2" />
                      </Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left column */}
          <div className="lg:col-span-4 space-y-6">
            {/* ── Flashcard of the Day ── */}
            <Card className="overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-white/80 via-gray-300 to-gray-900 dark:from-white/20 dark:via-gray-600 dark:to-gray-950" />
              <CardContent className="p-5">

                {/* header row */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    <span className="text-xs font-bold uppercase tracking-wide text-primary">
                      Flashcard of the Day
                    </span>
                  </div>
                  {flashcardStats && flashcardStats.cards_due_today > 0 && (
                    <Badge variant="secondary" className="text-[10px] px-2.5 py-0.5 font-bold">
                      {flashcardStats.cards_due_today} due
                    </Badge>
                  )}
                </div>

                {/* loading skeleton */}
                {loadingFlashcards ? (
                  <div className="space-y-2.5">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-16 w-full rounded-xl mt-2" />
                  </div>

                ) : !flashcardStats || flashcardStats.total_cards_seen === 0 ? (
                  /* no flashcards generated yet */
                  <div className="flex flex-col items-center text-center gap-2 py-4">
                    <BookOpen className="h-9 w-9 text-muted-foreground" />
                    <p className="text-sm font-semibold text-foreground">No flashcards yet</p>
                    <p className="text-xs text-muted-foreground">Generate cards after uploading a lecture.</p>
                    <Button variant="outline" size="sm" className="mt-1 w-full" asChild>
                      <Link href="/lectures" prefetch={false}>Go to Lectures</Link>
                    </Button>
                  </div>

                ) : flashcardStats.cards_due_today === 0 ? (
                  /* all done today */
                  <div className="flex flex-col items-center text-center gap-2 py-4">
                    <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                    <p className="text-sm font-semibold text-foreground">All done!</p>
                    <p className="text-xs text-muted-foreground">No flashcards due today — great work.</p>
                  </div>

                ) : (
                  <>
                    {/* flip-card style preview */}
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 mb-3 min-h-[90px] flex flex-col justify-between">
                      {previewFlashcard ? (
                        <>
                          <p className="text-[11px] font-semibold text-primary uppercase tracking-wide mb-1.5">
                            {previewFlashcard.topic}
                          </p>
                          <p className="text-sm font-medium text-foreground leading-snug line-clamp-3">
                            {previewFlashcard.front}
                          </p>
                          <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            <span>Tap to reveal answer</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center self-center">
                          {flashcardStats.cards_due_today} card{flashcardStats.cards_due_today !== 1 ? "s" : ""} ready to review
                        </p>
                      )}
                    </div>

                    <p className="text-xs text-muted-foreground mb-3">
                      {flashcardStats.cards_mastered} mastered · {flashcardStats.total_reviews} reviews
                    </p>

                    <Button size="sm" className="w-full" asChild>
                      <Link href="/flashcards" prefetch={false}>
                        <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                        Review Flashcards
                        <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
                      </Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

          </div>

          {/* Right column — Lectures only */}
          <div className="lg:col-span-8 space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-4 border-b">
                <CardTitle className="text-base font-bold">Your Lectures</CardTitle>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/lectures" prefetch={false}>View All</Link>
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
                      <Link href="/lap" prefetch={false}>+ Upload New Lecture</Link>
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
                          return (
                            <Link
                              key={lecture.id}
                              href="/lectures"
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
