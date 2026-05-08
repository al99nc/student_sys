"use client";
import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  uploadLecture,
  uploadText,
  extractImageText,
  processLecture,
  getEntitlements,
  Difficulty,
  CustomContext,
} from "@/lib/api";
import CustomizeBar from "@/components/customize-bar";
import { isAuthenticated, getToken } from "@/lib/auth";
import { useTelegram } from "@/lib/useTelegram";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CloudUpload, FileText, Loader2, CheckCircle2,
  BookOpen, Medal, Brain, Layers,
  ClipboardPaste, Image as ImageIcon,
  AlignLeft, ImagePlus, XCircle, Copy, Check, X,
} from "lucide-react";

type Tab = "study" | "exam";
type Mode = "revision" | "exam" | "harder";
type InputMode = "file" | "paste";

// ── Validation types ─────────────────────────────────────────────────────────
interface ValidationResult {
  valid: boolean;
  error?: string;
  warning?: string;
}

// ── Validators ───────────────────────────────────────────────────────────────
function validatePDF(file: File): ValidationResult {
  if (file.type !== "application/pdf")
    return { valid: false, error: "Only PDF files are supported" };
  if (file.size < 1024)
    return { valid: false, error: "File is too small to contain useful content" };
  if (file.size > 50 * 1024 * 1024)
    return { valid: false, error: "File exceeds the 50 MB limit" };
  if (file.size > 20 * 1024 * 1024)
    return { valid: true, warning: "Large file — processing may take a few extra minutes" };
  return { valid: true };
}

function validateImage(file: File): ValidationResult {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type))
    return { valid: false, error: "Only JPEG, PNG, or WebP images are supported" };
  if (file.size < 5 * 1024)
    return { valid: false, error: "Image is too small — make sure it shows the full page" };
  if (file.size > 10 * 1024 * 1024)
    return { valid: false, error: "Image exceeds the 10 MB limit" };
  return { valid: true };
}

function validateText(text: string): ValidationResult {
  const trimmed = text.trim();
  if (trimmed.length === 0)
    return { valid: false, error: "Please paste some content first" };
  if (trimmed.length < 100)
    return { valid: false, error: `Too short — add at least ${100 - trimmed.length} more characters` };
  if (trimmed.length > 500_000)
    return { valid: false, error: "Text is too long (max 500,000 characters)" };
  // Warn if text looks like it's mostly garbage / non-words
  const wordCount = trimmed.split(/\s+/).filter(w => w.length > 2).length;
  if (wordCount < 20)
    return { valid: false, error: "Not enough readable words detected — check your content" };
  if (trimmed.length > 100_000)
    return { valid: true, warning: "Very long text — only the most relevant sections will be used" };
  return { valid: true };
}

