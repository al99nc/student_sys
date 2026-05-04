"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getDueFlashcards, reviewFlashcard, FlashcardOut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, RotateCcw, X } from "lucide-react";

const RATING_CONFIG = [
  { rating: 1, label: "Again",    emoji: "🔴", description: "Didn't know it",       key: "1", color: "bg-red-600 hover:bg-red-500" },
  { rating: 2, label: "Hard",     emoji: "🟠", description: "Knew it but struggled", key: "2", color: "bg-orange-600 hover:bg-orange-500" },
  { rating: 3, label: "Good",     emoji: "🟢", description: "Knew it",               key: "3", color: "bg-green-600 hover:bg-green-500" },
  { rating: 4, label: "Easy",     emoji: "⚡", description: "Too easy",             key: "4", color: "bg-blue-600 hover:bg-blue-500" },
];

const CARD_TYPE_COLORS: Record<string, string> = {
  concept: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  definition: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  mechanism: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  comparison: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  clinical: "bg-red-500/20 text-red-300 border-red-500/30",
};

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
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [sessionStats, setSessionStats] = useState({ reviewed: 0, time: 0, ratings: [] as number[] });

  const cardStartTime = useRef<number>(Date.now());
  const sessionStart = useRef<number>(Date.now());

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/auth"); return; }
    getDueFlashcards(documentId, 50)
      .then((res) => {
        setCards(res.data.cards);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [documentId, router]);

  const currentCard = cards[currentIndex];

  const handleShowAnswer = useCallback(() => {
    setFlipped(true);
  }, []);

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

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "Enter") {
        if (!flipped) { handleShowAnswer(); }
      }
      if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        handleRate(Number(e.key));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [flipped, handleShowAnswer, handleRate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center text-white/40">
        Loading cards...
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="min-h-screen bg-[#0a0a1a] flex flex-col items-center justify-center gap-4 text-white">
        <CheckCircle2 className="w-12 h-12 text-green-400" />
        <h2 className="text-2xl font-bold">All caught up!</h2>
        <p className="text-white/50">No cards due right now.</p>
        <Button onClick={() => router.push("/flashcards")} className="bg-indigo-600 hover:bg-indigo-500">
          Back to Flashcards
        </Button>
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
      <div className="min-h-screen bg-[#0a0a1a] flex flex-col items-center justify-center gap-6 text-white p-8">
        <div className="text-5xl">🎉</div>
        <h2 className="text-3xl font-bold">Session Complete!</h2>
        <div className="grid grid-cols-3 gap-6 text-center">
          <div>
            <div className="text-3xl font-bold text-indigo-400">{sessionStats.reviewed}</div>
            <div className="text-white/50 text-sm">Cards reviewed</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-indigo-400">{mins}m {secs}s</div>
            <div className="text-white/50 text-sm">Time spent</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-indigo-400">{avgRating}</div>
            <div className="text-white/50 text-sm">Avg rating</div>
          </div>
        </div>
        <div className="flex gap-3">
          <Button onClick={() => router.push("/flashcards")} className="bg-indigo-600 hover:bg-indigo-500">
            Back to Hub
          </Button>
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
            className="border-white/20 text-white hover:bg-white/10"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Review More
          </Button>
        </div>
      </div>
    );
  }

  const progress = Math.round((currentIndex / cards.length) * 100);

  return (
    <div className="min-h-screen bg-[#0a0a1a] flex flex-col">
      {/* Top bar */}
      <div className="px-4 py-3 flex items-center gap-4 border-b border-white/10">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/flashcards")}
          className="text-white/50 hover:text-white p-1"
        >
          <X className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <Progress value={progress} className="h-2 bg-white/10" />
        </div>
        <span className="text-white/50 text-sm shrink-0">
          {currentIndex + 1} / {cards.length}
        </span>
      </div>

      {/* Card area */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-2xl" style={{ perspective: "1200px" }}>
          {/* Card with flip animation */}
          <div
            className="relative w-full"
            style={{
              transformStyle: "preserve-3d",
              transition: "transform 0.4s ease",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
              minHeight: "340px",
            }}
          >
            {/* Front face */}
            <div
              className="absolute inset-0 rounded-2xl bg-[#0f0f1f] border border-white/10 p-8 flex flex-col"
              style={{ backfaceVisibility: "hidden" }}
            >
              <div className="flex items-center justify-between mb-6">
                <Badge
                  variant="outline"
                  className={`text-xs capitalize ${CARD_TYPE_COLORS[currentCard.card_type] ?? "border-white/20 text-white/50"}`}
                >
                  {currentCard.card_type}
                </Badge>
                <span className="text-white/30 text-xs">{currentCard.topic}</span>
              </div>
              <div className="flex-1 flex items-center justify-center">
                <p className="text-white text-xl text-center leading-relaxed font-medium">
                  {currentCard.front}
                </p>
              </div>
              <div className="mt-6 text-center">
                <Button
                  onClick={handleShowAnswer}
                  className="bg-indigo-600 hover:bg-indigo-500 px-10 py-3 text-base"
                >
                  Show Answer
                </Button>
                <p className="text-white/30 text-xs mt-2">or press Space / Enter</p>
              </div>
            </div>

            {/* Back face */}
            <div
              className="absolute inset-0 rounded-2xl bg-[#0f0f1f] border border-indigo-500/30 p-8 flex flex-col"
              style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
            >
              <div className="flex items-center justify-between mb-4">
                <Badge
                  variant="outline"
                  className={`text-xs capitalize ${CARD_TYPE_COLORS[currentCard.card_type] ?? "border-white/20 text-white/50"}`}
                >
                  {currentCard.card_type}
                </Badge>
                <span className="text-white/30 text-xs">{currentCard.topic}</span>
              </div>
              <div className="flex-1 overflow-y-auto">
                <p className="text-white text-base leading-relaxed">{currentCard.back}</p>
                {currentCard.memory_tip && (
                  <div className="mt-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                    <p className="text-yellow-300 text-sm">
                      <span className="font-semibold">💡 Memory tip:</span> {currentCard.memory_tip}
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-4 gap-2">
                {RATING_CONFIG.map(({ rating, label, emoji, description, key, color }) => (
                  <button
                    key={rating}
                    onClick={() => handleRate(rating)}
                    disabled={submitting}
                    className={`${color} rounded-xl p-3 flex flex-col items-center gap-1 transition-all disabled:opacity-50 text-white`}
                  >
                    <span className="text-xl">{emoji}</span>
                    <span className="font-semibold text-sm">{label}</span>
                    <span className="text-xs opacity-70 hidden sm:block">{description}</span>
                    <span className="text-xs opacity-50 font-mono">[{key}]</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <p className="text-white/20 text-xs mt-6">
          {flipped ? "Press 1–4 to rate" : "Press Space to reveal"}
        </p>
      </div>
    </div>
  );
}

export default function FlashcardReviewPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-[#0a0a1a] flex items-center justify-center text-white/40">
        Loading...
      </div>
    }>
      <FlashcardReviewContent />
    </Suspense>
  );
}
