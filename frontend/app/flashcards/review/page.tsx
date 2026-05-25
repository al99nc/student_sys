"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getDueFlashcards, reviewFlashcard, FlashcardOut } from "@/lib/api";
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
  concept:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
  definition: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  mechanism:  "bg-orange-500/20 text-orange-300 border-orange-500/30",
  comparison: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  clinical:   "bg-red-500/20 text-red-300 border-red-500/30",
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
    getDueFlashcards(documentId, 50)
      .then((res) => {
        const fetchedCards = res.data.cards || [];
        setCards(fetchedCards);
        setHasAnyCards(fetchedCards.length > 0 || (res.data as any).total_cards > 0);
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
      <div className="px-4 py-3 flex items-center gap-4 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/flashcards")}
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <Progress value={progress} className="h-2" />
        </div>
        <span className="text-muted-foreground text-sm shrink-0">
          {currentIndex + 1} / {cards.length}
        </span>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-2xl" style={{ perspective: "1200px" }}>
          <div
            className="relative w-full"
            style={{
              transformStyle: "preserve-3d",
              transition: "transform 0.4s ease",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              minHeight: "340px",
            }}
          >
            {/* Front */}
            <Card
              className="absolute inset-0 flex flex-col"
              style={{ backfaceVisibility: "hidden" }}
            >
              <CardContent className="flex-1 flex flex-col p-6 sm:p-8">
                <div className="flex items-center justify-between mb-6">
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${CARD_TYPE_COLORS[currentCard.card_type] ?? "border-border text-muted-foreground"}`}
                  >
                    {currentCard.card_type}
                  </Badge>
                  <span className="text-muted-foreground text-xs">{currentCard.topic}</span>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-foreground text-xl text-center leading-relaxed font-medium">
                    {currentCard.front}
                  </p>
                </div>
                <div className="mt-6 text-center">
                  <Button onClick={handleShowAnswer} className="px-10 py-3 text-base">
                    Show Answer
                  </Button>
                  <p className="text-muted-foreground text-xs mt-2">or press Space / Enter</p>
                </div>
              </CardContent>
            </Card>

            {/* Back */}
            <Card
              className="absolute inset-0 flex flex-col border-primary/30"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              <CardContent className="flex-1 flex flex-col p-6 sm:p-8">
                <div className="flex items-center justify-between mb-4">
                  <Badge
                    variant="outline"
                    className={`text-xs capitalize ${CARD_TYPE_COLORS[currentCard.card_type] ?? "border-border text-muted-foreground"}`}
                  >
                    {currentCard.card_type}
                  </Badge>
                  <span className="text-muted-foreground text-xs">{currentCard.topic}</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <p className="text-foreground text-base leading-relaxed">{currentCard.back}</p>
                  {currentCard.memory_tip && (
                    <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                      <p className="text-yellow-300 text-sm">
                        <span className="font-semibold">💡 Memory tip:</span> {currentCard.memory_tip}
                      </p>
                    </div>
                  )}
                </div>

                {/* Rating buttons: 2×2 on mobile, 4-col on sm+ */}
                <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {RATING_CONFIG.map(({ rating, label, emoji, description, key, color }) => (
                    <button
                      key={rating}
                      onClick={() => handleRate(rating)}
                      disabled={submitting}
                      className={`${color} rounded-xl flex flex-col items-center justify-center gap-1.5 py-5 sm:py-3 transition-all disabled:opacity-50 text-white touch-manipulation`}
                    >
                      <span className="text-2xl sm:text-xl leading-none">{emoji}</span>
                      <span className="font-semibold text-base sm:text-sm">{label}</span>
                      <span className="text-xs opacity-70">{description}</span>
                      <span className="text-xs opacity-40 font-mono hidden sm:block">[{key}]</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <p className="text-muted-foreground text-xs mt-6">
          {flipped ? "Press 1–4 to rate" : "Press Space to reveal"}
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
