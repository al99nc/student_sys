"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getResults, getLectures, getMe } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BookOpen,
  MessageSquare,
  Sparkles,
  ChevronRight,
  AlertCircle,
  Loader2,
  Search,
} from "lucide-react";
import MCQCard from "@/components/mcq-card";

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
  source: "uploaded" | "generated";
  createdAt: string;
}

type Tab = "all" | "uploaded" | "shared";

export default function LecturesPage() {
  const router = useRouter();
  const [lectures, setLectures] = useState<LectureData[]>([]);
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
      const [meRes, lecturesRes] = await Promise.all([getMe(), getLectures()]);

      const user = meRes.data;
      setUserName(user.name || "Lecturer");

      // Fetch results for each lecture
      const lectureDataPromises = lecturesRes.data.map((lecture: any) =>
        getResults(lecture.id)
          .then((res) => ({
            id: lecture.id,
            title: lecture.title,
            mcqs: res.data.mcqs || [],
            source: "uploaded" as const,
            createdAt: lecture.created_at,
          }))
          .catch(() => ({
            id: lecture.id,
            title: lecture.title,
            mcqs: [],
            source: "uploaded" as const,
            createdAt: lecture.created_at,
          }))
      );

      const lectureData = await Promise.all(lectureDataPromises);
      setLectures(lectureData.filter((l) => l.mcqs.length > 0));
    } catch (err: any) {
      console.error("Error fetching data:", err);
      setError(err.response?.data?.detail || "Failed to load MCQs");
    } finally {
      setLoading(false);
    }
  };

  const filteredLectures = lectures.filter((lecture) => {
    const matchesSearch = lecture.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      lecture.mcqs.some((mcq) =>
        mcq.question.toLowerCase().includes(searchQuery.toLowerCase())
      );
    return matchesSearch;
  });

  const allMCQs = filteredLectures.flatMap((lecture) =>
    lecture.mcqs.map((mcq) => ({
      ...mcq,
      lectureId: lecture.id,
      lectureTitle: lecture.title,
    }))
  );

  const totalMCQs = allMCQs.length;
  const totalLectures = filteredLectures.length;

  if (!isAuthenticated()) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background pb-16 md:pb-0">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="px-4 py-3 sm:px-6 sm:py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <BookOpen className="w-5 h-5 sm:w-6 sm:h-6 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <h1 className="text-lg sm:text-2xl font-bold truncate">MCQ Library</h1>
                <p className="text-xs sm:text-sm text-muted-foreground truncate">
                  All your questions
                </p>
              </div>
            </div>
            <Link href="/dashboard" className="sm:flex-shrink-0">
              <Button variant="outline" size="sm" className="text-xs sm:text-sm">Back</Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 py-6 sm:px-6 sm:py-8 max-w-7xl mx-auto">
        {/* Stats Section */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-4 mb-6 sm:mb-8">
          <Card>
            <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-4">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Total Questions
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-4">
              <p className="text-2xl sm:text-3xl font-bold">{totalMCQs}</p>
              <p className="text-xs text-muted-foreground mt-1">MCQs</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-4">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Lectures
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-4">
              <p className="text-2xl sm:text-3xl font-bold">{totalLectures}</p>
              <p className="text-xs text-muted-foreground mt-1">Lectures</p>
            </CardContent>
          </Card>

          <Card className="col-span-2 sm:col-span-1">
            <CardHeader className="pb-2 px-3 sm:px-6 pt-3 sm:pt-4">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">
                Status
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 sm:px-6 pb-3 sm:pb-4">
              <p className="text-2xl sm:text-3xl font-bold text-green-500">✓</p>
              <p className="text-xs text-muted-foreground mt-1">Ready</p>
            </CardContent>
          </Card>
        </div>

        {/* Search and Filter */}
        <div className="mb-5 sm:mb-6 flex gap-2 sm:gap-4 items-center">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search MCQs..."
              className="w-full pl-10 pr-4 py-2 text-sm sm:text-base rounded-lg border border-border bg-background text-foreground placeholder-muted-foreground"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as Tab)} className="mb-6">
          <TabsList className="grid w-full grid-cols-2 text-xs sm:text-sm">
            <TabsTrigger value="all">
              All ({totalMCQs})
            </TabsTrigger>
            <TabsTrigger value="uploaded">
              Lectures ({totalLectures})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="all" className="space-y-3 sm:space-y-4 mt-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : error ? (
              <Card className="border-destructive/50 bg-destructive/10">
                <CardContent className="pt-4 px-3 sm:px-6 pb-4 sm:pb-6">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-destructive mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="font-semibold text-sm">Error</p>
                      <p className="text-xs sm:text-sm text-muted-foreground break-words">{error}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : allMCQs.length === 0 ? (
              <Card>
                <CardContent className="pt-8 sm:pt-12 pb-8 sm:pb-12 px-4 sm:px-6 text-center">
                  <BookOpen className="w-10 sm:w-12 h-10 sm:h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                  <h3 className="font-semibold mb-2 text-sm sm:text-base">No MCQs yet</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                    Upload a lecture or paste content to generate MCQs
                  </p>
                  <Link href="/upload">
                    <Button size="sm" className="text-xs sm:text-sm">
                      <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 mr-2" />
                      Create MCQs
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {allMCQs.map((mcq, idx) => (
                  <MCQCard
                    key={idx}
                    mcq={mcq}
                    lectureTitle={mcq.lectureTitle}
                    lectureId={mcq.lectureId}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="uploaded" className="space-y-4 sm:space-y-6 mt-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : filteredLectures.length === 0 ? (
              <Card>
                <CardContent className="pt-8 sm:pt-12 pb-8 sm:pb-12 px-4 sm:px-6 text-center">
                  <BookOpen className="w-10 sm:w-12 h-10 sm:h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                  <h3 className="font-semibold mb-2 text-sm sm:text-base">No lectures</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground mb-4">
                    You haven't uploaded any lectures yet
                  </p>
                  <Link href="/upload">
                    <Button size="sm" className="text-xs sm:text-sm">
                      <Sparkles className="w-3 h-3 sm:w-4 sm:h-4 mr-2" />
                      Upload Lecture
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4 sm:space-y-6">
                {filteredLectures.map((lecture) => (
                  <Card key={lecture.id} className="overflow-hidden">
                    <CardHeader className="bg-gradient-to-r from-primary/10 to-primary/5 border-b px-3 sm:px-6 py-3 sm:py-4">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                        <div className="min-w-0">
                          <CardTitle className="flex items-center gap-2 text-base sm:text-lg truncate">
                            <BookOpen className="w-4 h-4 flex-shrink-0" />
                            <span className="truncate">{lecture.title}</span>
                          </CardTitle>
                          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
                            {lecture.mcqs.length} questions
                          </p>
                        </div>
                        <Badge variant="secondary" className="text-xs whitespace-nowrap flex-shrink-0">
                          {new Date(lecture.createdAt).toLocaleDateString()}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-3 sm:pt-4 px-3 sm:px-6 pb-3 sm:pb-4 space-y-3">
                      {lecture.mcqs.map((mcq, idx) => (
                        <MCQCard
                          key={idx}
                          mcq={mcq}
                          lectureTitle={lecture.title}
                          lectureId={lecture.id}
                        />
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
