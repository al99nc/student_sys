"use client";
import { useState, useRef, useEffect, Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { uploadLecture, uploadText, getLectures, deleteLecture, LectureOut } from "@/lib/api";
import { isAuthenticated, getToken } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CloudUpload, FileText, Loader2, CheckCircle2,
  ClipboardPaste, XCircle, ArrowLeft, BookOpen,
  Bot, MessageSquareText, ChevronRight, Search,
  Trash2,
} from "lucide-react";

const PdfViewer = dynamic(() => import("@/components/pdf-viewer").then((m) => ({ default: m.PdfViewer })), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center py-16 text-muted-foreground">
      <Loader2 className="w-5 h-5 animate-spin mr-2" />Loading viewer…
    </div>
  ),
});

type InputMode = "file" | "paste";

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

function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [activeTab, setActiveTab] = useState("upload");

  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");

  const [lectures, setLectures] = useState<LectureOut[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedLecture, setSelectedLecture] = useState<LectureOut | null>(null);
  const [numPages, setNumPages] = useState<number | null>(null);

  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectionText, setSelectionText] = useState("");
  const [showCoachBtn, setShowCoachBtn] = useState(false);
  const [coachBtnPos, setCoachBtnPos] = useState({ x: 0, y: 0 });

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

    loadLectures();
  }, [router, searchParams]);

  const loadLectures = () => {
    setLoadingLectures(true);
    getLectures()
      .then((res) => setLectures(res.data || []))
      .catch(() => {})
      .finally(() => setLoadingLectures(false));
  };

  const handleUpload = async () => {
    setError("");

    if (inputMode === "file") {
      if (!file) { setError("Please select a PDF file first"); return; }
      const v = validatePDF(file);
      if (!v.valid) { setError(v.error!); return; }
    } else {
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

      router.push(`/create?lecture_id=${lectureId}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const d = axiosErr.response?.data?.detail;
      setError(typeof d === "string" ? d : (d && typeof d === "object" && "message" in d ? `${(d as {message: string}).message}`.trim() : "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const v = validatePDF(dropped);
    if (v.valid) { setFile(dropped); setError(""); }
    else setError(v.error!);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const v = validatePDF(selected);
    if (v.valid) { setFile(selected); setError(""); }
    else setError(v.error!);
  };

  const isReady = inputMode === "file"
    ? !!file
    : pasteText.trim().length >= 100;

  const handleDelete = async (e: React.MouseEvent, lecture: LectureOut) => {
    e.stopPropagation();
    if (!confirm(`Delete "${lecture.title}"? This cannot be undone.`)) return;
    setDeletingId(lecture.id);
    try {
      await deleteLecture(lecture.id);
      if (selectedLecture?.id === lecture.id) setSelectedLecture(null);
      loadLectures();
    } catch {
      alert("Failed to delete. Please try again.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleLectureClick = (lecture: LectureOut) => {
    setSelectedLecture(lecture);
    setNumPages(null);
    setSelectionText("");
    setShowCoachBtn(false);
  };

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

  const handleDiscussWithCoach = () => {
    const token = getToken();
    if (!token) { router.push("/auth"); return; }
    router.push(`/coach?q=${encodeURIComponent(selectionText)}`);
    setShowCoachBtn(false);
  };

  const filteredLectures = lectures.filter((l) =>
    !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isPdf = selectedLecture?.file_path?.toLowerCase().endsWith(".pdf");

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppHeader activePage="Upload" />
      <main className="flex-grow px-4 sm:px-6 max-w-6xl mx-auto w-full pt-6 pb-32">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="flex items-center justify-between mb-6">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="upload" className="flex items-center gap-2">
                <CloudUpload className="w-4 h-4" />Upload New File
              </TabsTrigger>
              <TabsTrigger value="study" className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />Study
              </TabsTrigger>
            </TabsList>
          </div>

          {/* ═══════════════════ UPLOAD TAB ═══════════════════ */}
          <TabsContent value="upload" className="mt-0">
            <div className="max-w-3xl mx-auto space-y-8">
              <div className="text-center space-y-3">
                <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                  Upload Your Content
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
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                      inputMode === id
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                    <Icon className="w-4 h-4" />{label}
                  </button>
                ))}
              </div>

              {inputMode === "file" && (
                <div
                  className={`flex flex-col items-center justify-center w-full min-h-[240px] border-2 border-dashed rounded-xl px-8 py-10 transition-all duration-300 cursor-pointer ${
                    dragging ? "border-primary/80 bg-primary/5" : file ? "border-emerald-500/50 bg-emerald-500/5" : "border-border/40 bg-muted/30 hover:border-primary/60 hover:-translate-y-1"}`}
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
                  <div className="relative rounded-xl border border-border/40 bg-muted/30 overflow-hidden focus-within:border-primary/60 transition-colors">
                    <div className="absolute top-3 right-3 text-xs pointer-events-none">
                      {pasteText.length > 0 ? (
                        pasteText.trim().length < 100
                          ? <span className="text-amber-500">{pasteText.length.toLocaleString()} / 100 min chars</span>
                          : <span className="text-muted-foreground">{pasteText.length.toLocaleString()} chars</span>
                      ) : (
                        <span className="text-muted-foreground">Ctrl+V to paste</span>
                      )}
                    </div>
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder="Paste your lecture notes, textbook content, or any study material here…"
                      className="w-full min-h-[200px] resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 p-4 pr-24 outline-none leading-relaxed"
                    />
                  </div>
                  <input
                    type="text"
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder="Title for this content (max 60 chars)"
                    className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60 transition-colors"
                    maxLength={60}
                  />
                </div>
              )}

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm flex items-start gap-2">
                  <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {error}
                </div>
              )}

              <Button
                onClick={handleUpload}
                disabled={uploading || !isReady}
                className="w-full synapse-gradient text-white font-bold py-6 rounded-xl shadow-lg hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:translate-y-0"
              >
                {uploading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />Uploading…
                  </span>
                ) : "Upload"}
              </Button>
            </div>
          </TabsContent>

          {/* ═══════════════════ STUDY TAB ═══════════════════ */}
          <TabsContent value="study" className="mt-0">
            {selectedLecture ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Button variant="ghost" size="sm" onClick={() => { setSelectedLecture(null); setShowCoachBtn(false); }}>
                    <ArrowLeft className="w-4 h-4 mr-1" />Back
                  </Button>
                  <div>
                    <h2 className="text-lg font-bold text-foreground">{selectedLecture.title}</h2>
                    <p className="text-xs text-muted-foreground">
                      {isPdf ? `${numPages || "?"} pages` : "Text content"} · Select any text to discuss with the AI Coach
                    </p>
                  </div>
                </div>

                <div className="relative" onMouseUp={handleTextSelection}>
                  {isPdf ? (
                    <PdfViewer
                      lectureId={selectedLecture.id}
                      onLoad={(np) => setNumPages(np)}
                      onSelect={handleTextSelection}
                    />
                  ) : (
                    <div className="rounded-xl border border-border/40 bg-muted/20 p-6 min-h-[300px]">
                      <p className="text-sm text-muted-foreground">
                        Text content — select any passage to discuss with the AI Coach.
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-2">
                        Full text viewing coming soon for non-PDF uploads.
                      </p>
                    </div>
                  )}

                  {showCoachBtn && (
                    <div
                      className="fixed z-50"
                      style={{
                        left: Math.max(16, coachBtnPos.x - 100),
                        top: Math.max(16, coachBtnPos.y - 50),
                      }}
                    >
                      <button
                        onClick={handleDiscussWithCoach}
                        className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background text-sm font-bold shadow-xl hover:opacity-90 transition-all animate-in fade-in slide-in-from-top-2"
                      >
                        <Bot className="w-4 h-4" />
                        Ask Coach
                        <MessageSquareText className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl sm:text-2xl font-bold text-foreground">Your Files</h2>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search files…"
                      className="pl-9 pr-4 py-2 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60 transition-colors w-48"
                    />
                  </div>
                </div>

                {loadingLectures ? (
                  <div className="flex items-center justify-center py-16">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredLectures.length === 0 ? (
                  <div className="flex flex-col items-center text-center gap-4 py-16">
                    <BookOpen className="h-12 w-12 text-muted-foreground" />
                    <p className="text-lg font-semibold text-foreground">
                      {lectures.length === 0 ? "No files yet" : "No files match your search"}
                    </p>
                    <p className="text-sm text-muted-foreground max-w-sm">
                      {lectures.length === 0
                        ? "Upload a PDF to start studying."
                        : "Try a different search term."}
                    </p>
                    {lectures.length === 0 && (
                      <Button variant="default" onClick={() => setActiveTab("upload")}>
                        <CloudUpload className="w-4 h-4 mr-2" />Upload a File
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredLectures.map((lecture) => (
                      <div
                        key={lecture.id}
                        onClick={() => handleLectureClick(lecture)}
                        onKeyDown={(e) => e.key === "Enter" && handleLectureClick(lecture)}
                        role="button"
                        tabIndex={0}
                        className="text-left p-5 rounded-xl border border-border bg-card hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-150 cursor-pointer"
                      >
                        <div className="flex items-center gap-3 mb-3">
                          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-5 h-5 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-foreground truncate">
                              {lecture.title}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(lecture.created_at).toLocaleDateString()}
                            </p>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(e, lecture);
                            }}
                            disabled={deletingId === lecture.id}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0 disabled:opacity-50"
                            title="Delete"
                          >
                            {deletingId === lecture.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        </div>
                        <div className="flex items-center gap-2">
                          {lecture.is_processed && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                              Processed
                            </span>
                          )}
                          {lecture.pending_job_id && (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                              Processing
                            </span>
                          )}
                          {lecture.file_path?.toLowerCase().endsWith(".pdf") ? (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              PDF
                            </span>
                          ) : (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              Text
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    }>
      <UploadContent />
    </Suspense>
  );
}
