"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getResults, getLectures, getMe, getQuizSession, getSolvedLectures } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
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

type Tab = "all" | "uploaded";

export default function LecturesPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<LectureData[]>([]);
  const [solvedLectures, setSolvedLectures] = useState<SolvedLecture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("all");
  const [searchQuery, setSearchQuery] = useState("");
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

      const lectureDataPromises = lecturesRes.data.map((lecture: any) =>
        Promise.all([
          getResults(lecture.id).catch(() => null),
          getQuizSession(lecture.id).catch(() => null),
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
      {/* Main Header */}
      <div className="sticky top-0 z-40 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-4 py-3 md:px-8 md:py-4 max-w-5xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <BookOpen className="w-5 h-5 md:w-6 md:h-6 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-base md:text-xl font-bold truncate">MCQ Library</h1>
                <p className="text-xs text-muted-foreground truncate hidden md:block">
                  All your study questions
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <Link href="/dashboard">
                <Button variant="outline" size="sm" className="h-9 md:h-10 text-xs md:text-sm">
                  Back
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 py-5 md:px-8 md:py-8 max-w-5xl mx-auto">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4 mb-6">
          <Card>
            <CardHeader className="pb-1 px-4 pt-4 md:px-5 md:pt-5">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
                Total Questions
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 md:px-5 md:pb-5">
              <p className="text-3xl md:text-4xl font-bold">{totalMCQs}</p>
              <p className="text-xs text-muted-foreground mt-1">MCQs</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-1 px-4 pt-4 md:px-5 md:pt-5">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">
                Lectures
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 md:px-5 md:pb-5">
              <p className="text-3xl md:text-4xl font-bold">{totalLectures}</p>
              <p className="text-xs text-muted-foreground mt-1">Uploaded</p>
            </CardContent>
          </Card>

          <Card className="col-span-2 md:col-span-1">
            <CardHeader className="pb-1 px-4 pt-4 md:px-5 md:pt-5">
              <CardTitle className="text-xs md:text-sm font-medium text-muted-foreground">Score</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 md:px-5 md:pb-5">
              <p className="text-3xl md:text-4xl font-bold text-green-500">
                {totalMCQs > 0 ? `${Math.round((correctCount / totalMCQs) * 100)}%` : "—"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{correctCount}/{totalMCQs} correct</p>
            </CardContent>
          </Card>
        </div>

        {/* Search */}
        <div className="mb-5 md:mb-6">
          <div className="relative">
            <Search className="absolute left-3.5 top-3 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search questions or lectures…"
              className="w-full pl-10 pr-4 py-2.5 md:py-3 text-sm md:text-base rounded-xl border border-border bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)}>
          <TabsList className="w-full grid grid-cols-2 h-11 md:h-12 mb-5 md:mb-6">
            <TabsTrigger value="all" className="text-sm md:text-base">
              All ({totalMCQs})
            </TabsTrigger>
            <TabsTrigger value="uploaded" className="text-sm md:text-base">
              By Lecture ({totalLectures})
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
                    Take a quiz first — only solved questions appear here
                  </p>
                  <Link href="/upload">
                    <Button size="sm">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Create MCQs
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3 md:space-y-4">
                {allMCQs.map((mcq) => {
                  const correct = mcq.answer;
                  const userPick = mcq.userLetter;
                  const isRight = userPick === correct;
                  return (
                    <Card key={mcq.key}>
                      <CardContent className="px-4 py-4 md:px-5 md:py-5 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">{mcq.question}</p>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0 ${isRight ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                            {isRight ? "✓" : "✗"}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {mcq.options.map((opt, i) => {
                            const letter = ["A","B","C","D"][i];
                            const isCorrect = letter === correct;
                            const isUser = letter === userPick;
                            let cls = "text-xs px-3 py-2 rounded-lg border ";
                            if (isCorrect) cls += "border-green-500/40 bg-green-500/10 text-green-300";
                            else if (isUser && !isCorrect) cls += "border-red-500/40 bg-red-500/10 text-red-300";
                            else cls += "border-border/30 text-muted-foreground";
                            return (
                              <div key={letter} className={cls}>
                                <span className="font-semibold mr-2">{letter}.</span>{opt}
                                {isCorrect && <span className="ml-2 text-green-400 text-xs">✓ correct</span>}
                                {isUser && !isCorrect && <span className="ml-2 text-red-400 text-xs">your answer</span>}
                              </div>
                            );
                          })}
                        </div>
                        {mcq.explanation && (
                          <p className="text-xs text-muted-foreground border-t border-border/30 pt-2">{mcq.explanation}</p>
                        )}
                        <p className="text-xs text-muted-foreground/50">{mcq.lectureTitle}</p>
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
                    Upload a lecture and generate study materials to see it here
                  </p>
                  <Link href="/upload">
                    <Button size="sm">
                      <Sparkles className="w-4 h-4 mr-2" />
                      Upload Lecture
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3 md:space-y-4">
                {filteredSolved.map((lecture) => (
                  <Link key={lecture.id} href={`/quiz/solved/${lecture.id}`}>
                    <Card className="cursor-pointer hover:border-primary/40 hover:bg-muted/20 active:scale-[0.99] transition-all duration-150 touch-manipulation">
                      <CardContent className="px-4 md:px-6 py-4 md:py-5">
                        <div className="flex items-center gap-4">
                          <div className="w-11 h-11 md:w-12 md:h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <BookOpen className="w-5 h-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm md:text-base truncate">{lecture.title}</p>
                            <div className="flex items-center gap-2 mt-1">
                              {lecture.has_essays && !lecture.mcq_count ? (
                                <Badge variant="outline" className="text-xs text-violet-400 border-violet-400/40">
                                  Essay
                                </Badge>
                              ) : (
                                <Badge variant="secondary" className="text-xs">
                                  {lecture.mcq_count} MCQs
                                </Badge>
                              )}
                              <span className="text-xs text-muted-foreground">
                                {new Date(lecture.created_at).toLocaleDateString()}
                              </span>
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
      </div>
    </div>
  );
}
