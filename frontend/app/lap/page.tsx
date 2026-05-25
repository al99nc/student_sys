"use client";
import { useState, useRef, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { uploadLecture, uploadText, processLecture, getLectures, deleteLecture, LectureOut, CustomContext } from "@/lib/api";
import { isAuthenticated, getToken } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { LectureSelector } from "@/components/lecture-selector";
import {
  CloudUpload, FileText, Loader2, CheckCircle2,
  ClipboardPaste, XCircle, ArrowLeft, BookOpen,
  Bot, MessageSquareText, ChevronRight, ChevronLeft, Search,
  Trash2, Settings2, Sparkles, Brain, ArrowRight,
  Target, Clock, X,
} from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { LapSkeleton } from "./LapSkeleton";

const PdfViewer = dynamic(() => import("@/components/pdf-viewer").then((m) => ({ default: m.PdfViewer })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading viewer…
    </div>
  ),
});

type InputMode = "file" | "paste";
type GenMode = "mcq" | "essay";
type ExamType = "revision" | "exam" | "harder" | "custom";

const SECTION_NAMES = ["Upload", "Create", "Study"] as const;
const SECTION_IDS = ["upload", "create", "study"] as const;
type SectionId = (typeof SECTION_IDS)[number];

const EXAM_TYPE_OPTIONS: { value: ExamType; label: string; desc: string }[] = [
  { value: "revision", label: "Revision", desc: "Casual review — balanced mix across all topics" },
  { value: "exam", label: "Exam", desc: "Exam simulation — clinical vignettes, mechanism traps" },
  { value: "harder", label: "Harder", desc: "Challenging — multi-step vignettes, max difficulty" },
  { value: "custom", label: "Custom", desc: "I'll configure everything below" },
];

const CUSTOM_EXAM_TYPES = [
  { value: "final", label: "Final Exam" },
  { value: "midterm", label: "Midterm" },
  { value: "quiz", label: "Quiz" },
  { value: "certification", label: "Certification" },
  { value: "entrance", label: "Entrance Exam" },
  { value: "oral", label: "Oral Exam" },
  { value: "revision", label: "Revision" },
];

const TIME_TO_EXAM_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "3days", label: "In 3 days" },
  { value: "1week", label: "In 1 week" },
  { value: "1month", label: "In 1 month" },
];

const PRIOR_KNOWLEDGE_OPTIONS = [
  { value: "first_time", label: "First time studying this" },
  { value: "know_basics", label: "Know the basics" },
  { value: "deep_review", label: "Deep review" },
];

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "brutal", label: "Brutal" },
];

function validatePDF(file: File): { valid: boolean; error?: string } {
  if (file.type !== "application/pdf")
    return { valid: false, error: "Only PDF files are supported" };
  if (file.size < 1024)
    return { valid: false, error: "File is too small to contain useful content" };
  if (file.size > 50 * 1024 * 1024)
    return { valid: false, error: "File exceeds the 50 MB limit" };
  return { valid: true };
}

function validateText(text: string): { valid: boolean; error?: string } {
  const trimmed = text.trim();
  if (trimmed.length === 0)
    return { valid: false, error: "Please paste some content first" };
  if (trimmed.length < 100)
    return { valid: false, error: `Too short — add at least ${100 - trimmed.length} more characters` };
  if (trimmed.length > 500_000)
    return { valid: false, error: "Text is too long (max 500,000 characters)" };
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 2).length;
  if (wordCount < 20)
    return { valid: false, error: "Not enough readable words detected" };
  return { valid: true };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function TelegramUploadCard() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-border/40 bg-muted/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center shrink-0">
          <Bot className="w-4 h-4 text-sky-500" />
        </div>
        <span className="flex-1 font-medium">
          Upload via Telegram
        </span>
        <span className="text-[10px] text-muted-foreground/40 uppercase tracking-wider">
          {open ? "Hide" : "Quick"}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-border/20">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Forward any PDF to <strong className="text-foreground">@themcq_bot</strong> on Telegram and
            it&apos;ll appear here automatically. First-time users need to link their email once.
          </p>

          <div className="flex flex-col sm:flex-row gap-2">
            <a
              href="https://t.me/themcq_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-400 border border-sky-500/20 text-sm font-semibold hover:bg-sky-500/25 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
                <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
              </svg>
              Open in Telegram
            </a>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText("@themcq_bot");
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted border border-border text-sm font-semibold text-muted-foreground hover:text-foreground transition-colors"
            >
              {copied ? (
                <><CheckCircle2 className="w-4 h-4 text-emerald-500" />Copied!</>
              ) : (
                <><MessageSquareText className="w-4 h-4" />Copy @themcq_bot</>
              )}
            </button>
          </div>

          <details className="text-xs text-muted-foreground/60">
            <summary className="cursor-pointer hover:text-muted-foreground transition-colors">
              How to set up
            </summary>
            <ol className="mt-2 space-y-1.5 pl-4 list-decimal">
              <li>Open Telegram and search for <strong className="text-foreground">@themcq_bot</strong></li>
              <li>Send <kbd className="px-1 py-0.5 rounded bg-muted border border-border text-foreground text-[10px] font-mono">/start</kbd> and follow the link your email</li>
              <li>Once linked, forward any PDF to the bot</li>
              <li>Open this page and the file will be ready to upload</li>
            </ol>
          </details>
        </div>
      )}
    </div>
  );
}

