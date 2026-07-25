"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import {
  getDocumentFlashcards,
  generateFlashcards,
  updateFlashcard,
  deleteFlashcard,
  createManualFlashcard,
  FlashcardOut,
  getLectures,
  LectureOut,
  getFlashcardSchedule,
  updateStudyTime,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  ArrowLeft,
  Search,
  Plus,
  Sparkles,
  Play,
  Settings2,
  MoreVertical,
  Star,
  Trash2,
  RefreshCw,
  Edit2,
  ChevronDown,
  ChevronUp,
  Brain,
  Zap,
  Check,
  X,
  PlusCircle,
  Wand2,
  Clock,
  History,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";

const CARD_TYPE_COLORS: Record<string, string> = {
  concept: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  definition: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  mechanism: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  comparison: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
  clinical: "bg-red-500/10 text-red-500 border-red-500/20",
};

export default function FlashcardWorkspacePage() {
  const router = useRouter();
  const params = useParams();
  const id = Number(params.id);

  const [lecture, setLecture] = useState<LectureOut & { study_time_seconds?: number } | null>(null);
  const [cards, setCards] = useState<FlashcardOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [stats, setStats] = useState<{ mastery: number; total: number } | null>(null);
  const [isGenModalOpen, setIsGenModalOpen] = useState(false);

  // Timer logic
  const [secondsSpent, setSecondsSpent] = useState(0);
  const secondsSpentRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsSpent((s) => {
        const next = s + 1;
        secondsSpentRef.current = next;
        return next;
      });
    }, 1000);

    // Save every 30s
    const saveInterval = setInterval(() => {
      if (secondsSpentRef.current > 0) {
        updateStudyTime(id, secondsSpentRef.current);
        setSecondsSpent(0);
        secondsSpentRef.current = 0;
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      clearInterval(saveInterval);
      if (secondsSpentRef.current > 0) {
        updateStudyTime(id, secondsSpentRef.current);
      }
    };
  }, [id]);

  const fetchWorkspace = useCallback(async () => {
    try {
      const [lecRes, cardRes, schedRes] = await Promise.all([
        getLectures(),
        getDocumentFlashcards(id),
        getFlashcardSchedule(),
      ]);

      const currentLec = (lecRes.data as LectureOut[]).find((l) => l.id === id);
      if (currentLec) setLecture(currentLec);

      setCards(cardRes.data);

      const lecStats = schedRes.data.topics.find((t) => t.topic === currentLec?.title);
      if (lecStats) {
        setStats({
          mastery: lecStats.retention_pct,
          total: lecStats.total_cards,
        });
      }

      // Empty workspace onboarding
      if (cardRes.data.length === 0 && !localStorage.getItem(`fc_onboard_seen_${id}`)) {
        toast("Create your AI flashcards", {
          description: "Adjust your AI tone and generate personalized flashcards from this lecture.",
          action: {
            label: "Generate with AI",
            onClick: () => setIsGenModalOpen(true),
          },
          duration: 10000,
        });
        localStorage.setItem(`fc_onboard_seen_${id}`, "true");
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/auth");
      return;
    }
    fetchWorkspace();
  }, [fetchWorkspace, router]);

  const filteredCards = useMemo(() => {
    return cards.filter(
      (c) =>
        c.front.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.back.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [cards, searchQuery]);

  const handleToggleStar = async (card: FlashcardOut) => {
    try {
      const updated = await updateFlashcard(card.id, { is_starred: !card.is_starred });
      setCards((prev) => prev.map((c) => (c.id === card.id ? updated.data : c)));
      toast.success(card.is_starred ? "Removed from favorites" : "Added to favorites");
    } catch (e) {
      toast.error("Failed to update card");
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await deleteFlashcard(cardId);
      setCards((prev) => prev.filter((c) => c.id !== cardId));
      toast.success("Card deleted");
    } catch (e) {
      toast.error("Failed to delete card");
    }
  };

  const handleUpdateCard = async (cardId: string, data: Partial<FlashcardOut>) => {
    try {
      const updated = await updateFlashcard(cardId, data);
      setCards((prev) => prev.map((c) => (c.id === cardId ? updated.data : c)));
      setEditingCardId(null);
      toast.success("Card updated");
    } catch (e) {
      toast.error("Failed to update card");
    }
  };

  const handleCreateManualCard = async (data: Partial<FlashcardOut>) => {
    try {
      const updated = await createManualFlashcard(id, data);
      setCards((prev) => [...prev, updated.data]);
      toast.success("Card created successfully");
    } catch (e) {
      toast.error("Failed to create card");
    }
  };

  const handleGenerate = async (settings: any) => {
    setIsGenerating(true);
    try {
      await generateFlashcards(id, settings.mode || "revision");
      await fetchWorkspace();
      toast.success("New flashcards generated!");
    } catch (e) {
      toast.error("Generation failed");
    } finally {
      setIsGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppHeader activePage="Flashcards" />
        <div className="max-w-6xl mx-auto px-4 py-12 space-y-8 animate-pulse">
          <div className="h-32 bg-card rounded-3xl border border-border shadow-sm" />
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-card rounded-xl border border-border shadow-sm" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const formatStudyTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    const remainingMins = mins % 60;
    return `${hours}h ${remainingMins}m`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-20">
      <AppHeader activePage="Flashcards" />

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 md:py-12 space-y-12">
        {/* Workspace Header */}
        <div className="relative overflow-hidden bg-card border border-border p-8 rounded-[2rem] space-y-6 shadow-sm">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div className="space-y-3">
              <Button
                variant="ghost"
                className="text-muted-foreground hover:text-foreground p-0 h-auto gap-2 mb-2"
                onClick={() => router.push("/flashcards")}
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Flashcards
              </Button>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground">
                {lecture?.title || "Lecture Workspace"}
              </h1>
              <div className="flex flex-wrap gap-3">
                <Badge variant="secondary" className="bg-muted text-muted-foreground border-border">
                  {cards.length} cards
                </Badge>
                {stats && (
                  <Badge variant="outline" className="bg-emerald-500/10 border-emerald-500/20 text-emerald-500 font-semibold">
                    {Math.round(stats.mastery)}% Mastery
                  </Badge>
                )}
                {lecture?.study_time_seconds !== undefined && (
                  <Badge variant="outline" className="bg-blue-500/10 border-blue-500/20 text-blue-500 flex gap-1.5 items-center font-semibold">
                    <Clock className="w-3.5 h-3.5" />
                    {formatStudyTime(lecture.study_time_seconds)}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {stats && (
            <div className="space-y-2 pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Review Progress</span>
                <span className="text-emerald-500 font-bold">{Math.round(stats.mastery)}%</span>
              </div>
              <Progress value={stats.mastery} className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-emerald-500 rounded-full shadow-[0_0_10px_rgba(16,185,129,0.3)]" />
              </Progress>
            </div>
          )}
        </div>

        {/* Search and List */}
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
            <div className="relative flex-1 w-full group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground transition-colors group-focus-within:text-primary" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search within this lecture..."
                className="pl-12 bg-card border-border h-12 rounded-2xl text-foreground placeholder:text-muted-foreground focus:ring-primary/20 transition-all shadow-sm"
              />
            </div>
            <div className="flex gap-2">
            </div>
          </div>

          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {filteredCards.length > 0 ? (
                filteredCards.map((card) => (
                  <FlashcardListItem
                    key={card.id}
                    card={card}
                    isExpanded={expandedCardId === card.id}
                    isEditing={editingCardId === card.id}
                    onToggleExpand={() => setExpandedCardId(expandedCardId === card.id ? null : card.id)}
                    onToggleStar={() => handleToggleStar(card)}
                    onDelete={() => handleDeleteCard(card.id)}
                    onUpdate={(data) => handleUpdateCard(card.id, data)}
                    onSetEditing={() => setEditingCardId(card.id)}
                    onCancelEditing={() => setEditingCardId(null)}
                  />
                ))
              ) : (
                <div className="text-center py-20 bg-muted/30 rounded-3xl border border-dashed border-border space-y-8">
                  <div className="p-6 bg-muted/50 rounded-full w-fit mx-auto shadow-inner">
                    <Brain className="w-12 h-12 text-muted-foreground" />
                  </div>
                  <div className="space-y-2 max-w-sm mx-auto">
                    <p className="text-2xl font-bold text-foreground">
                      {searchQuery ? "No matches found" : "Empty Workspace"}
                    </p>
                    <p className="text-muted-foreground">
                      {searchQuery 
                        ? "Try different keywords to find what you're looking for." 
                        : "Start building your study system by generating AI cards or creating your own."}
                    </p>
                  </div>
                  {!searchQuery && cards.length === 0 && (
                    <div className="flex flex-col sm:flex-row justify-center gap-4 pt-4">
                       <AIContentGenerator 
                         onGenerate={handleGenerate} 
                         isGenerating={isGenerating} 
                         open={isGenModalOpen}
                         onOpenChange={setIsGenModalOpen}
                       />
                       <CreateCardDialog onCreate={handleCreateManualCard} />
                    </div>
                  )}
                </div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </main>

      {/* Mobile Sticky Review Button */}
      <div className="fixed bottom-6 left-4 right-4 md:hidden z-40">
        <Button
          onClick={() => router.push(`/flashcards/review?document_id=${id}`)}
          className="w-full bg-primary text-primary-foreground hover:opacity-90 h-14 rounded-2xl gap-2 font-bold shadow-xl"
          disabled={cards.length === 0}
        >
          <Play className="w-5 h-5 fill-current" />
          Review {cards.length} Cards
        </Button>
      </div>
    </div>
  );
}

function FlashcardListItem({
  card,
  isExpanded,
  isEditing,
  onToggleExpand,
  onToggleStar,
  onDelete,
  onUpdate,
  onSetEditing,
  onCancelEditing,
}: {
  card: FlashcardOut;
  isExpanded: boolean;
  isEditing: boolean;
  onToggleExpand: () => void;
  onToggleStar: () => void;
  onDelete: () => void;
  onUpdate: (data: Partial<FlashcardOut>) => void;
  onSetEditing: () => void;
  onCancelEditing: () => void;
}) {
  const [editFront, setEditFront] = useState(card.front);
  const [editBack, setEditBack] = useState(card.back);

  if (isEditing) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-accent/50 border border-primary/30 rounded-2xl p-6 space-y-4 shadow-inner"
      >
        <div className="space-y-2">
          <label className="text-xs font-bold text-primary uppercase tracking-wider">Front</label>
          <Input
            value={editFront}
            onChange={(e) => setEditFront(e.target.value)}
            className="bg-background border-border rounded-xl"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs font-bold text-primary uppercase tracking-wider">Back</label>
          <Input
            value={editBack}
            onChange={(e) => setEditBack(e.target.value)}
            className="bg-background border-border rounded-xl"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancelEditing} className="rounded-xl text-muted-foreground hover:text-foreground">
            Cancel
          </Button>
          <Button
            onClick={() => onUpdate({ front: editFront, back: editBack })}
            className="bg-primary text-primary-foreground hover:opacity-90 rounded-xl px-6"
          >
            Save Changes
          </Button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className={`group border transition-all duration-300 rounded-2xl shadow-sm ${
        isExpanded ? "bg-accent/50 border-primary/30" : "bg-card border-border hover:border-primary/30 hover:bg-accent/20"
      }`}
    >
        <div className="p-4 flex items-center gap-4 cursor-pointer" onClick={onToggleExpand}>
          <div className="flex-1 min-w-0 flex items-center gap-4">
            <Badge variant="outline" className={`hidden sm:flex shrink-0 font-medium ${CARD_TYPE_COLORS[card.card_type] || "bg-muted text-muted-foreground border-border"}`}>
              {card.card_type}
            </Badge>
            <p className="text-foreground/90 font-semibold group-hover:text-foreground transition-colors">
              {card.topic || card.front.substring(0, 60) + (card.front.length > 60 ? '...' : '')}
            </p>
          </div>

          <div className="flex items-center gap-1 sm:gap-3 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleStar();
              }}
              className={`p-2 rounded-xl transition-all ${
                card.is_starred ? "text-yellow-500 bg-yellow-500/10" : "text-muted-foreground/30 hover:text-yellow-500 hover:bg-yellow-500/5"
              }`}
            >
              <Star className={`w-5 h-5 ${card.is_starred ? "fill-current" : ""}`} />
            </button>
            
            <div className="hidden sm:flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetEditing();
                }}
                className="p-2 text-muted-foreground/40 hover:text-foreground hover:bg-muted rounded-xl transition-all"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm("Delete this card?")) onDelete();
                }}
                className="p-2 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/5 rounded-xl transition-all"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2 text-muted-foreground/30 group-hover:text-foreground transition-colors">
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </div>
          </div>
        </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-6 sm:px-12 pb-6 space-y-4">
              <div className="pt-4 border-t border-border/50 space-y-4">
                <div className="space-y-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Answer</span>
                  <p className="text-foreground/80 leading-relaxed text-lg font-medium">{card.back}</p>
                </div>
                {card.memory_tip && (
                  <div className="p-4 bg-yellow-500/5 border border-yellow-500/10 rounded-2xl flex gap-3 items-start shadow-inner">
                    <Zap className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="text-[10px] font-bold text-yellow-600/60 uppercase tracking-widest">Memory Engine</span>
                      <p className="text-yellow-700/80 dark:text-yellow-500/70 text-sm leading-relaxed font-medium">{card.memory_tip}</p>
                    </div>
                  </div>
                )}
                
                <div className="flex sm:hidden pt-4 gap-2 border-t border-border/50">
                  <Button variant="ghost" onClick={onSetEditing} className="flex-1 bg-muted rounded-xl text-foreground/70">
                    Edit
                  </Button>
                  <Button variant="ghost" onClick={onDelete} className="flex-1 bg-destructive/5 text-destructive rounded-xl hover:bg-destructive/10">
                    Delete
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function CreateCardDialog({ onCreate }: { onCreate: (data: Partial<FlashcardOut>) => void }) {
  const [open, setOpen] = useState(false);
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [type, setType] = useState("concept");

  const handleSubmit = () => {
    if (!front || !back) {
      toast.error("Please fill in both sides");
      return;
    }
    onCreate({ front, back, card_type: type });
    setFront("");
    setBack("");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:opacity-90 h-12 px-6 rounded-2xl gap-2 font-bold shadow-md">
          <Plus className="w-5 h-5" />
          Create Card
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-lg rounded-[2rem] shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <PlusCircle className="w-6 h-6 text-primary" />
            </div>
            Manual Creation
          </DialogTitle>
        </DialogHeader>

        <div className="py-6 space-y-6">
          <div className="space-y-4">
            <label className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Card Type</label>
            <div className="flex flex-wrap gap-2">
              {Object.keys(CARD_TYPE_COLORS).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-4 py-2 rounded-full border text-xs font-bold transition-all capitalize ${
                    type === t ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Front Side (Question)</label>
            <Input
              value={front}
              onChange={(e) => setFront(e.target.value)}
              placeholder="e.g. What is Mitochondrial DNA?"
              className="bg-muted border-border h-14 rounded-xl focus:ring-primary/20"
            />
          </div>

          <div className="space-y-4">
            <label className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Back Side (Answer)</label>
            <textarea
              value={back}
              onChange={(e) => setBack(e.target.value)}
              placeholder="e.g. Small circular chromosome found in mitochondria..."
              className="w-full bg-muted border border-border rounded-xl p-4 min-h-[120px] focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSubmit}
            className="w-full bg-primary text-primary-foreground hover:opacity-90 h-14 rounded-2xl text-lg font-bold shadow-lg"
          >
            Create Flashcard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AIContentGenerator({
  onGenerate,
  isGenerating,
  open: controlledOpen,
  onOpenChange: setControlledOpen,
}: {
  onGenerate: (settings: any) => void;
  isGenerating: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = setControlledOpen !== undefined ? setControlledOpen : setInternalOpen;

  const [tone, setTone] = useState("concise");
  const [type, setType] = useState("basic");
  const [count, setCount] = useState("25");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="bg-card border-border h-12 px-6 rounded-2xl gap-2 text-foreground/80 hover:bg-accent transition-all shadow-sm">
          <Sparkles className="w-5 h-5 text-primary" />
          Generate with AI
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border text-foreground max-w-lg rounded-[2rem] shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-xl">
              <Wand2 className="w-6 h-6 text-primary" />
            </div>
            AI Flashcard Factory
          </DialogTitle>
        </DialogHeader>

        <div className="py-6 space-y-8">
          <div className="space-y-4">
            <label className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Study Tone & Style</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "concise", label: "Concise", icon: "⚡" },
                { id: "beginner", label: "Beginner", icon: "🌱" },
                { id: "exam", label: "Exam Focus", icon: "🎓" },
                { id: "mnemonic", label: "Mnemonic", icon: "🧠" },
              ].map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => setTone(opt.id)}
                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left font-semibold ${
                    tone === opt.id ? "bg-primary border-primary text-primary-foreground" : "bg-muted border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  <span className="text-lg">{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Card Type</label>
            <div className="flex flex-wrap gap-2">
              {["Basic", "Reverse", "Cloze", "Mixed"].map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t.toLowerCase())}
                  className={`px-4 py-2 rounded-full border text-sm font-bold transition-all ${
                    type === t.toLowerCase() ? "bg-primary text-primary-foreground border-primary" : "bg-muted border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-4">
            <label className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Number of Cards</label>
            <div className="grid grid-cols-4 gap-2">
              {["10", "25", "50", "Custom"].map((c) => (
                <button
                  key={c}
                  onClick={() => setCount(c.toLowerCase())}
                  className={`py-3 rounded-xl border text-sm font-bold transition-all ${
                    count === c.toLowerCase() ? "bg-primary border-primary text-primary-foreground" : "bg-muted border-border text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => {
              onGenerate({ tone, type, count });
              setOpen(false);
            }}
            className="w-full bg-primary text-primary-foreground hover:opacity-90 h-14 rounded-2xl text-lg font-bold gap-3 shadow-lg"
            disabled={isGenerating}
          >
            {isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}
            Ignite Intelligence
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Removed AIToolsSidebar function as requested
