"use client";
import { useState, useRef, useEffect } from "react";
import { uploadLecture, uploadText, getLectures, LectureOut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  CloudUpload, FileText, Loader2, CheckCircle2,
  ClipboardPaste, XCircle, ChevronRight, Search,
} from "lucide-react";

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

function UploadForm({ onUploaded }: { onUploaded: (lectureId: number) => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inputMode, setInputMode] = useState<InputMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const [pasteText, setPasteText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");

  const handleUpload = async () => {
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
      onUploaded(lectureId);
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

  const isReady = inputMode === "file" ? !!file : pasteText.trim().length >= 100;

  return (
    <div className="space-y-6">
      <div className="flex gap-2 justify-center">
        {([{ id: "file" as InputMode, icon: CloudUpload, label: "PDF File" },
          { id: "paste" as InputMode, icon: ClipboardPaste, label: "Paste Text" },
        ]).map(({ id, icon: Icon, label }) => (
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
          className={`flex flex-col items-center justify-center w-full min-h-[200px] border-2 border-dashed rounded-xl px-8 py-8 transition-all duration-300 cursor-pointer -translate-y-1 ${
            dragging ? "border-primary/80 bg-primary/5" : file ? "border-emerald-500/50 bg-emerald-500/5" : "border-white/40 bg-muted/30 hover:border-primary/60"}`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
          {file ? (
            <div className="flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/20 flex items-center justify-center mb-3">
                <FileText className="w-7 h-7 text-emerald-400" />
              </div>
              <h3 className="text-lg font-bold mb-1 truncate max-w-xs">{file.name}</h3>
              <p className="text-muted-foreground text-sm">{formatBytes(file.size)} · Click to change</p>
              <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2">
                <CheckCircle2 className="w-3.5 h-3.5" />File ready
              </div>
            </div>
          ) : (
            <>
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                <CloudUpload className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-bold mb-2">Drag & Drop your PDF</h3>
              <p className="text-muted-foreground mb-2 text-sm">PDF files up to 50 MB</p>
              <Button variant="outline" className="rounded-lg text-sm">Browse Files</Button>
            </>
          )}
        </div>
      )}

      {inputMode === "paste" && (
        <div className="space-y-3">
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
          <div className="relative rounded-xl border-2 border-dashed border-white/40 bg-muted/30 overflow-hidden focus-within:border-primary/60 transition-colors -translate-y-1 shadow-sm">
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
              className="w-full min-h-[160px] resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 p-4 pr-24 outline-none leading-relaxed"
            />
          </div>
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
  );
}

interface LectureSelectorProps {
  preselectedId?: number;
  onLectureSelected: (lecture: LectureOut) => void;
  onUploadRequested?: () => void;
}

export function LectureSelector({ preselectedId, onLectureSelected, onUploadRequested }: LectureSelectorProps) {
  const [lectures, setLectures] = useState<LectureOut[]>([]);
  const [loadingLectures, setLoadingLectures] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUpload, setShowUpload] = useState(false);

  const handleUploadClick = () => {
    if (onUploadRequested) {
      onUploadRequested();
    } else {
      setShowUpload(true);
    }
  };

  const loadLectures = () => {
    setLoadingLectures(true);
    getLectures()
      .then((res) => {
        const data = res.data || [];
        setLectures(data);
        if (preselectedId) {
          const match = data.find((l: LectureOut) => l.id === preselectedId);
          if (match) {
            onLectureSelected(match);
            return;
          }
        }
        if (data.length === 0) {
          setShowUpload(true);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingLectures(false));
  };

  useEffect(() => {
    loadLectures();
  }, [preselectedId]);

  const filteredLectures = lectures.filter((l) =>
    !searchQuery || l.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUploaded = (lectureId: number) => {
    getLectures()
      .then((res) => {
        const data = res.data || [];
        setLectures(data);
        setShowUpload(false);
        const match = data.find((l: LectureOut) => l.id === lectureId);
        if (match) {
          onLectureSelected(match);
        }
      })
      .catch(() => {});
  };

  if (loadingLectures) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {!showUpload && lectures.length > 0 && (
        <>
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-bold text-foreground">Select a file</h2>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search lectures…"
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60 transition-colors"
                />
              </div>
              {filteredLectures.length === 0 && (
                <Button variant="outline" size="sm" onClick={handleUploadClick} className="flex items-center justify-center gap-1.5 h-10 px-4 animate-in fade-in zoom-in duration-300">
                  <CloudUpload className="w-4 h-4" />
                  Upload new
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredLectures.map((lecture) => (
              <button
                key={lecture.id}
                onClick={() => onLectureSelected(lecture)}
                className="text-left p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:-translate-y-0.5 transition-all duration-150"
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <FileText className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground truncate">{lecture.title}</p>
                    <p className="text-xs text-muted-foreground">{new Date(lecture.created_at).toLocaleDateString()}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </div>
                <div className="flex items-center gap-2">
                  {lecture.file_path?.toLowerCase().endsWith(".pdf") ? (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">PDF</span>
                  ) : (
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Text</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {showUpload && (
        <div className="space-y-4">
          {lectures.length > 0 && (
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">Upload new content</h2>
              <Button variant="ghost" size="sm" onClick={() => setShowUpload(false)}>
                Back to files
              </Button>
            </div>
          )}
          {lectures.length === 0 && (
            <div className="text-center space-y-2">
              <h2 className="text-lg font-bold text-foreground">No files yet</h2>
              <p className="text-sm text-muted-foreground">Upload a PDF or paste your notes to get started.</p>
            </div>
          )}
          <UploadForm onUploaded={handleUploaded} />
        </div>
      )}
    </div>
  );
}