function LapContent() {
  const router = useRouter();
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [currentSection, setCurrentSection] = useState<SectionId>("upload");
  const [isScrolling, setIsScrolling] = useState(false);

  // Lap section state
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");

  // Create section state
  const [highlightCreate, setHighlightCreate] = useState(false);
  const [genLecture, setGenLecture] = useState<LectureOut | null>(null);
  const [genMode, setGenMode] = useState<GenMode>("mcq");
  const [examType, setExamType] = useState<ExamType>("revision");
  const [customExamType, setCustomExamType] = useState("final");
  const [timeToExam, setTimeToExam] = useState("today");
  const [priorKnowledge, setPriorKnowledge] = useState("first_time");
  const [difficulty, setDifficulty] = useState("medium");
  const [mcqCount, setMcqCount] = useState(20);
  const [weakTopics, setWeakTopics] = useState("");
  const [focusInstruction, setFocusInstruction] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState("");

  // Study section state
  const [lectures, setLectures] = useState<LectureOut[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [studySubTab, setStudySubTab] = useState<"mcq" | "pdf">("mcq");
  const [mcqPage, setMcqPage] = useState(1);
  const [pdfPage, setPdfPage] = useState(1);
  const [expandedPdfId, setExpandedPdfId] = useState<number | null>(null);
  const ITEMS_PER_PAGE = 15;

  const [studyLecture, setStudyLecture] = useState<LectureOut | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [showCoachBtn, setShowCoachBtn] = useState(false);
  const [coachBtnPos, setCoachBtnPos] = useState({ x: 0, y: 0 });

  const loadLectures = useCallback(() => {
    setLoadingLectures(true);
    getLectures()
      .then((res) => setLectures(res.data || []))
      .catch(() => {})
      .finally(() => setLoadingLectures(false));
  }, []);

  const scrollToSection = useCallback((section: SectionId, immediate = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const idx = SECTION_IDS.indexOf(section);
    if (idx === -1) return;
    
    setIsScrolling(true);
    setCurrentSection(section);
    sessionStorage.setItem("lap_current_section", section);
    
    el.scrollTo({ 
      left: idx * el.clientWidth, 
      behavior: immediate ? "auto" : "smooth" 
    });
    
    // Reset scrolling flag after animation
    setTimeout(() => setIsScrolling(false), 600);
  }, []);

  useEffect(() => {
    setMcqPage(1);
    setPdfPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }

    const tgFileToken = searchParams.get("tg_file");
    if (tgFileToken) {
      fetch(`/api/bot/temp/${tgFileToken}`)
        .then(async (res) => {
          if (!res.ok) return;
          const fileName = res.headers.get("X-File-Name") || "lecture.pdf";
          const blob = await res.blob();
          const f = new File([blob], fileName, { type: "application/pdf" });
          const v = validatePDF(f);
          if (v.valid) { setFile(f); setError(""); }
          else setError(v.error!);
        })
        .catch(() => {});
    }

    const lectureIdParam = searchParams.get("lecture_id");
    const sectionParam = searchParams.get("section");
    const savedSection = sessionStorage.getItem("lap_current_section") as SectionId | null;

    if (lectureIdParam) {
      getLectures().then((res) => {
        const lecturesData = res.data || [];
        const found = lecturesData.find((l: LectureOut) => l.id === parseInt(lectureIdParam));
        if (found) {
          setGenLecture(found);
          setTimeout(() => scrollToSection("create"), 100);
        }
      }).catch(() => {});
    } else if (savedSection && SECTION_IDS.includes(savedSection)) {
      setTimeout(() => scrollToSection(savedSection, true), 100);
    } else if (sectionParam === "create") {
      setTimeout(() => scrollToSection("create"), 100);
    } else if (sectionParam === "study") {
      setTimeout(() => scrollToSection("study"), 100);
    }

    loadLectures();
  }, [router, searchParams, loadLectures, scrollToSection]);

  // ── Polling for active jobs ──
  useEffect(() => {
    const hasActiveJobs = lectures.some(l => !!l.pending_job_id);
    if (!hasActiveJobs) return;

    const interval = setInterval(() => {
      // Refresh lectures in the background to detect when processing finishes
      getLectures()
        .then((res) => {
          const data = res.data || [];
          setLectures(data);
          if (!data.some((l: LectureOut) => !!l.pending_job_id)) {
            clearInterval(interval);
          }
        })
        .catch(() => {});
    }, 4000);

    return () => clearInterval(interval);
  }, [lectures]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || isScrolling) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    const section = SECTION_IDS[Math.min(idx, SECTION_IDS.length - 1)];
    if (section && section !== currentSection) {
      setCurrentSection(section);
      sessionStorage.setItem("lap_current_section", section);
    }
  }, [currentSection, isScrolling]);

  const handleLap = useCallback(async () => {
    setError("");

    if (inputMode === "file") {
      if (!file) { setError("Please select a PDF file first"); return; }
      const v = validatePDF(file);
      if (!v.valid) { setError(v.error!); return; }
    } else {
      if (!pasteTitle.trim()) { setError("Please provide a title for your content"); return; }
      const v = validateText(pasteText);
      if (!v.valid) { setError(v.error!); return; }
    }

    setUploading(true);
    try {
      let lectureId: number;

      if (inputMode === "file" && file) {
        const res = await uploadLecture(file);
        lectureId = res.data.id;
      } else {
        const res = await uploadText(pasteText.trim(), pasteTitle.trim() || "Pasted content");
        lectureId = res.data.id;
      }

      // Refresh lectures list and pre-select for Create section
      getLectures().then((res) => {
        const data = res.data || [];
        setLectures(data);
        const match = data.find((l: LectureOut) => l.id === lectureId);
        if (match) {
          setFile(null);
          setPasteText("");
          setPasteTitle("");
          setGenLecture(match);
          setGenError("");
          setHighlightCreate(true);
          setTimeout(() => setHighlightCreate(false), 5000); // Reset animation
          scrollToSection("create");
        }
      }).catch(() => {});

    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const d = axiosErr.response?.data?.detail;
      setError(typeof d === "string" ? d : (d && typeof d === "object" && "message" in d ? `${(d as {message: string}).message}`.trim() : "Upload failed"));
    } finally {
      setUploading(false);
    }
  }, [file, inputMode, pasteText, pasteTitle, scrollToSection, loadLectures]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const v = validatePDF(dropped);
    if (v.valid) { setFile(dropped); setError(""); }
    else setError(v.error!);
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const v = validatePDF(selected);
    if (v.valid) { setFile(selected); setError(""); }
    else setError(v.error!);
  }, []);

  const handleDelete = useCallback(async (e: React.MouseEvent | LectureOut, lectureArg?: LectureOut) => {
    let lecture: LectureOut;
    if (lectureArg) {
      // Called with (e, lecture)
      (e as React.MouseEvent).stopPropagation();
      lecture = lectureArg;
    } else {
      // Called with (lecture)
      lecture = e as LectureOut;
    }

    if (!confirm(`Delete "${lecture.title}"? This cannot be undone.`)) return;
    setDeletingId(lecture.id);
    try {
      await deleteLecture(lecture.id);
      if (studyLecture?.id === lecture.id) setStudyLecture(null);
      loadLectures();
    } catch {
      alert("Failed to delete. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }, [studyLecture, loadLectures]);

  const handleLectureClick = useCallback((lecture: LectureOut) => {
    setStudyLecture(lecture);
    setNumPages(null);
    setSelectionText("");
    setShowCoachBtn(false);
  }, []);

  const handleTextSelection = useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (text && text.length > 5) {
      setSelectionText(text);
      const range = sel!.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setCoachBtnPos({
        x: rect.left + rect.width / 2,
        y: rect.top - 10,
      });
      setShowCoachBtn(true);
    } else {
      setShowCoachBtn(false);
    }
  }, []);

  const handleDiscussWithCoach = useCallback(() => {
    const token = getToken();
    if (!token) { router.push("/auth"); return; }
    router.push(`/coach?q=${encodeURIComponent(selectionText)}`);
    setShowCoachBtn(false);
  }, [router, selectionText]);

  const handleLectureSelected = useCallback((lecture: LectureOut) => {
    setGenLecture(lecture);
    setGenError("");
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!genLecture) return;
    setGenError("");
    setIsGenerating(true);

    try {
      let jobId: string;
      if (genMode === "essay") {
        const res = await processLecture(genLecture.id, "essay");
        jobId = res.data.job_id;
      } else if (examType === "custom") {
        const customContext: CustomContext = {
          exam_type: customExamType,
          time_to_exam: timeToExam,
          prior_knowledge: priorKnowledge,
          difficulty,
          mcq_count: mcqCount,
          weak_topics: weakTopics.trim(),
        };
        const res = await processLecture(genLecture.id, "revision", customContext, focusInstruction.trim() || undefined);
        jobId = res.data.job_id;
      } else {
        const res = await processLecture(genLecture.id, examType, undefined, focusInstruction.trim() || undefined);
        jobId = res.data.job_id;
      }

      if (jobId) {
        toast({
          title: "Generation Started",
          description: `AI is now processing "${genLecture.title}". Redirecting to waiting room...`,
        });
        
        // Restore direct redirect to the waiting room so user sees the progress ring
        setTimeout(() => {
          router.push(`/lap/${jobId}`);
        }, 800);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const d = axiosErr.response?.data?.detail;
      setGenError(typeof d === "string" ? d : (d && typeof d === "object" && "message" in d ? `${(d as {message: string}).message}`.trim() : "Generation failed. Please try again."));
    } finally {
      setIsGenerating(false);
    }
  }, [customExamType, difficulty, examType, focusInstruction, genLecture, genMode, mcqCount, priorKnowledge, timeToExam, weakTopics, toast, loadLectures, scrollToSection]);

  const openAdvancedOptions = useCallback((lectureId: number) => {
    getLectures().then((res) => {
      const lecturesData = res.data || [];
      const found = lecturesData.find((l: LectureOut) => l.id === lectureId);
      if (found) setGenLecture(found);
    }).catch(() => {});
    scrollToSection("create");
  }, [scrollToSection]);

  const isReady = inputMode === "file" ? !!file : pasteText.trim().length >= 100;
  const canGenerate = genMode === "mcq" ? examType !== "custom" || (!!customExamType && !!difficulty && mcqCount >= 10) : true;
  const filteredLectures = lectures.filter((l) => !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const isPdf = studyLecture?.file_path?.toLowerCase().endsWith(".pdf");

  if (loadingLectures) {
    return <LapSkeleton />;
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppHeader activePage="Lap" />

      {/* Navigation bar - Sticky & Pill style */}
      <div className="sticky top-16 md:top-20 z-30 flex items-center justify-center pt-4 pb-2 shrink-0 pointer-events-none bg-background/50 backdrop-blur-sm">
        <div className="flex items-center p-1.5 gap-1.5 bg-background border border-border/40 rounded-full shadow-lg pointer-events-auto">
          {SECTION_NAMES.map((name, i) => {
            const id = SECTION_IDS[i];
            const isActive = currentSection === id;
            return (
              <button
                key={id}
                onClick={() => scrollToSection(id)}
                className={`px-5 py-2 rounded-full text-xs font-bold transition-all ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm scale-110"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>

      <main className="flex-grow flex flex-col w-full overflow-hidden">
        {/* Horizontal scroll container */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="flex flex-1 overflow-x-auto snap-x snap-mandatory scrollbar-hide overscroll-x-contain"
          style={{ scrollBehavior: "smooth" }}
        >
          {/* ═══════════════════ SECTION 1: LAP ═══════════════════ */}
          <section className="min-w-[100vw] snap-start overflow-y-auto">
            <div className="px-4 sm:px-6 max-w-3xl mx-auto w-full pb-32">
              <div className="space-y-8">
                <div className="text-center space-y-3 pt-6">
                  <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                    Lap Scan: Upload Your Content
                  </h1>
                  <p className="text-muted-foreground max-w-xl mx-auto text-base">
                    Upload a PDF or paste your notes. You'll configure generation options next.
                  </p>
                </div>

                <div className="flex gap-2 justify-center">
                  {([
                    { id: "file", icon: CloudUpload, label: "PDF File" },
                    { id: "paste", icon: ClipboardPaste, label: "Paste Text" },
                  ] as { id: InputMode; icon: React.ElementType; label: string }[]).map(({ id, icon: Icon, label }) => (
                    <button key={id} onClick={() => { setInputMode(id); setError(""); }}
                      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all border-2 ${
                        inputMode === id
                          ? "bg-primary text-primary-foreground border-white/40"
                          : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted border-transparent"}`}>
                      <Icon className="w-4 h-4" />{label}
                    </button>
                  ))}
                </div>

                {inputMode === "file" && (
                  <div
                    className={`flex flex-col items-center justify-center w-full min-h-[240px] border-2 border-dashed rounded-xl px-8 py-10 transition-all duration-300 cursor-pointer -translate-y-1 ${
                      dragging ? "border-primary/80 bg-primary/5" : file ? "border-emerald-500/50 bg-emerald-500/5" : "border-white/40 bg-muted/30 hover:border-primary/60"}`}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
                    {file ? (
                      <div className="flex flex-col items-center">
                        <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mb-4">
                          <FileText className="w-8 h-8 text-emerald-400" />
                        </div>
                        <h3 className="text-xl font-bold mb-1 truncate max-w-xs">{file.name}</h3>
                        <p className="text-muted-foreground text-sm">{formatBytes(file.size)} · Click to change</p>
                        <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2">
                          <CheckCircle2 className="w-3.5 h-3.5" />File ready
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-6">
                          <CloudUpload className="w-10 h-10 text-primary" />
                        </div>
                        <h3 className="text-2xl font-bold mb-2">Drag & Drop your PDF</h3>
                        <p className="text-muted-foreground mb-2 font-medium">PDF files up to 50 MB</p>
                        <p className="text-xs text-muted-foreground/60 mb-6">Text-based PDFs only</p>
                        <Button variant="outline" className="rounded-lg">Browse Files</Button>
                      </>
                    )}
                  </div>
                )}

                {inputMode === "paste" && (
                  <div className="space-y-4">
                    <div className="relative rounded-xl border-2 border-dashed border-white/40 bg-muted/30 overflow-hidden focus-within:border-primary/60 transition-colors -translate-y-1 shadow-sm">
                      <div className="absolute top-3 right-3 text-xs z-10">
                        {pasteText.length > 0 ? (
                          pasteText.trim().length < 100 ? (
                            <span className="text-amber-500 font-medium">
                              {pasteText.length.toLocaleString()} / 100 min chars
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              {pasteText.length.toLocaleString()} chars
                            </span>
                          )
                        ) : (
                          <span className="text-muted-foreground/60">Ctrl+V to paste</span>
                        )}
                      </div>
                      {pasteText.length > 0 && (
                        <div className="absolute bottom-3 right-3 text-xs text-muted-foreground/50 z-10 flex items-center gap-2">
                          <span>{pasteText.trim().split(/\s+/).filter(Boolean).length} words</span>
                          <span aria-hidden="true">&middot;</span>
                          <span>{pasteText.length > 500_000
                            ? <span className="text-destructive font-medium">Max reached</span>
                            : `${((pasteText.length / 500_000) * 100).toFixed(1)}%`
                          }</span>
                        </div>
                      )}
                      <div
                        className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-primary to-primary/50 transition-all duration-500"
                        style={{
                          width: `${Math.min(100, (pasteText.length / 500_000) * 100)}%`,
                          opacity: pasteText.length > 0 ? 1 : 0,
                        }}
                      />
                      <textarea
                        value={pasteText}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val.length <= 500_000) setPasteText(val);
                        }}
                        placeholder="Paste your lecture notes, textbook content, or any study material here…"
                        className="w-full min-h-[220px] resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 p-4 pr-28 pb-10 outline-none leading-relaxed"
                      />
                    </div>

                    {pasteText.trim().length > 0 && pasteText.trim().length < 100 && (
                      <div className="bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 rounded-xl px-4 py-2.5 text-xs flex items-start gap-2">
                        <span className="font-bold">Tip:</span>
                        <span>Add at least {100 - pasteText.trim().length} more characters for meaningful content.</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-muted-foreground ml-1 flex items-center gap-1">
                        Title <span className="text-destructive">*</span>
                      </label>
                      <div className="relative rounded-xl border-2 border-dashed border-white/40 bg-muted/30 overflow-hidden focus-within:border-primary/60 transition-colors -translate-y-1 shadow-sm">
                        <input
                          type="text"
                          value={pasteTitle}
                          onChange={(e) => setPasteTitle(e.target.value)}
                          placeholder="Title for this content (e.g. &quot;Pharmacology Chapter 3&quot;)"
                          className="w-full px-4 py-3 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 outline-none pr-16"
                          maxLength={60}
                          required
                        />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/40">
                          {pasteTitle.length}/60
                        </span>
                      </div>
                    </div>

                    {pasteText.trim().length >= 100 && (
                      <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-xl px-4 py-3 flex items-center gap-3 text-xs text-muted-foreground">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <span>
                          Content looks good! <strong className="text-foreground">{pasteText.trim().split(/\s+/).filter(Boolean).length} words</strong> ready to process. Press Upload to continue.
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {error && (
                  <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                    <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                <Button
                  onClick={handleLap}
                  disabled={uploading || !isReady}
                  className="w-full synapse-gradient text-white font-bold py-6 rounded-xl shadow-lg hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  {uploading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />Uploading…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <CloudUpload className="w-5 h-5" />
                      Upload
                    </span>
                  )}
                </Button>

                <TelegramUploadCard />
              </div>
            </div>
          </section>

          {/* ═══════════════════ SECTION 2: CREATE ═══════════════════ */}
          <section className="min-w-[100vw] snap-start overflow-y-auto">
            <div className="px-4 sm:px-6 max-w-3xl mx-auto w-full pb-32">
              <div className="space-y-8 pt-6">
                <div className="text-center space-y-3">
                  <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                    Create Practice Questions
                  </h1>
                  <p className="text-muted-foreground max-w-xl mx-auto text-sm">
                    Select a file to generate MCQs or essay questions from, or upload new content.
                  </p>
                </div>

                {!genLecture ? (
                  <Card>
                    <CardContent className="p-6">
                      <LectureSelector
                        preselectedId={searchParams.get("lecture_id") ? parseInt(searchParams.get("lecture_id")!) : undefined}
                        onLectureSelected={handleLectureSelected}
                        onUploadRequested={() => scrollToSection("upload")}
                        onDelete={handleDelete}
                      />
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    <div className={`transition-all duration-500 rounded-2xl ${highlightCreate ? "ring-4 ring-primary ring-offset-4 ring-offset-background scale-[1.02] bg-primary/5 p-4" : ""}`}>
                      <div className="flex items-center justify-between">
                        <div>
                          <h2 className="text-xl font-extrabold text-foreground">
                            Configure Generation
                          </h2>
                          <div className="flex items-center gap-2 text-muted-foreground mt-1">
                            <FileText className="w-4 h-4" />
                            <span className="text-sm font-medium">{genLecture.title}</span>
                            {highlightCreate && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary text-primary-foreground animate-pulse">
                                NEWLY UPLOADED
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setGenLecture(null)}
                          className="text-xs text-destructive border border-destructive hover:bg-destructive/10"
                        >
                          Change file
                        </Button>
                      </div>
                    </div>

                    <Card>
                      <CardContent className="p-6 space-y-6">
                        <div>
                          <label className="text-sm font-bold text-foreground mb-3 block">
                            What do you want to generate?
                          </label>
                          <div className="grid grid-cols-2 gap-3">
                            {[
                              { value: "mcq" as GenMode, icon: Target, label: "MCQs", desc: "Multiple choice questions" },
                              { value: "essay" as GenMode, icon: Brain, label: "Essay Questions", desc: "Open-ended with AI grading" },
                            ].map(({ value, icon: Icon, label, desc }) => (
                              <button
                                key={value}
                                onClick={() => { setGenMode(value); setGenError(""); }}
                                className={`p-4 rounded-xl border-2 text-left transition-all ${
                                  genMode === value
                                    ? "border-primary bg-primary/5"
                                    : "border-border bg-card hover:border-primary/40"
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${genMode === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                                    <Icon className="w-4 h-4" />
                                  </div>
                                  <span className={`font-bold text-sm ${genMode === value ? "text-foreground" : "text-muted-foreground"}`}>
                                    {label}
                                  </span>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                              </button>
                            ))}
                          </div>
                        </div>

                        {genMode === "mcq" && (
                          <div>
                            <label className="text-sm font-bold text-foreground mb-3 block">
                              Exam type
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {EXAM_TYPE_OPTIONS.map(({ value, label, desc }) => (
                                <button
                                  key={value}
                                  onClick={() => { setExamType(value); setGenError(""); }}
                                  className={`p-4 rounded-xl border-2 text-left transition-all ${
                                    examType === value
                                      ? "border-primary bg-primary/5"
                                      : "border-border bg-card hover:border-primary/40"
                                  }`}
                                >
                                  <span className={`font-bold text-sm ${examType === value ? "text-foreground" : "text-muted-foreground"}`}>
                                    {label}
                                  </span>
                                  <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {genMode === "mcq" && examType === "custom" && (
                          <div className="space-y-5 border-t border-border pt-5">
                            <p className="text-sm font-bold text-foreground">Custom Configuration</p>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                              <div>
                                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                                  Exam type
                                </label>
                                <select
                                  value={customExamType}
                                  onChange={(e) => setCustomExamType(e.target.value)}
                                  className="w-full px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
                                >
                                  {CUSTOM_EXAM_TYPES.map(({ value, label }) => (
                                    <option key={value} value={value}>{label}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                                  Time to exam
                                </label>
                                <select
                                  value={timeToExam}
                                  onChange={(e) => setTimeToExam(e.target.value)}
                                  className="w-full px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
                                >
                                  {TIME_TO_EXAM_OPTIONS.map(({ value, label }) => (
                                    <option key={value} value={value}>{label}</option>
                                  ))}
                                </select>
                              </div>

                              <div>
                                <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                                  Prior knowledge
                              </label>
                              <select
                                value={priorKnowledge}
                                onChange={(e) => setPriorKnowledge(e.target.value)}
                                className="w-full px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
                              >
                                {PRIOR_KNOWLEDGE_OPTIONS.map(({ value, label }) => (
                                  <option key={value} value={value}>{label}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                                Difficulty
                              </label>
                              <div className="flex gap-2">
                                {DIFFICULTY_OPTIONS.map(({ value, label }) => (
                                  <button
                                    key={value}
                                    onClick={() => setDifficulty(value)}
                                    className={`flex-1 px-2 py-2 rounded-lg text-xs font-bold transition-all ${
                                      difficulty === value
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted/50 text-muted-foreground border border-border hover:border-primary/40"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                              Number of MCQs: {mcqCount}
                            </label>
                            <input
                              type="range"
                              min={10}
                              max={40}
                              step={5}
                              value={mcqCount}
                              onChange={(e) => setMcqCount(parseInt(e.target.value))}
                              className="w-full accent-primary"
                            />
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                              <span>10</span>
                              <span>40</span>
                            </div>
                          </div>

                          <div>
                            <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                              Weak topics{" "}
                              <span className="font-normal text-muted-foreground/60">(optional)</span>
                            </label>
                            <textarea
                              value={weakTopics}
                              onChange={(e) => setWeakTopics(e.target.value)}
                              placeholder="List topics you struggle with, one per line"
                              maxLength={300}
                              className="w-full min-h-[80px] resize-none px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60 transition-colors"
                            />
                          </div>
                        </div>
                      )}

                      <div className="border-t border-border pt-5">
                        <label className="text-sm font-bold text-foreground mb-3 block">
                          Focus on specific topics?{" "}
                          <span className="font-normal text-muted-foreground/60">(optional)</span>
                        </label>
                        <input
                          type="text"
                          value={focusInstruction}
                          onChange={(e) => setFocusInstruction(e.target.value)}
                          placeholder="e.g., 'Focus on cardiovascular pharmacology' or 'Emphasize drug interactions'"
                          maxLength={300}
                          className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60 transition-colors"
                        />
                        <p className="text-xs text-muted-foreground/60 mt-2">
                          The AI will prioritize these topics when generating questions.
                        </p>
                      </div>

                      {genError && (
                        <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          {genError}
                        </div>
                      )}

                      <Button
                        onClick={handleGenerate}
                        disabled={isGenerating || !canGenerate}
                        className="w-full synapse-gradient text-white font-bold py-6 rounded-xl shadow-lg hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:translate-y-0"
                      >
                        {isGenerating ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Starting generation…
                          </span>
                        ) : (
                          <span className="flex items-center gap-2">
                            <Sparkles className="w-5 h-5" />
                            Generate {genMode === "mcq" ? "MCQs" : "Essay Questions"}
                          </span>
                        )}
                      </Button>
                    </CardContent>
                  </Card>
                </>
              )}

              {lectures.length === 0 && (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
                    <BookOpen className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground mb-1">No lectures yet</h3>
                    <p className="text-sm text-muted-foreground max-sm mx-auto">
                      Upload a PDF or paste your notes to get started.
                    </p>
                  </div>
                  <Button variant="default" onClick={() => scrollToSection("upload")}>
                    <CloudUpload className="w-4 h-4 mr-2" />Upload a File
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ═══════════════════ SECTION 3: STUDY ═══════════════════ */}
        <section className="min-w-[100vw] snap-start overflow-y-auto">
          <div className="px-4 sm:px-6 max-w-6xl mx-auto w-full pb-32">
            <div className="space-y-6 pt-6">
              {/* Header & Search */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <h2 className="text-lg font-bold text-foreground">Study</h2>
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search lectures..."
                    className="w-full pl-10 pr-4 py-2 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
                  />
                </div>
              </div>

              {/* Sub-tabs */}
              <div className="flex gap-2 p-1 bg-muted/30 rounded-xl w-fit">
                {[
                  { id: "mcq", label: "MCQ Sets", count: lectures.filter(l => l.is_processed || !!l.pending_job_id).length },
                  { id: "pdf", label: "Study PDFs", count: lectures.length },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setStudySubTab(tab.id as "mcq" | "pdf")}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${
                      studySubTab === tab.id
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tab.label} <span className="ml-1 opacity-50">{tab.count}</span>
                  </button>
                ))}
              </div>

              {loadingLectures ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="space-y-4">
                  {studySubTab === "mcq" ? (
                    <>
                      <div className="space-y-2">
                        {(() => {
                          const mcqLectures = filteredLectures.filter(l => l.is_processed || !!l.pending_job_id);
                          const paginated = mcqLectures.slice((mcqPage - 1) * ITEMS_PER_PAGE, mcqPage * ITEMS_PER_PAGE);
                          
                          if (paginated.length === 0) return (
                            <div className="text-center py-12 text-muted-foreground text-sm">
                              No MCQ sets found.
                            </div>
                          );

                          return paginated.map((upload) => {
                            const isReady = upload.is_processed;
                            const hasJob = !!upload.pending_job_id;
                            let href: string;
                            let statusLabel: string;
                            let statusColor: string;

                            if (isReady) {
                              href = `/results/${upload.id}`;
                              statusLabel = "Ready";
                              statusColor = "text-emerald-500 bg-emerald-500/10 border-emerald-500/20";
                            } else if (hasJob) {
                              href = `/lap/${upload.pending_job_id}`;
                              statusLabel = "Processing";
                              statusColor = "text-amber-500 bg-amber-500/10 border-amber-500/20";
                            } else {
                              href = `/lap?section=create&lecture_id=${upload.id}`;
                              statusLabel = "Generate";
                              statusColor = "text-primary bg-primary/10 border-primary/20";
                            }

                            return (
                              <div key={upload.id} className="space-y-1">
                                <button
                                  onClick={(e) => {
                                    const btn = e.currentTarget;
                                    btn.style.transform = "scale(0.95)";
                                    btn.style.opacity = "0";
                                    setTimeout(() => router.push(href), 100);
                                  }}
                                  className="w-full h-[56px] flex items-center gap-3 px-4 rounded-xl border border-border/40 bg-card hover:bg-muted/30 transition-all duration-150 text-left group"
                                >
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isReady ? "bg-emerald-500/10" : hasJob ? "bg-amber-500/10" : "bg-primary/10"}`}>
                                    {isReady ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : hasJob ? <Clock className="w-4 h-4 text-amber-500" /> : <Sparkles className="w-4 h-4 text-primary" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-foreground truncate">{upload.title}</p>
                                    <p className="text-[10px] text-muted-foreground">
                                      {hasJob && upload.progress_label ? (
                                        <span className="text-amber-500 font-medium animate-pulse">{upload.progress_label}</span>
                                      ) : (
                                        new Date(upload.created_at).toLocaleDateString()
                                      )}
                                    </p>
                                  </div>
                                  <Badge variant="outline" className={`flex-shrink-0 px-2 h-5 text-[9px] font-bold ${statusColor}`}>
                                    {hasJob && upload.progress_pct !== null ? `${upload.progress_pct}%` : statusLabel}
                                  </Badge>
                                  <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-foreground transition-colors" />
                                </button>
                                {hasJob && (
                                  <div className="px-1">
                                    <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                                      <div 
                                        className="h-full bg-amber-500/50 transition-all duration-500 rounded-full" 
                                        style={{ width: `${upload.progress_pct ?? 0}%` }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          });
                        })()}
                      </div>
                      
                      {/* Pagination for MCQ */}
                      {(() => {
                        const mcqLectures = filteredLectures.filter(l => l.is_processed || !!l.pending_job_id);
                        const totalPages = Math.ceil(mcqLectures.length / ITEMS_PER_PAGE);
                        if (totalPages <= 1) return null;
                        return (
                          <div className="flex items-center justify-center gap-4 pt-4">
                            <Button variant="ghost" size="sm" onClick={() => setMcqPage(p => Math.max(1, p - 1))} disabled={mcqPage === 1}>
                              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                            </Button>
                            <span className="text-xs font-bold text-muted-foreground">Page {mcqPage} of {totalPages}</span>
                            <Button variant="ghost" size="sm" onClick={() => setMcqPage(p => Math.min(totalPages, p + 1))} disabled={mcqPage === totalPages}>
                              Next <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                          </div>
                        );
                      })()}
                    </>
                  ) : (
                    <>
                      <div className="space-y-2">
                        {(() => {
                          const paginated = filteredLectures.slice((pdfPage - 1) * ITEMS_PER_PAGE, pdfPage * ITEMS_PER_PAGE);
                          if (paginated.length === 0) return (
                            <div className="text-center py-12 text-muted-foreground text-sm">
                              No PDFs found.
                            </div>
                          );

                          return paginated.map((lecture) => (
                            <div key={lecture.id} className="space-y-2">
                              <div
                                onClick={() => setExpandedPdfId(expandedPdfId === lecture.id ? null : lecture.id)}
                                className="w-full h-[56px] flex items-center gap-3 px-4 rounded-xl border border-border/40 bg-card hover:bg-muted/30 transition-all duration-150 text-left cursor-pointer group"
                              >
                                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                                  <FileText className="w-4 h-4 text-primary" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-bold text-foreground truncate">{lecture.title}</p>
                                  <p className="text-[10px] text-muted-foreground">{new Date(lecture.created_at).toLocaleDateString()}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={(e) => handleDelete(e, lecture)}
                                    disabled={deletingId === lecture.id}
                                    className="w-8 h-8 rounded-lg flex items-center justify-center text-destructive hover:bg-destructive/10 transition-colors"
                                  >
                                    {deletingId === lecture.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                  </button>
                                  <ChevronRight className={`w-4 h-4 text-muted-foreground/30 group-hover:text-foreground transition-transform ${expandedPdfId === lecture.id ? "rotate-90" : ""}`} />
                                </div>
                              </div>
                              
                              {/* Inline PDF Viewer Expansion */}
                              {expandedPdfId === lecture.id && (
                                <div className="animate-in fade-in slide-in-from-top-2 duration-300 overflow-hidden rounded-xl border border-primary/20">
                                  <div className="bg-muted/30 p-2 flex justify-between items-center border-b border-border/20">
                                    <span className="text-[10px] font-bold text-muted-foreground px-2">PDF VIEWER</span>
                                    <button onClick={() => setExpandedPdfId(null)} className="p-1 hover:bg-muted rounded-md transition-colors">
                                      <X className="w-3.5 h-3.5 text-muted-foreground" />
                                    </button>
                                  </div>
                                  <div className="bg-background min-h-[500px]">
                                    {lecture.file_path?.toLowerCase().endsWith(".pdf") ? (
                                      <div onMouseUp={handleTextSelection}>
                                        <PdfViewer
                                          lectureId={lecture.id}
                                          onLoadSuccess={(pdf) => setNumPages(pdf.numPages)}
                                        />
                                      </div>
                                    ) : (
                                      <div className="p-12 text-center space-y-3">
                                        <div className="w-12 h-12 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                                          <FileText className="w-6 h-6 text-muted-foreground" />
                                        </div>
                                        <p className="text-sm text-muted-foreground">Text-based content viewing coming soon.</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          ));
                        })()}
                      </div>

                      {/* Pagination for PDF */}
                      {(() => {
                        const totalPages = Math.ceil(filteredLectures.length / ITEMS_PER_PAGE);
                        if (totalPages <= 1) return null;
                        return (
                          <div className="flex items-center justify-center gap-4 pt-4">
                            <Button variant="ghost" size="sm" onClick={() => setPdfPage(p => Math.max(1, p - 1))} disabled={pdfPage === 1}>
                              <ChevronLeft className="w-4 h-4 mr-1" /> Prev
                            </Button>
                            <span className="text-xs font-bold text-muted-foreground">Page {pdfPage} of {totalPages}</span>
                            <Button variant="ghost" size="sm" onClick={() => setPdfPage(p => Math.min(totalPages, p + 1))} disabled={pdfPage === totalPages}>
                              Next <ChevronRight className="w-4 h-4 ml-1" />
                            </Button>
                          </div>
                        );
                      })()}
                    </>
                  )}
                </div>
              )}

              {filteredLectures.length === 0 && !loadingLectures && (
                <div className="text-center py-12 space-y-4">
                  <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto">
                    <BookOpen className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-foreground mb-1">
                      {searchQuery ? "No matches found" : "No lectures yet"}
                    </h3>
                    <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                      {searchQuery ? "Try a different search term" : "Upload a PDF or paste your notes to get started."}
                    </p>
                  </div>
                  {!searchQuery && (
                    <Button variant="default" onClick={() => scrollToSection("upload")}>
                      <CloudUpload className="w-4 h-4 mr-2" />Upload a File
                    </Button>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
        </div>
      </main>

      {showCoachBtn && (
        <button
          onClick={handleDiscussWithCoach}
          style={{
            position: "fixed",
            left: `${coachBtnPos.x}px`,
            top: `${coachBtnPos.y}px`,
            transform: "translate(-50%, -100%)",
            zIndex: 1000,
          }}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold shadow-lg hover:opacity-90 transition-opacity flex items-center gap-1.5"
        >
          <MessageSquareText className="w-3 h-3" />
          Discuss with Coach
        </button>
      )}
    </div>
  );
}

export default function LapPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    }>
      <LapContent />
      <style jsx global>{`
        @keyframes progress-fast {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-progress-fast {
          animation: progress-fast 1.5s infinite linear;
        }
      `}</style>
    </Suspense>
  );
}
