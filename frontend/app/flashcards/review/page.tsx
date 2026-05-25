"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getDueFlashcards, reviewFlashcard, FlashcardOut, getLectures, LectureOut } from "@/lib/api";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, RotateCcw, X, AlertCircle } from "lucide-react";

const RATING_CONFIG = [
  { rating: 1, label: "Again", emoji: "🔴", description: "Didn't know it",        key: "1", color: "bg-red-600 hover:bg-red-500 active:bg-red-700" },
  { rating: 2, label: "Hard",  emoji: "🟠", description: "Struggled",             key: "2", color: "bg-orange-600 hover:bg-orange-500 active:bg-orange-700" },
  { rating: 3, label: "Good",  emoji: "🟢", description: "Knew it",               key: "3", color: "bg-green-600 hover:bg-green-500 active:bg-green-700" },
  { rating: 4, label: "Easy",  emoji: "⚡", description: "Too easy",              key: "4", color: "bg-blue-600 hover:bg-blue-500 active:bg-blue-700" },
];

const CARD_TYPE_COLORS: Record<string, string> = {
  concept: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  definition: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  mechanism: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  comparison: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  clinical: "bg-red-500/10 text-red-500 border-red-500/20",
};

import { Skeleton } from "@/components/ui/skeleton";

function ReviewSkeleton() {
  return (
    <div className="min-h-screen bg-background flex flex-col pb-32 md:pb-0 animate-pulse">
      <AppHeader activePage="Flashcards" />
      <div className="px-4 py-3 flex items-center gap-4 border-b border-border">
        <div className="h-8 w-8 bg-muted rounded-md" />
        <div className="h-2 flex-1 bg-muted rounded-full" />
        <div className="h-4 w-12 bg-muted rounded-md" />
      </div>
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl min-h-[340px] flex flex-col p-6 sm:p-8 border border-border rounded-xl">
          <div className="flex items-center justify-between mb-6">
            <div className="h-5 w-20 bg-muted rounded-full" />
            <div className="h-4 w-32 bg-muted" />
          </div>
          <div className="flex-1 flex flex-col items-center justify-center space-y-4">
            <div className="h-6 w-3/4 bg-muted rounded" />
            <div className="h-6 w-1/2 bg-muted rounded" />
          </div>
          <div className="mt-6 flex justify-center">
            <div className="h-10 w-40 bg-muted rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}

function FlashcardReviewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const documentId = searchParams.get("document_id")
    ? Number(searchParams.get("document_id"))
    : undefined;

  const [cards, setCards] = useState<FlashcardOut[]>([]);
  const [lectureTitle, setLectureTitle] = useState<string>("");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, time: 0, ratings: [] as number[] });
  const [hasAnyCards, setHasAnyCards] = useState(false);

  const cardStartTime = useRef<number>(Date.now());
  const sessionStart = useRef<number>(Date.now());

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/auth"); return; }
    setLoading(true);
    setError("");

    const dataPromises: [Promise<any>, Promise<any>?] = [
      getDueFlashcards(documentId, 50),
      documentId ? getLectures() : Promise.resolve(null)
    ];

    Promise.all(dataPromises)
      .then(([res, lecRes]) => {
        const fetchedCards = res.data.cards || [];
        setCards(fetchedCards);
        setHasAnyCards(fetchedCards.length > 0 || (res.data as any).total_cards > 0);
        
        if (lecRes && documentId) {
          const lec = (lecRes.data as LectureOut[]).find(l => l.id === documentId);
          if (lec) setLectureTitle(lec.title);
        }
        
        setLoading(false);
      })
      .catch((err) => {
        setError("Could not load flashcards. Check your connection.");
        setLoading(false);
      });
  }, [documentId, router]);

  const currentCard = cards[currentIndex];

  const handleShowAnswer = useCallback(() => setFlipped(true), []);

  const handleRate = useCallback(async (rating: number) => {
    if (!currentCard || submitting) return;
    const elapsed = Math.round((Date.now() - cardStartTime.current) / 1000);
    setSubmitting(true);
    try {
      await reviewFlashcard(currentCard.id, rating, elapsed);
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
    setSessionStats((prev) => ({
      reviewed: prev.reviewed + 1,
      time: Math.round((Date.now() - sessionStart.current) / 1000),
      ratings: [...prev.ratings, rating],
    }));
    if (currentIndex + 1 >= cards.length) {
      setDone(true);
    } else {
      setCurrentIndex((i) => i + 1);
      setFlipped(false);
      cardStartTime.current = Date.now();
    }
  }, [currentCard, currentIndex, cards.length, submitting]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") { if (!flipped) handleShowAnswer(); }
      if (flipped && ["1", "2", "3", "4"].includes(e.key)) handleRate(Number(e.key));
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flipped, handleShowAnswer, handleRate]);

  if (loading) {
    return <ReviewSkeleton />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader activePage="Flashcards" />
        <div className="flex flex-col items-center justify-center gap-4 py-32 text-foreground">
          <AlertCircle className="w-12 h-12 text-destructive" />
          <h2 className="text-2xl font-bold">Something went wrong</h2>
          <p className="text-muted-foreground text-sm max-w-md text-center">{error}</p>
          <Button onClick={() => router.push("/flashcards")}>Back to Flashcards</Button>
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <AppHeader activePage="Flashcards" />
        <div className="flex flex-col items-center justify-center gap-4 py-32 text-foreground px-4">
          <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          <h2 className="text-2xl font-bold">
            {hasAnyCards ? "All caught up!" : "No flashcards yet"}
          </h2>
          <p className="text-muted-foreground text-sm max-w-sm text-center">
            {hasAnyCards
              ? "All cards reviewed for today. Great work! Come back tomorrow."
              : "Upload a lecture and generate flashcards first, then review them here."}
          </p>
          <div className="flex gap-3">
            <Button onClick={() => router.push("/flashcards")}>Back to Hub</Button>
            {!hasAnyCards && (
              <Button variant="outline" onClick={() => router.push("/upload")}>
                Upload a Lecture
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (done) {
    const avgRating = sessionStats.ratings.length
      ? (sessionStats.ratings.reduce((a, b) => a + b, 0) / sessionStats.ratings.length).toFixed(1)
      : "—";
    const mins = Math.floor(sessionStats.time / 60);
    const secs = sessionStats.time % 60;

    return (
      <div className="min-h-screen bg-background">
        <AppHeader activePage="Flashcards" />
        <div className="flex flex-col items-center justify-center gap-6 py-20 px-6 text-foreground">
          <div className="text-5xl">🎉</div>
          <h2 className="text-3xl font-bold">Session Complete!</h2>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <div className="text-3xl font-bold text-primary">{sessionStats.reviewed}</div>
              <div className="text-muted-foreground text-sm">Cards reviewed</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">{mins}m {secs}s</div>
              <div className="text-muted-foreground text-sm">Time spent</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-primary">{avgRating}</div>
              <div className="text-muted-foreground text-sm">Avg rating</div>
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={() => router.push("/flashcards")}>Back to Hub</Button>
            <Button
              variant="outline"
              onClick={() => {
                setDone(false);
                setCurrentIndex(0);
                setFlipped(false);
                setSessionStats({ reviewed: 0, time: 0, ratings: [] });
                sessionStart.current = Date.now();
                cardStartTime.current = Date.now();
                getDueFlashcards(documentId, 50).then((r) => setCards(r.data.cards));
              }}
            >
              <RotateCcw className="w-4 h-4 mr-2" />
              Review More
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const progress = Math.round((currentIndex / cards.length) * 100);

  return (
    <div className="min-h-screen bg-background flex flex-col pb-32 md:pb-0">
      <AppHeader activePage="Flashcards" />

      {/* Progress bar */}
      <div className="px-4 py-3 flex items-center gap-4 border-b border-border bg-card/50 backdrop-blur-sm sticky top-14 z-40">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/flashcards")}
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-end mb-1">
            <span className="text-[10px] font-bold text-primary uppercase tracking-widest truncate">
              {lectureTitle || "Review Session"}
            </span>
            <span className="text-muted-foreground text-[10px] font-mono shrink-0">
              {currentIndex + 1} / {cards.length}
            </span>
          </div>
          <Progress value={progress} className="h-1" />
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 max-w-4xl mx-auto w-full">
        <div className="w-full" style={{ perspective: "1200px" }}>
          <div
            className="relative w-full transition-all duration-500 ease-in-out"
            style={{
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              minHeight: "400px",
            }}
          >
            {/* Front Side */}
            <Card
              className="absolute inset-0 flex flex-col shadow-xl border-border/50"
              style={{ backfaceVisibility: "hidden" }}
            >
              <CardContent className="flex-1 flex flex-col p-6 sm:p-10">
                <div className="flex items-center justify-between mb-8">
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase font-bold tracking-wider ${CARD_TYPE_COLORS[currentCard.card_type] ?? "border-border text-muted-foreground"}`}
                  >
                    {currentCard.card_type}
                  </Badge>
                  <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">{currentCard.topic}</span>
                </div>
                <div className="flex-1 flex items-center justify-center py-10">
                  <p className="text-foreground text-2xl sm:text-3xl text-center leading-tight font-bold tracking-tight">
                    {currentCard.front}
                  </p>
                </div>
                <div className="mt-8 text-center">
                  <Button onClick={handleShowAnswer} className="h-14 px-12 text-lg font-bold rounded-2xl shadow-lg shadow-primary/20">
                    Show Answer
                  </Button>
                  <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-4">or press Space / Enter</p>
                </div>
              </CardContent>
            </Card>

            {/* Back Side */}
            <Card
              className="absolute inset-0 flex flex-col border-primary/20 shadow-2xl bg-card"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              <CardContent className="flex-1 flex flex-col p-6 sm:p-10 overflow-hidden">
                <div className="flex items-center justify-between mb-6 shrink-0">
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase font-bold tracking-wider ${CARD_TYPE_COLORS[currentCard.card_type] ?? "border-border text-muted-foreground"}`}
                  >
                    {currentCard.card_type}
                  </Badge>
                  <span className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">{currentCard.topic}</span>
                </div>

                <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar space-y-8">
                  {/* Question Reference */}
                  <div className="space-y-2 opacity-50">
                    <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Question</span>
                    <p className="text-foreground text-sm font-semibold leading-snug">{currentCard.front}</p>
                  </div>

                  {/* The Answer */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Answer</span>
                    <p className="text-foreground text-xl sm:text-2xl leading-relaxed font-bold tracking-tight">
                      {currentCard.back}
                    </p>
                  </div>

                  {currentCard.memory_tip && (
                    <div className="p-5 rounded-2xl bg-yellow-500/5 border border-yellow-500/10 shadow-inner">
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-yellow-500" />
                        <span className="text-[10px] font-bold text-yellow-600 dark:text-yellow-500 uppercase tracking-widest">Memory Engine</span>
                      </div>
                      <p className="text-yellow-700/90 dark:text-yellow-500/80 text-sm font-medium leading-relaxed italic">
                        "{currentCard.memory_tip}"
                      </p>
                    </div>
                  )}
                </div>

                {/* Rating buttons: 2×2 on mobile, 4-col on sm+ */}
                <div className="mt-8 grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
                  {RATING_CONFIG.map(({ rating, label, emoji, description, key, color }) => (
                    <button
                      key={rating}
                      onClick={() => handleRate(rating)}
                      disabled={submitting}
                      className={`${color} rounded-2xl flex flex-col items-center justify-center gap-1 py-4 sm:py-3 transition-all disabled:opacity-50 text-white shadow-md active:scale-95 touch-manipulation`}
                    >
                      <span className="text-2xl sm:text-xl leading-none">{emoji}</span>
                      <span className="font-bold text-sm">{label}</span>
                      <span className="text-[10px] opacity-70 font-medium">{description}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest mt-8">
          {flipped ? "Select difficulty to continue" : "Press Space to reveal"}
        </p>
      </div>
    </div>
  );
}

export default function FlashcardReviewPage() {
  return (
    <Suspense fallback={<ReviewSkeleton />}>
      <FlashcardReviewContent />
    </Suspense>
  );
}
