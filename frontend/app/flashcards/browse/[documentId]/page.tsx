"use client";
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { getDocumentFlashcards, generateFlashcards, FlashcardOut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, ChevronDown, ChevronUp, RefreshCw, Search, Sparkles } from "lucide-react";

const CARD_TYPE_COLORS: Record<string, string> = {
  concept:    "bg-purple-500/20 text-purple-300 border-purple-500/30",
  definition: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  mechanism:  "bg-orange-500/20 text-orange-300 border-orange-500/30",
  comparison: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
  clinical:   "bg-red-500/20 text-red-300 border-red-500/30",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy:   "text-green-400 border-green-400/30",
  medium: "text-yellow-400 border-yellow-400/30",
  hard:   "text-red-400 border-red-400/30",
};

import { Skeleton } from "@/components/ui/skeleton";

export default function BrowseFlashcardsPage() {
  const router = useRouter();
  const params = useParams();
  const documentId = Number(params.documentId);

  const [cards, setCards] = useState<FlashcardOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<string>("");
  const [filterDiff, setFilterDiff] = useState<string>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const fetchCards = () => {
    setLoading(true);
    getDocumentFlashcards(documentId, {
      card_type: filterType || undefined,
      difficulty: filterDiff || undefined,
    })
      .then((res) => setCards(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/auth"); return; }
    fetchCards();
  }, [documentId, filterType, filterDiff]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      await generateFlashcards(documentId);
      fetchCards();
    } catch (e) {
      console.error(e);
    } finally {
      setGenerating(false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filtered = cards.filter(
    (c) =>
      !search ||
      c.front.toLowerCase().includes(search.toLowerCase()) ||
      c.back.toLowerCase().includes(search.toLowerCase()),
  );

  const topics = [...new Set(cards.map((c) => c.topic))];
  const cardTypes = ["concept", "definition", "mechanism", "comparison", "clinical"];
  const difficulties = ["easy", "medium", "hard"];

  return (
    <div className="min-h-screen bg-[#0a0a1a] text-white">
      <AppHeader activePage="Flashcards" />
      <main className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/flashcards")}
            className="text-white/50 hover:text-white p-1"
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-white">Browse Flashcards</h1>
            <p className="text-white/40 text-sm">{loading ? "..." : `${filtered.length} cards`}</p>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={generating || loading}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm"
          >
            {generating ? (
              <><RefreshCw className="w-4 h-4 mr-2 animate-spin" />Generating...</>
            ) : (
              <><Sparkles className="w-4 h-4 mr-2" />Generate</>
            )}
          </Button>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search cards..."
              className="pl-9 bg-white/5 border-white/10 text-white placeholder:text-white/30"
            />
          </div>
          <Skeleton className={loading ? "h-10 w-24 bg-white/5" : "hidden"} />
          <Skeleton className={loading ? "h-10 w-32 bg-white/5" : "hidden"} />
          {!loading && (
            <>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="bg-white/5 border border-white/10 text-white/70 text-sm rounded-md px-3 py-2 focus:outline-none"
              >
                <option value="">All types</option>
                {cardTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <select
                value={filterDiff}
                onChange={(e) => setFilterDiff(e.target.value)}
                className="bg-white/5 border border-white/10 text-white/70 text-sm rounded-md px-3 py-2 focus:outline-none"
              >
                <option value="">All difficulty</option>
                {difficulties.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </>
          )}
        </div>

        {/* Card list */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Card key={i} className="bg-[#0f0f1f] border-white/10">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-16 bg-white/10" />
                    <Skeleton className="h-5 w-16 bg-white/10" />
                    <Skeleton className="h-4 w-24 bg-white/10" />
                  </div>
                  <Skeleton className="h-4 w-full bg-white/10" />
                  <Skeleton className="h-4 w-2/3 bg-white/10" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-white/30">
            <p className="mb-4">No flashcards yet for this lecture.</p>
            <Button onClick={handleGenerate} disabled={generating} className="bg-indigo-600 hover:bg-indigo-500">
              <Sparkles className="w-4 h-4 mr-2" />
              Generate Flashcards
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((card) => {
              const isOpen = expanded.has(card.id);
              return (
                <Card
                  key={card.id}
                  className="bg-[#0f0f1f] border-white/10 hover:border-white/20 transition-colors cursor-pointer"
                  onClick={() => toggleExpand(card.id)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge
                            variant="outline"
                            className={`text-xs capitalize ${CARD_TYPE_COLORS[card.card_type] ?? "border-white/20 text-white/50"}`}
                          >
                            {card.card_type}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={`text-xs capitalize border ${DIFFICULTY_COLORS[card.difficulty] ?? "text-white/40 border-white/20"}`}
                          >
                            {card.difficulty}
                          </Badge>
                          <span className="text-white/30 text-xs truncate">{card.topic}</span>
                        </div>
                        <p className="text-white/90 text-sm leading-relaxed">{card.front}</p>
                      </div>
                      <div className="text-white/30 shrink-0 mt-0.5">
                        {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <p className="text-white/80 text-sm leading-relaxed">{card.back}</p>
                        {card.memory_tip && (
                          <div className="mt-3 p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                            <p className="text-yellow-300 text-xs">
                              <span className="font-semibold">💡</span> {card.memory_tip}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