// ── Utility ───────────────────────────────────────────────────────────────────
function dataURLtoFile(dataUrl: string, filename: string): File {
  const [header, data] = dataUrl.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
  const binary = atob(data);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

// ── Bot username with one-click copy ─────────────────────────────────────────
function BotUsernameCopy({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(`@${username}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#229ED9]/10 border border-[#229ED9]/25 text-[#229ED9]">
      <span className="font-mono text-xs font-semibold">@{username}</span>
      <button
        onClick={handleCopy}
        className="ml-0.5 p-0.5 rounded hover:bg-[#229ED9]/20 transition-colors"
        title="Copy username"
      >
        {copied
          ? <Check className="w-3 h-3" />
          : <Copy className="w-3 h-3" />
        }
      </button>
    </div>
  );
}

// ── Telegram tip announcement (shown once, 5s read) ──────────────────────────
function TelegramAnnouncement() {
  const [visible, setVisible] = useState(false);
  const [seconds, setSeconds] = useState(5);
  const done = seconds === 0;

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!localStorage.getItem("themcq_upload_tip_v1")) setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible || done) return;
    const t = setInterval(() => setSeconds((s) => {
      if (s <= 1) { clearInterval(t); return 0; }
      return s - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [visible, done]);

  const dismiss = () => {
    localStorage.setItem("themcq_upload_tip_v1", "1");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/85 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 bg-muted w-full overflow-hidden">
          <div
            className="h-full bg-foreground"
            style={{
              width: `${((5 - seconds) / 5) * 100}%`,
              transition: seconds < 5 ? "width 1s linear" : "none",
            }}
          />
        </div>

        <div className="p-7 sm:p-9">
          <div className="flex items-center justify-between mb-7">
            <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">
              one sec bestie
            </span>
            <span className="text-xs font-mono tabular-nums text-muted-foreground">
              {done ? "✓ ok now you can go" : `${seconds}s`}
            </span>
          </div>

          <div className="space-y-5 mb-8">
            <h2 className="text-2xl font-bold text-foreground leading-snug">
              heyyy omg wait wait WAIT —
            </h2>

            <p className="text-sm text-foreground/85 leading-relaxed">
              okay so you're literally about to go digging through your files app looking for that PDF... babe we've been there. scrolling past 847 files all named{" "}
              <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">document_final_v3_ACTUAL_FINAL.pdf</span>
              {" "}is NOT the vibe and we refuse to let you suffer like that 💀
            </p>

            <p className="text-sm text-foreground/85 leading-relaxed">
              <span className="font-bold text-foreground">real talk:</span> we have a Telegram bot. you open it, you forward your PDF (or image or whatever), it shows up here automatically ready to cook. zero file app, zero chaos, zero stress. fr it takes like 5 seconds.
            </p>

            <p className="text-sm text-foreground/85 leading-relaxed">
              just tap the button → forward your file in telegram → come back here. we got you 🍳✨
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <a
              href="https://t.me/themcq_bot"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-foreground text-background text-sm font-bold hover:opacity-90 transition-opacity"
            >
              take me to the bot →
            </a>
            <button
              onClick={done ? dismiss : undefined}
              disabled={!done}
              className={`flex-1 px-4 py-3 rounded-xl border text-sm font-medium transition-all ${
                done
                  ? "border-border text-foreground hover:bg-muted cursor-pointer"
                  : "border-border/25 text-muted-foreground/35 cursor-not-allowed select-none"
              }`}
            >
              {done ? "nah I'll find my files" : `wait ${seconds}s…`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}



// ── Main component ────────────────────────────────────────────────────────────
function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processId = searchParams.get("process");

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const { isInTelegram, mainButton } = useTelegram();

  // ── User entitlements (for Smart Context gate) ───────────────────────────
  const [userPlan, setUserPlan]             = useState<"free" | "pro" | "enterprise">("free");
  const [extraUsageEnabled, setExtraUsage]  = useState(false);
  const [creditBalance, setCreditBalance]   = useState(0);
  const [customContext, setCustomContext]    = useState<CustomContext | null>(null);
  const [focusInstruction, setFocusInstruction] = useState<string>("");

  // ── Essay mode toggle ────────────────────────────────────────────────────
  const [essayMode, setEssayMode]       = useState(false);

  // ── Core state ───────────────────────────────────────────────────────────
  const [inputMode, setInputMode]       = useState<InputMode>("file");
  const [file, setFile]                 = useState<File | null>(null);
  const [fileValidation, setFileValidation] = useState<ValidationResult | null>(null);
  const [dragging, setDragging]         = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [error, setError]               = useState("");
  const [step, setStep]                 = useState<"upload" | "process" | "done">("upload");
  const [tab, setTab]                   = useState<Tab>("study");
  const [mode, setMode]                 = useState<Mode>("revision");
  const [tgFileLoading, setTgFileLoading] = useState(false);
  const [tgFileReady, setTgFileReady]   = useState(false);

  const [extractingText, setExtractingText]   = useState(false);

  // ── Paste state ──────────────────────────────────────────────────────────
  const [pasteText, setPasteText]           = useState("");
  const [pastedImage, setPastedImage]       = useState<string | null>(null);
  const [pasteTitle, setPasteTitle]         = useState("");
  const [pasteValidation, setPasteValidation] = useState<ValidationResult | null>(null);
  const [galleryImage, setGalleryImage]     = useState<string | null>(null);
  const [galleryValidation, setGalleryValidation] = useState<ValidationResult | null>(null);

  // ── Telegram ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isInTelegram || !mainButton) return;
    const ready = isReady;
    if (ready && step === "upload" && !uploading) {
      const label = essayMode ? "Generate Essay Questions"
        : mode === "harder" ? "Generate Harder Questions"
        : mode === "exam" ? "Generate Exam Questions"
        : "Generate Revision MCQs";
      mainButton.setText(label).show().enable();
      mainButton.onClick(handleSubmit);
      return () => { mainButton.offClick(handleSubmit); };
    } else {
      mainButton.hide();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isInTelegram || !mainButton) return;
    if (uploading) mainButton.setText("Processing...").showProgress(true).disable();
    else if (step === "done") mainButton.hideProgress().setText("Done!").disable();
  }, [isInTelegram, mainButton, uploading, step]);

  // ── Active job check — redirect if a generation is already running ────────
  useEffect(() => {
    const checkActiveJob = async () => {
      const token = getToken();
      if (!token) return;
      try {
        const res = await fetch("/api/jobs/active/mine", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.active_job) {
          router.push(`/upload/${data.active_job.job_id}`);
        }
      } catch {
        // silently ignore — never block the upload page
      }
    };
    checkActiveJob();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth + shared files ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    getEntitlements().then((res) => {
      setUserPlan(res.data.plan as "free" | "pro" | "enterprise");
      setExtraUsage(res.data.extra_usage_enabled);
      setCreditBalance(res.data.credit_balance);
    }).catch(() => {});
    if (processId) { handleProcess(parseInt(processId)); return; }

    const isShared = searchParams.get("shared") === "1";
    if (isShared) {
      caches.open("share-target-v1").then(async (cache) => {
        const response = await cache.match("/shared-file");
        if (response) {
          const blob = await response.blob();
          const fileName = response.headers.get("X-File-Name") || "shared.pdf";
          const f = new File([blob], fileName, { type: "application/pdf" });
          setFile(f);
          setFileValidation(validatePDF(f));
          await cache.delete("/shared-file");
        }
      }).catch(() => {});
    }

    const tgFileToken = searchParams.get("tg_file");
    if (tgFileToken) {
      setTgFileLoading(true);
      fetch(`/api/bot/temp/${tgFileToken}`)
        .then(async (res) => {
          if (!res.ok) return;
          const fileName = res.headers.get("X-File-Name") || "lecture.pdf";
          const blob = await res.blob();
          const f = new File([blob], fileName, { type: "application/pdf" });
          setFile(f);
          setFileValidation(validatePDF(f));
          setTgFileReady(true);
        })
        .catch(() => {})
        .finally(() => setTgFileLoading(false));
    }
  }, [processId, router, searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Global paste listener ─────────────────────────────────────────────────
  useEffect(() => {
    if (inputMode !== "paste") return;
    const handlePaste = (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageItem = items.find((i) => i.type.startsWith("image/"));
      if (imageItem) {
        e.preventDefault();
        const blob = imageItem.getAsFile();
        if (!blob) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
          const dataUrl = ev.target?.result as string;
          setPastedImage(dataUrl);
          // Validate pasted image
          const f = dataURLtoFile(dataUrl, "pasted.jpg");
          setPasteValidation(validateImage(f));
        };
        reader.readAsDataURL(blob);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [inputMode]);

  // ── Validate paste text on change ─────────────────────────────────────────
  useEffect(() => {
    if (!pasteText) { setPasteValidation(null); return; }
    setPasteValidation(validateText(pasteText));
  }, [pasteText]);

  // ── Mode helpers ──────────────────────────────────────────────────────────
  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setMode(newTab === "study" ? "revision" : "exam");
  };

  // ── Processing pipeline ───────────────────────────────────────────────────
  const handleProcess = async (id: number) => {
    setUploading(true);
    setError("");
    try {
      const res = await processLecture(
        id,
        essayMode ? "essay" : mode as Difficulty,
        customContext ?? undefined,
        focusInstruction.trim() || undefined,
      );
      const jobId = res.data.job_id;
      router.push(`/upload/${jobId}`);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const d = axiosErr.response?.data?.detail;
      setError(typeof d === "string" ? d : (d && typeof d === "object" && "message" in d ? `${(d as {message: string}).message} ${(d as {hint?: string}).hint ?? ""}`.trim() : "Processing failed. Please try again."));
      setStep("upload");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    setError("");

    // ── Final validation before submit ──────────────────────────────────────
    if (inputMode === "file") {
      if (!file) { setError("Please select a PDF file first"); return; }
      const v = validatePDF(file);
      if (!v.valid) { setError(v.error!); return; }
    } else if (inputMode === "paste" && !pastedImage && !galleryImage) {
      const v = validateText(pasteText);
      if (!v.valid) { setError(v.error!); return; }
    }

    setUploading(true);
    try {
      let lectureId: number;

      if (inputMode === "file" && file) {
        const res = await uploadLecture(file);
        lectureId = res.data.id;

      } else if (inputMode === "paste") {
        const imageSource = pastedImage || galleryImage;
        if (imageSource) {
          const imageFile = dataURLtoFile(imageSource, "image.jpg");
          const imgV = validateImage(imageFile);
          if (!imgV.valid) { setError(imgV.error!); setUploading(false); return; }
          setExtractingText(true);
          let extracted = "";
          try {
            const extRes = await extractImageText(imageFile);
            extracted = extRes.data.text;
          } finally { setExtractingText(false); }
          if (!extracted || extracted.trim().length < 50) {
            setError("Couldn't extract enough text from the image. Try a clearer photo.");
            setUploading(false); return;
          }
          const res = await uploadText(extracted, pasteTitle.trim() || "Pasted image");
          lectureId = res.data.id;
        } else {
          const v = validateText(pasteText);
          if (!v.valid) { setError(v.error!); setUploading(false); return; }
          const res = await uploadText(pasteText.trim(), pasteTitle.trim() || "Pasted content");
          lectureId = res.data.id;
        }

      } else {
        setError("No content to process"); setUploading(false); return;
      }

      await handleProcess(lectureId);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const d = axiosErr.response?.data?.detail;
      setError(typeof d === "string" ? d : (d && typeof d === "object" && "message" in d ? `${(d as {message: string}).message} ${(d as {hint?: string}).hint ?? ""}`.trim() : "Upload failed"));
      setStep("upload");
    } finally {
      setUploading(false);
      setFocusInstruction("");
    }
  };

  // ── File drag & drop ──────────────────────────────────────────────────────
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    const v = validatePDF(dropped);
    setFileValidation(v);
    if (v.valid) { setFile(dropped); setError(""); }
    else setError(v.error!);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const v = validatePDF(selected);
    setFileValidation(v);
    if (v.valid) { setFile(selected); setError(""); }
    else setError(v.error!);
  };

  // ── Gallery / phone image pick ────────────────────────────────────────────
  const handleGalleryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    const v = validateImage(selected);
    setGalleryValidation(v);
    if (!v.valid) { setError(v.error!); return; }
    setError("");
    const reader = new FileReader();
    reader.onload = (ev) => setGalleryImage(ev.target?.result as string);
    reader.readAsDataURL(selected);
  };

  // ── Input mode switch ──────────────────────────────────────────────────────
  const switchInputMode = (m: InputMode) => {
    setInputMode(m);
    setError("");
    setPastedImage(null);
    setGalleryImage(null);
    setGalleryValidation(null);
  };

  // ── Readiness ──────────────────────────────────────────────────────────────
  const isReady = (
    (inputMode === "file"   && !!file && (fileValidation?.valid ?? false)) ||
    (inputMode === "paste"  && (
      (!!pastedImage && (pasteValidation?.valid ?? true)) ||
      (!!galleryImage && (galleryValidation?.valid ?? true)) ||
      (pasteText.trim().length >= 100 && (pasteValidation?.valid ?? false))
    ))
  );

  const submitLabel = extractingText ? "Extracting text from image…"
    : uploading ? "Uploading…"
    : essayMode ? "Generate Essay Questions"
    : mode === "harder" ? "Generate Harder Questions"
    : mode === "exam"   ? "Generate Exam Questions"
    : "Generate Revision MCQs";

  // ── ValidationBadge component ──────────────────────────────────────────────
  const ValidationBadge = ({ v }: { v: ValidationResult | null }) => {
    if (!v) return null;
    if (!v.valid) return (
      <div className="flex items-center gap-1.5 text-xs text-destructive mt-2">
        <XCircle className="w-3.5 h-3.5 flex-shrink-0" />
        {v.error}
      </div>
    );
    if (v.warning) return (
      <div className="flex items-center gap-1.5 text-xs text-yellow-400 mt-2">
        <span className="w-3.5 h-3.5 flex-shrink-0 text-base leading-none">⚠</span>
        {v.warning}
      </div>
    );
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-400 mt-2">
        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
        Looks good
      </div>
    );
  };

  // ── Done screen (legacy — normally the job page handles this) ────────────
  if (step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center relative bg-background">
        <div className="grain-overlay" />
        <Card className="relative z-10 glass-panel border-border/50 max-w-md mx-4 w-full">
          <CardContent className="p-6 sm:p-12 text-center">
            <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-bold text-foreground">Done! Redirecting…</h2>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main upload page ───────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      {!isInTelegram && <TelegramAnnouncement />}


      {!isInTelegram && <AppHeader activePage="Upload" />}

      <main className={`flex-grow flex flex-col items-center justify-center px-4 sm:px-6 max-w-5xl mx-auto w-full ${isInTelegram ? "pt-6 pb-24" : "pt-8 pb-32"}`}>
        <section className="w-full text-center space-y-8">

          {/* Heading */}
          <div className="space-y-3">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-foreground">
              Expand Your Intelligence
            </h1>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg font-medium leading-relaxed">
              Upload a PDF or paste your notes — AI converts them into exam-ready MCQs.
            </p>
            <div className="flex flex-col items-center gap-2 pt-1">
              <BotUsernameCopy username="themcq_bot" />
              <a
                href="http://t.me/themcq_bot"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-xl bg-[#229ED9]/15 border border-[#229ED9]/35 text-[#229ED9] font-semibold text-sm hover:bg-[#229ED9]/25 hover:border-[#229ED9]/60 transition-all duration-200"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0" fill="currentColor">
                  <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
                </svg>
                Open in Telegram
              </a>
            </div>
          </div>

          {/* Mode Selector — dimmed when Smart Context overrides it */}
          <div className={`w-full max-w-3xl mx-auto transition-opacity duration-300 ${customContext ? "opacity-40 pointer-events-none select-none" : ""}`}>
            {customContext && (
              <p className="text-center text-xs text-primary font-medium mb-2">
                Smart Context is active — mode is overridden
              </p>
            )}
            <Tabs value={tab} onValueChange={(v) => handleTabChange(v as Tab)} className="mb-4">
              <TabsList className="grid w-full grid-cols-2 max-w-xs mx-auto bg-muted/50">
                <TabsTrigger value="study" className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />Study
                </TabsTrigger>
                <TabsTrigger value="exam" className="flex items-center gap-2">
                  <Medal className="w-4 h-4" />Exam
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {tab === "study" ? (
              <Card className="glass-panel border-l-4 border-primary text-left">
                <CardContent className="p-5">
                  <p className="font-bold text-foreground mb-1">Revision MCQs</p>
                  <p className="text-xs text-muted-foreground">Balanced mix across all topics with clinical vignettes, mechanism questions, and key concept summaries.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(["exam", "harder"] as const).map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    className={`p-5 rounded-xl text-left transition-all border-l-4 ${mode === m
                      ? m === "harder" ? "glass-panel border-cyan-500" : "glass-panel border-primary"
                      : "bg-muted/30 border-transparent hover:border-border"}`}>
                    <p className={`font-bold mb-1 ${mode === m ? "text-foreground" : "text-muted-foreground"}`}>
                      {m === "exam" ? "Hard" : "Harder"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {m === "exam"
                        ? '40% "All FALSE EXCEPT" questions, clinical vignettes, mechanism traps.'
                        : '~50% "All FALSE EXCEPT" like real boards. Multi-step vignettes, max difficulty.'}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Essay Mode Toggle */}
          <div className="w-full max-w-3xl mx-auto">
            <div className={`flex items-center justify-between px-5 py-4 rounded-xl border transition-all duration-300 ${
              essayMode
                ? "bg-violet-500/10 border-violet-500/40"
                : "bg-muted/30 border-border/40 hover:border-border/70"
            }`}>
              <div className="flex items-center gap-3">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${
                  essayMode ? "bg-violet-500/20" : "bg-muted"
                }`}>
                  <Brain className={`w-5 h-5 ${essayMode ? "text-violet-400" : "text-muted-foreground"}`} />
                </div>
                <div className="text-left">
                  <p className={`text-sm font-bold ${essayMode ? "text-foreground" : "text-muted-foreground"}`}>
                    Essay Mode
                  </p>
                  <p className="text-xs text-muted-foreground leading-snug">
                    AI generates open-ended questions with ideal 100/100 answers — your answer is graded by AI
                  </p>
                </div>
              </div>
              <button
                onClick={() => setEssayMode((v) => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors duration-300 flex-shrink-0 focus:outline-none ${
                  essayMode ? "bg-violet-500" : "bg-muted-foreground/30"
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-300 ${
                  essayMode ? "translate-x-5" : "translate-x-0"
                }`} />
              </button>
            </div>
            {essayMode && (
              <p className="text-center text-xs text-violet-400 font-medium mt-2">
                Essay Mode is active — AI will create essay questions with ideal answers for grading
              </p>
            )}
          </div>

          {/* Smart Context Bar */}
          <CustomizeBar
            plan={userPlan}
            extraUsageEnabled={extraUsageEnabled}
            creditBalance={creditBalance}
            value={customContext}
            onChange={setCustomContext}
          />

          {/* Focus instruction input */}
          {!customContext && (
            <div className="w-full max-w-3xl mx-auto">
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Focus on specific topics{" "}
                <span className="text-xs text-muted-foreground/60 font-normal">(optional)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={focusInstruction}
                  onChange={(e) => setFocusInstruction(e.target.value)}
                  placeholder='e.g. "antiepileptic drugs" or "only side effects" or "mechanisms of action"'
                  maxLength={300}
                  className="
                    w-full px-4 py-3 rounded-xl
                    bg-muted/30 border border-border/40
                    text-sm text-foreground
                    placeholder:text-muted-foreground/40
                    focus:outline-none focus:border-primary/60
                    transition-colors
                  "
                />
                {focusInstruction && (
                  <button
                    onClick={() => setFocusInstruction("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {focusInstruction && (
                <p className="mt-1.5 text-xs text-indigo-400">
                  ✓ AI will prioritize &quot;{focusInstruction}&quot; when generating questions
                </p>
              )}
            </div>
          )}

          {/* Input Mode Tabs */}
          <div className="w-full max-w-3xl mx-auto">
            <div className="flex gap-2 justify-center mb-6">
              {([
                { id: "file",  icon: CloudUpload,    label: "PDF File" },
                { id: "paste", icon: ClipboardPaste, label: "Paste"    },
              ] as { id: InputMode; icon: React.ElementType; label: string }[]).map(({ id, icon: Icon, label }) => (
                <button key={id} onClick={() => switchInputMode(id)}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                    inputMode === id
                      ? "synapse-gradient text-white shadow-lg shadow-primary/30"
                      : "bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted"}`}>
                  <Icon className="w-4 h-4" />{label}
                </button>
              ))}
            </div>

            {/* ── FILE ─────────────────────────────────────────────────── */}
            {inputMode === "file" && (
              <div className="relative group">
                <div className="absolute -inset-1 synapse-gradient rounded-xl blur opacity-10 group-hover:opacity-25 transition duration-500" />
                <div
                  className={`relative flex flex-col items-center justify-center w-full min-h-[240px] border-2 border-dashed rounded-xl px-8 py-10 transition-all duration-300 cursor-pointer ${
                    tgFileLoading ? "border-primary/60 bg-primary/5"
                    : dragging     ? "border-cyan-500/80 bg-cyan-500/5"
                    : file && fileValidation?.valid ? "border-emerald-500/50 bg-emerald-500/5"
                    : file && !fileValidation?.valid ? "border-destructive/50 bg-destructive/5"
                    : "border-border/40 bg-muted/30 hover:border-primary/60 hover:-translate-y-1"}`}
                  onDragOver={(e) => { if (!tgFileLoading) { e.preventDefault(); setDragging(true); }}}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => { if (!tgFileLoading) handleDrop(e); }}
                  onClick={() => { if (!tgFileLoading) fileInputRef.current?.click(); }}
                >
                  <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />

                  {tgFileLoading ? (
                    <div className="flex flex-col items-center pointer-events-none">
                      <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
                      <h3 className="text-lg font-bold mb-1">Attaching your PDF…</h3>
                      <Progress value={40} className="w-48 h-1 mt-3" />
                    </div>
                  ) : file ? (
                    <div className="flex flex-col items-center">
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 ${fileValidation?.valid ? "bg-emerald-500/20" : "bg-destructive/20"}`}>
                        <FileText className={`w-8 h-8 ${fileValidation?.valid ? "text-emerald-400" : "text-destructive"}`} />
                      </div>
                      <h3 className="text-xl font-bold mb-1 truncate max-w-xs">{file.name}</h3>
                      <p className="text-muted-foreground text-sm">{formatBytes(file.size)} · Click to change</p>
                      <ValidationBadge v={fileValidation} />
                      {tgFileReady && (
                        <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />Attached from Telegram
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="w-20 h-20 rounded-2xl synapse-gradient flex items-center justify-center mb-6 shadow-lg shadow-primary/20">
                        <CloudUpload className="w-10 h-10 text-white" />
                      </div>
                      <h3 className="text-2xl font-bold mb-2">Drag & Drop your PDF</h3>
                      <p className="text-muted-foreground mb-2 font-medium">PDF files up to 50 MB</p>
                      <p className="text-xs text-muted-foreground/60 mb-6">Min ~1 KB · Text-based PDFs only (not scanned images)</p>
                      <Button variant="outline" className="rounded-lg">Browse Files</Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── PASTE ────────────────────────────────────────────────── */}
            {inputMode === "paste" && (
              <div className="space-y-3">
                {pastedImage || galleryImage ? (
                  /* Pasted / gallery image preview */
                  <div className="relative rounded-xl border border-border/40 bg-muted/30 overflow-hidden">
                    <div className="flex flex-col items-center gap-4 p-6">
                      <div className="relative w-full max-w-md rounded-xl overflow-hidden border border-primary/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={pastedImage || galleryImage!} alt="Pasted" className="w-full object-contain max-h-64" />
                        <div className="absolute top-2 right-2 bg-primary/20 border border-primary/40 rounded-full px-3 py-1 flex items-center gap-1.5">
                          <ImageIcon className="w-3.5 h-3.5 text-primary" />
                          <span className="text-primary text-xs font-semibold">
                            {pastedImage ? "Image pasted" : "Image from gallery"}
                          </span>
                        </div>
                      </div>
                      <ValidationBadge v={pasteValidation || galleryValidation} />
                      <Button variant="outline" size="sm"
                        onClick={() => { setPastedImage(null); setGalleryImage(null); setGalleryValidation(null); setPasteValidation(null); }}
                        className="gap-2">
                        <AlignLeft className="w-4 h-4" />Switch to text instead
                      </Button>
                    </div>
                  </div>
                ) : (
                  /* Text area */
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
                      placeholder={"Paste your lecture notes, textbook content, or any study material here…\n\nYou can also paste a screenshot (Ctrl+V) and AI will extract the text."}
                      className="w-full min-h-[220px] resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 p-4 pr-24 outline-none leading-relaxed"
                    />
                    {pasteText.length > 0 && (
                      <div className="px-4 pb-3">
                        <ValidationBadge v={pasteValidation} />
                      </div>
                    )}
                  </div>
                )}

                {/* Gallery upload for paste mode too */}
                {!pastedImage && !galleryImage && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border/30" />
                    <span className="text-xs text-muted-foreground">or</span>
                    <div className="flex-1 h-px bg-border/30" />
                  </div>
                )}
                {!pastedImage && !galleryImage && (
                  <button
                    onClick={() => galleryInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-dashed border-border/40 text-sm text-muted-foreground hover:text-foreground hover:border-primary/40 transition-all"
                  >
                    <ImagePlus className="w-4 h-4" />
                    Upload image from phone / gallery
                  </button>
                )}
                <input
                  ref={galleryInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleGalleryChange}
                />

                {/* Title */}
                <input
                  type="text"
                  value={pasteTitle}
                  onChange={(e) => setPasteTitle(e.target.value)}
                  placeholder="Title (optional) — e.g. Cardiology Lecture 3"
                  className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60 transition-colors"
                  maxLength={120}
                />
              </div>
            )}
          </div>

          {/* Global error */}
          {error && (
            <div className="w-full max-w-3xl mx-auto bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm flex items-start gap-2">
              <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Submit */}
          {(isReady || extractingText) && !isInTelegram && (
            <Button
              onClick={handleSubmit}
              disabled={uploading || extractingText || !isReady}
              className="w-full max-w-3xl mx-auto synapse-gradient text-white font-bold py-6 rounded-xl shadow-lg hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {uploading || extractingText ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />{submitLabel}
                </span>
              ) : submitLabel}
            </Button>
          )}

          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full pt-4">
            {[
              { icon: Brain,    label: "MCQ Questions", desc: "AI generates multiple choice questions targeting key concepts in your material." },
              { icon: Layers,   label: "Smart Summary",  desc: "High-level overview distilled into readable bullet points for fast revision." },
              { icon: BookOpen, label: "Flashcard Deck", desc: "Spaced-repetition ready cards automatically generated for long-term retention." },
            ].map((c) => (
              <Card key={c.label} className="glass-panel border-border/50 hover:-translate-y-1 transition-transform duration-300">
                <CardContent className="p-6 flex flex-col items-start text-left">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
                    <c.icon className="w-6 h-6 text-primary" />
                  </div>
                  <h4 className="text-lg font-bold text-foreground mb-2">{c.label}</h4>
                  <p className="text-sm text-muted-foreground leading-relaxed">{c.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
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
