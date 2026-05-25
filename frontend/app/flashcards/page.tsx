"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Search,
  Plus,
  ArrowRight,
  Clock,
  CheckCircle2,
  Sparkles,
  Layers,
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
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/auth");
      return;
    }
    Promise.all([getFlashcardStats(), getFlashcardSchedule(), getLectures()])
      .then(([statsRes, schedRes, lecRes]) => {
        setStats(statsRes.data);
        setSchedule(schedRes.data.topics);
        const all = lecRes.data as LectureOut[];
        setLectures(all);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [router]);

  const filteredLectures = useMemo(() => {
    return lectures.filter((lec) =>
      lec.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [lectures, searchQuery]);

  if (loading) {
    return <FlashcardsSkeleton />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <AppHeader activePage="Flashcards" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-12 space-y-10">
        {/* Header Section */}
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
            Flashcards
          </h1>
          <p className="text-muted-foreground text-lg">
            Review and generate flashcards from your lectures.
          </p>
        </div>

        {/* Search & Actions */}
        <div className="flex flex-col sm:flex-row gap-4 items-center">
          <div className="relative flex-1 w-full group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground transition-colors group-focus-within:text-primary" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search lectures or flashcards..."
              className="pl-12 bg-card border-border h-12 rounded-xl text-foreground placeholder:text-muted-foreground focus:ring-primary/20 focus:border-primary/50 transition-all text-lg shadow-sm"
            />
          </div>
          <Button
            onClick={() => router.push("/upload")}
            className="h-12 px-6 rounded-xl bg-primary text-primary-foreground hover:opacity-90 font-medium gap-2 w-full sm:w-auto shadow-md"
          >
            <Plus className="w-5 h-5" />
            Upload Lecture
          </Button>
        </div>

        {/* Review Banner */}
        {stats && stats.cards_due_today > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-primary/10 border border-primary/20 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm"
          >
            <div className="flex items-center gap-4">
              <div className="p-4 bg-primary text-primary-foreground rounded-xl shadow-lg shadow-primary/20">
                <Sparkles className="w-8 h-8 animate-pulse" />
              </div>
              <div className="text-center md:text-left">
                <h2 className="text-2xl font-bold text-foreground">
                  {stats.cards_due_today} Cards Due Today
                </h2>
                <p className="text-muted-foreground">
                  Keep your memory sharp and maintain your streak!
                </p>
              </div>
            </div>
            <Button
              onClick={() => router.push("/flashcards/review")}
              size="lg"
              className="w-full md:w-auto h-14 px-10 rounded-xl bg-primary text-primary-foreground hover:scale-105 active:scale-95 transition-all shadow-xl shadow-primary/20 text-lg font-bold gap-2 group"
            >
              Start Review
              <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </motion.div>
        )}

        {/* Lecture Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <AnimatePresence mode="popLayout">
            {filteredLectures.map((lec) => {
              // Find matching stats in schedule or stats
              const lecStats = schedule.find(s => s.topic === lec.title) || 
                               stats?.topic_breakdown.find(b => b.topic === lec.title);
              
              const totalCards = lecStats?.total_cards ?? (lecStats as any)?.total ?? 0;
              const dueCount = (lecStats as any)?.due_count ?? (lecStats as any)?.due ?? 0;
              const mastery = lecStats ? (lecStats as any).retention_pct ?? 
                               (lecStats.total > 0 ? (lecStats.mastered / lecStats.total) * 100 : 0) : 0;
              
              return (
                <motion.div
                  key={lec.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  whileHover={{ y: -4 }}
                  transition={{ duration: 0.2 }}
                >
                  <Card className="bg-card border-border overflow-hidden group hover:border-primary/50 hover:bg-accent/50 transition-all duration-300 rounded-2xl h-full flex flex-col cursor-pointer"
                    onClick={() => router.push(`/flashcards/${lec.id}`)}
                  >
                    <CardContent className="p-6 flex flex-col h-full space-y-4">
                      <div className="flex justify-between items-start gap-4">
                        <div className="p-3 bg-muted rounded-xl text-primary group-hover:scale-110 transition-transform shadow-inner">
                          <BookOpen className="w-6 h-6" />
                        </div>
                        {totalCards > 0 && (
                          <div className="flex flex-col items-end gap-1.5">
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 px-3 py-1 font-semibold">
                              {Math.round(mastery)}% Mastery
                            </Badge>
                            {dueCount > 0 && (
                              <Badge className="bg-primary/10 text-primary border-primary/20 px-2 py-0.5 text-[10px] font-bold animate-pulse">
                                {dueCount} DUE
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="flex-1 space-y-2">
                        <h3 className="text-xl font-bold text-foreground leading-tight">
                          {lec.title}
                        </h3>
                        <div className="flex flex-wrap gap-x-4 gap-y-2 text-muted-foreground text-sm">
                          <span className="flex items-center gap-1.5">
                            <Layers className="w-4 h-4" />
                            {totalCards} cards
                          </span>
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-4 h-4" />
                            {totalCards > 0 ? "5m review" : "Not started"}
                          </span>
                        </div>
                      </div>

                      <div className="pt-4 flex items-center gap-2 border-t border-border">
                        <Button
                          variant="secondary"
                          className="flex-1 justify-between bg-muted hover:bg-accent text-foreground rounded-xl h-11 px-4 group/btn border-border"
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/flashcards/${lec.id}`);
                          }}
                        >
                          Open Workspace
                          <ArrowRight className="w-4 h-4 text-muted-foreground group-hover/btn:translate-x-1 transition-transform" />
                        </Button>
                        <Button
                          className={`rounded-xl h-11 px-4 transition-all ${
                            dueCount > 0 
                              ? "bg-primary text-primary-foreground hover:opacity-90 shadow-lg shadow-primary/20 scale-105" 
                              : "bg-primary text-primary-foreground hover:opacity-90"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/flashcards/review?document_id=${lec.id}`);
                          }}
                          disabled={totalCards === 0}
                        >
                          {dueCount > 0 && <Sparkles className="w-3.5 h-3.5 mr-1.5 animate-pulse" />}
                          Review
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Empty State */}
        {!loading && filteredLectures.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center space-y-6">
            <div className="p-6 bg-muted rounded-full">
              <Sparkles className="w-12 h-12 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">No lectures found</h2>
              <p className="text-muted-foreground max-w-sm">
                {searchQuery 
                  ? "We couldn't find any lectures matching your search." 
                  : "Upload your first lecture to start generating AI flashcards."}
              </p>
            </div>
            <Button
              onClick={() => router.push("/upload")}
              className="bg-primary text-primary-foreground hover:opacity-90 rounded-xl px-8 h-12 shadow-md"
            >
              Upload Lecture
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

