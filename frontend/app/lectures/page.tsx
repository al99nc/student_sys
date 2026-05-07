"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getResults, getLectures, getMe, getQuizSession, getSolvedLectures } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  Sparkles,
  AlertCircle,
  Loader2,
  Search,
  ChevronRight,
  CheckCircle2,
  Clock,
} from "lucide-react";

interface MCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

interface LectureData {
  id: number;
  title: string;
  mcqs: MCQ[];
  answeredIndices: Set<number>;
  sessionAnswers: Record<string, any>;
  has_essays: boolean;
  source: "uploaded" | "generated";
  createdAt: string;
}

interface SolvedLecture {
  id: number;
  title: string;
  created_at: string;
  mcq_count: number;
  has_essays: boolean;
}

interface RawLecture {
  id: number;
  title: string;
  created_at: string;
  is_processed: boolean;
  has_essays: boolean;
}

type Tab = "all" | "uploaded";

export default function LecturesPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<LectureData[]>([]);
  const [solvedLectures, setSolvedLectures] = useState<SolvedLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [allUploads, setAllUploads] = useState<RawLecture[]>([]);
  const [userName, setUserName] = useState("Lecturer");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    fetchData();
  }, [router]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [meRes, lecturesRes, solvedRes] = await Promise.all([getMe(), getLectures(), getSolvedLectures()]);
      setUserName(meRes.data.name || "Lecturer");
      setAllUploads(lecturesRes.data);

      // Only fetch results/sessions for processed lectures — unprocessed ones
      // will never have either, so calling those endpoints just generates 404s.
      const lectureDataPromises = lecturesRes.data
        .filter((lecture: any) => lecture.is_processed)
        .map((lecture: any) =>
          Promise.all([
            getResults(lecture.id).catch((e: unknown) => {
              if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
              throw e;
            }),
            getQuizSession(lecture.id).catch((e: unknown) => {
              if ((e as { response?: { status?: number } })?.response?.status === 404) return null;
              throw e;
            }),
          ]).then(([resResult, sessionResult]) => {
            const mcqs = resResult?.data?.mcqs || [];
            const rawAnswers: Record<string, any> = sessionResult?.data?.answers || {};
            const answeredIndices = new Set<number>(
              Object.keys(rawAnswers).map(Number).filter((i) => rawAnswers[String(i)] != null)
            );
            return {
              id: lecture.id,
              title: lecture.title,
              mcqs,
              answeredIndices,
              sessionAnswers: rawAnswers,
              has_essays: resResult?.data?.has_essays || false,
              source: "uploaded" as const,
              createdAt: lecture.created_at,
            };
          })
        );

      const lectureData = await Promise.all(lectureDataPromises);
      setLectures(lectureData.filter((l) => l.mcqs.length > 0 || l.has_essays));
      setSolvedLectures(solvedRes.data);
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to load MCQs");
    } finally {
      setLoading(false);
    }
  };

  const filteredLectures = lectures.filter(
    (lecture) =>
      lecture.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lecture.mcqs.some((mcq) =>
        mcq.question.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

  const filteredSolved = solvedLectures.filter((l) =>
    l.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const allMCQs = filteredLectures.flatMap((lecture) =>
    lecture.mcqs
      .map((mcq, idx) => {
        const raw = (lecture as any).sessionAnswers?.[String(idx)];
        const userLetter: string | null = raw ? (typeof raw === "string" ? raw : raw.letter) : null;
        return { ...mcq, lectureId: lecture.id, lectureTitle: lecture.title, key: `${lecture.id}-${idx}`, idx, userLetter };
      })
      .filter((mcq) => mcq.userLetter != null)
  );

  const totalMCQs = allMCQs.length;
  const totalLectures = solvedLectures.length;
  const correctCount = allMCQs.filter((m) => m.userLetter === m.answer).length;

  if (!isAuthenticated()) return null;

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-8">
      <AppHeader activePage="Lectures" />

      <main className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-10">
        <section className="rounded-[2rem] border border-border/70 bg-background/95 p-6 shadow-lg shadow-slate-950/10 mb-8">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 space-y-4">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.32em] text-primary">
                <BookOpen className="w-3.5 h-3.5" />
                Lecture hub
              </div>
              <div className="space-y-2">
                <h1 className="text-3xl sm:text-4xl font-semibold text-foreground">Your MCQ library</h1>
                <p className="max-w-2xl text-sm text-muted-foreground">
                  {userName}, review your uploaded lectures, rediscover answered questions, and track your accuracy over time.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-3xl border border-border/60 bg-slate-950/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Answered</p>
                <p className="mt-3 text-3xl font-bold text-foreground">{totalMCQs}</p>
              </div>
              <div className="rounded-3xl border border-border/60 bg-slate-950/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Lectures</p>
                <p className="mt-3 text-3xl font-bold text-foreground">{totalLectures}</p>
              </div>
              <div className="rounded-3xl border border-border/60 bg-slate-950/5 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">Accuracy</p>
                <p className="mt-3 text-3xl font-bold text-foreground text-emerald-500">
                  {totalMCQs > 0 ? `${Math.round((correctCount / totalMCQs) * 100)}%` : "—"}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Continue studying — all uploads with status */}
        {!loading && allUploads.length > 0 && (
          <div className="mb-8">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-muted-foreground mb-1">Your uploads</p>
            <h2 className="text-2xl font-semibold text-foreground mb-4">Continue studying</h2>
            <div className={`grid gap-3 ${allUploads.length === 1 ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2"}`}>
              {allUploads.map((upload) => {
                const isReady = upload.is_processed;
                const href = isReady ? `/results/${upload.id}` : `/upload`;
                return (
                  <Link key={upload.id} href={href} prefetch={false}>
                    <div className="flex items-center gap-3 p-4 rounded-xl border hover:border-primary/40 hover:bg-muted/20 transition-all duration-150">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${isReady ? "bg-emerald-500/10" : "bg-amber-500/10"}`}>
                        {isReady ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Clock className="w-4 h-4 text-amber-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground truncate">{upload.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(upload.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={`flex-shrink-0 ${isReady ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" : "text-amber-500 border-amber-500/30"}`}
                      >
                        {isReady ? "Ready" : "Processing"}
                      </Badge>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between mb-6">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-muted-foreground">Study overview</p>
            <h2 className="text-2xl font-semibold text-foreground">Discover your lectures</h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/upload" prefetch={false}>
              <Button size="sm">Upload lecture</Button>
            </Link>
            <Link href="/quiz/solved" prefetch={false}>
              <Button variant="outline" size="sm">Review sessions</Button>
            </Link>
          </div>
        </div>

        <div className="mb-5 md:mb-6">
          <div className="relative">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search lectures or answered questions…"
              className="w-full pl-10 pr-4 py-3 text-sm md:text-base rounded-2xl border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
          <TabsList className="w-full grid grid-cols-2 h-12 mb-5 md:mb-6 gap-2">
            <TabsTrigger value="all" className="text-sm md:text-base">
              All answers ({totalMCQs})
            </TabsTrigger>
            <TabsTrigger value="uploaded" className="text-sm md:text-base">
              By lecture ({totalLectures})
            </TabsTrigger>
          </TabsList>

          {/* All MCQs tab */}
          <TabsContent value="all" className="space-y-3 md:space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : error ? (
              <Card className="border-destructive/50 bg-destructive/10">
                <CardContent className="pt-4 px-5 pb-5">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-semibold text-sm">Error</p>
                      <p className="text-xs md:text-sm text-muted-foreground">{error}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : allMCQs.length === 0 ? (
              <Card>
                <CardContent className="pt-14 pb-14 px-6 text-center">
                  <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
                  <h3 className="font-semibold mb-2">No answered questions yet</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    Take a quiz first — only solved questions appear here.
                  </p>
                  <Link href="/upload" prefetch={false}>
                    <Button size="sm">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Create MCQs
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {allMCQs.map((mcq) => {
                  const correct = mcq.answer;
                  const userPick = mcq.userLetter;
                  const isRight = userPick === correct;
                  return (
                    <Card key={mcq.key} className="overflow-hidden">
                      <CardContent className="space-y-4 px-4 py-5 md:px-5 md:py-6">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-base font-semibold text-foreground">{mcq.question}</p>
                            <p className="mt-2 text-xs text-muted-foreground">{mcq.lectureTitle}</p>
                          </div>
                          <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${isRight ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"}`}>
                            {isRight ? "Correct" : "Incorrect"}
                          </span>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          {mcq.options.map((opt, i) => {
                            const letter = ["A", "B", "C", "D"][i];
                            const isCorrect = letter === correct;
                            const isUser = letter === userPick;
                            const base = "text-sm rounded-2xl border px-4 py-3 transition-colors";
                            const statusClass = isCorrect
                              ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                              : isUser && !isCorrect
                              ? "border-rose-400/40 bg-rose-500/10 text-rose-300"
                              : "border-border/30 bg-background text-muted-foreground";
                            return (
                              <div key={letter} className={`${base} ${statusClass}`}>
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-semibold">{letter}.</span>
                                  {isCorrect && <span className="text-[11px] font-semibold uppercase text-emerald-400">Correct</span>}
                                  {isUser && !isCorrect && <span className="text-[11px] font-semibold uppercase text-rose-400">Your answer</span>}
                                </div>
                                <p className="mt-2 text-sm leading-6">{opt}</p>
                              </div>
                            );
                          })}
                        </div>

                        {mcq.explanation && (
                          <div className="rounded-2xl border border-border/50 bg-muted/10 p-4 text-sm text-muted-foreground">
                            <p className="font-semibold text-sm text-foreground">Explanation</p>
                            <p className="mt-2">{mcq.explanation}</p>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* By Lecture tab */}
          <TabsContent value="uploaded" className="space-y-3 md:space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredSolved.length === 0 ? (
              <Card>
                <CardContent className="pt-14 pb-14 px-6 text-center">
                  <BookOpen className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-40" />
                  <h3 className="font-semibold mb-2">No processed lectures</h3>
                  <p className="text-sm text-muted-foreground mb-5">
                    Upload a lecture and generate study materials to see it here.
                  </p>
                  <Link href="/upload" prefetch={false}>
                    <Button size="sm">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Upload Lecture
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredSolved.map((lecture) => (
                  <Link key={lecture.id} href={`/quiz/solved/${lecture.id}`}>
                    <Card className="cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-all duration-150 touch-manipulation">
                      <CardContent className="px-4 md:px-6 py-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-start gap-4">
                            <div className="w-12 h-12 rounded-3xl bg-primary/10 flex items-center justify-center text-primary">
                              <BookOpen className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm md:text-base truncate">{lecture.title}</p>
                              <div className="flex flex-wrap gap-2 mt-2 text-xs text-muted-foreground">
                                <span>{new Date(lecture.created_at).toLocaleDateString()}</span>
                                {lecture.has_essays && !lecture.mcq_count ? (
                                  <Badge variant="outline" className="text-xs text-violet-400 border-violet-400/40">
                                    Essay
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">
                                    {lecture.mcq_count} MCQs
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
