"use client";
import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  uploadLecture,
  uploadText,
  extractImageText,
  processLecture,
  estimateProcessing,
  Difficulty,
} from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { useTelegram } from "@/lib/useTelegram";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft, CloudUpload, FileText, Loader2, CheckCircle2,
  BookOpen, Medal, Brain, Layers, Home, Plus, BarChart3,
  Camera, ClipboardPaste, RotateCcw, Image as ImageIcon,
  AlignLeft, ImagePlus, XCircle, ScanLine,
} from "lucide-react";

type Tab = "study" | "exam";
type Mode = "highyield" | "exam" | "harder";
type InputMode = "file" | "camera" | "paste";

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

// ── Main component ────────────────────────────────────────────────────────────
function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processId = searchParams.get("process");

  const fileInputRef    = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const videoRef        = useRef<HTMLVideoElement>(null);
  const canvasRef       = useRef<HTMLCanvasElement>(null);
  const streamRef       = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { isInTelegram, mainButton } = useTelegram();

  // ── Core state ───────────────────────────────────────────────────────────
  const [inputMode, setInputMode]       = useState<InputMode>("file");
  const [file, setFile]                 = useState<File | null>(null);
  const [fileValidation, setFileValidation] = useState<ValidationResult | null>(null);
  const [dragging, setDragging]         = useState(false);
  const [uploading, setUploading]       = useState(false);
  const [processing, setProcessing]     = useState(false);
  const [error, setError]               = useState("");
  const [step, setStep]                 = useState<"upload" | "process" | "done">("upload");
  const [tab, setTab]                   = useState<Tab>("study");
  const [mode, setMode]                 = useState<Mode>("highyield");
  const [timeEstimate, setTimeEstimate] = useState<{
    estimated_range: string; chunks: number; keys?: number; estimated_seconds?: number;
  } | null>(null);
  const [elapsed, setElapsed]           = useState(0);
  const elapsedRef                      = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tgFileLoading, setTgFileLoading] = useState(false);
  const [tgFileReady, setTgFileReady]   = useState(false);

  // ── Camera state ─────────────────────────────────────────────────────────
  const [cameraActive, setCameraActive]       = useState(false);
  const [capturedImage, setCapturedImage]     = useState<string | null>(null);
  const [capturedValidation, setCapturedValidation] = useState<ValidationResult | null>(null);
  const [extractingText, setExtractingText]   = useState(false);
  const [cameraError, setCameraError]         = useState("");
  // Scan animation — pulses the frame when camera is live
  const [scanLine, setScanLine]               = useState(0); // 0–100 position %
  const [steadyCount, setSteadyCount]         = useState(0);
  const [autoCapturing, setAutoCapturing]     = useState(false);

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
      const label = mode === "harder" ? "Generate Harder Questions"
        : mode === "exam" ? "Generate Exam Questions"
        : "Generate High Yield MCQs";
      mainButton.setText(label).show().enable();
      mainButton.onClick(handleSubmit);
      return () => { mainButton.offClick(handleSubmit); };
    } else {
      mainButton.hide();
    }
  }); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isInTelegram || !mainButton) return;
    if (uploading || processing) mainButton.setText("Processing...").showProgress(true).disable();
    else if (step === "done") mainButton.hideProgress().setText("Done!").disable();
  }, [isInTelegram, mainButton, uploading, processing, step]);

  // ── Auth + shared files ───────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
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

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => { stopCamera(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scan line animation when camera active ────────────────────────────────
  useEffect(() => {
    if (!cameraActive) { setScanLine(0); return; }
    let pos = 0;
    let dir = 1;
    scanIntervalRef.current = setInterval(() => {
      pos += dir * 2;
      if (pos >= 100) dir = -1;
      if (pos <= 0)   dir = 1;
      setScanLine(pos);
    }, 16);
    return () => { if (scanIntervalRef.current) clearInterval(scanIntervalRef.current); };
  }, [cameraActive]);

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
    setMode(newTab === "study" ? "highyield" : "exam");
  };

  const modeLabel = mode === "harder" ? "Harder Mode" : mode === "exam" ? "Exam Mode" : "High Yield";

  // ── Processing pipeline ───────────────────────────────────────────────────
  const handleProcess = async (id: number) => {
    setStep("process");
    setProcessing(true);
    setElapsed(0);
    setError("");
    try {
      const est = await estimateProcessing(id, mode as Difficulty);
      setTimeEstimate(est.data);
    } catch { /* non-fatal */ }
    elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    try {
      await processLecture(id, mode as Difficulty);
      setStep("done");
      setTimeout(() => router.push(`/results/${id}`), 1500);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const d = axiosErr.response?.data?.detail;
      setError(typeof d === "string" ? d : (d && typeof d === "object" && "message" in d ? `${(d as {message: string}).message} ${(d as {hint?: string}).hint ?? ""}`.trim() : "Processing failed"));
      setStep("upload");
    } finally {
      setProcessing(false);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
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
    } else if (inputMode === "camera" && !capturedImage) {
      setError("Please capture a photo first"); return;
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

      } else if (inputMode === "camera" && capturedImage) {
        const imageFile = dataURLtoFile(capturedImage, "camera.jpg");
        const imgV = validateImage(imageFile);
        if (!imgV.valid) { setError(imgV.error!); setUploading(false); return; }
        setExtractingText(true);
        let extracted = "";
        try {
          const extRes = await extractImageText(imageFile);
          extracted = extRes.data.text;
        } finally { setExtractingText(false); }
        if (!extracted || extracted.trim().length < 50) {
          setError("Couldn't read enough text from the photo. Try better lighting or a closer shot.");
          setUploading(false); return;
        }
        const res = await uploadText(extracted, "Camera capture");
        lectureId = res.data.id;
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

  // ── Camera ────────────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setCameraError("");
    setCapturedImage(null);
    setCapturedValidation(null);
    setSteadyCount(0);
    setAutoCapturing(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      setCameraActive(true);
    } catch {
      setCameraError("Camera access denied. Allow camera permission and try again.");
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraActive(false);
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
  }, []);

  const capturePhoto = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.95);
    setCapturedImage(dataUrl);
    // Validate the captured image
    const f = dataURLtoFile(dataUrl, "capture.jpg");
    setCapturedValidation(validateImage(f));
    stopCamera();
  }, [stopCamera]);

  const resetCamera = useCallback(() => {
    setCapturedImage(null);
    setCapturedValidation(null);
    setError("");
    startCamera();
  }, [startCamera]);

  // ── Input mode switch ──────────────────────────────────────────────────────
  const switchInputMode = (m: InputMode) => {
    if (inputMode === "camera") stopCamera();
    setInputMode(m);
    setError("");
    setCapturedImage(null);
    setCapturedValidation(null);
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
    )) ||
    (inputMode === "camera" && !!capturedImage && (capturedValidation?.valid ?? true))
  );

  const submitLabel = extractingText ? "Extracting text from image…"
    : uploading ? "Uploading…"
    : mode === "harder" ? "Generate Harder Questions"
    : mode === "exam"   ? "Generate Exam Questions"
    : "Generate High Yield MCQs";

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

  // ── Processing / Done screens ──────────────────────────────────────────────
  if (step === "process" || step === "done") {
    return (
      <div className="min-h-screen flex items-center justify-center relative bg-background">
        <div className="grain-overlay" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary/20 rounded-full blur-[120px] pointer-events-none" />
        <Card className="relative z-10 glass-panel border-border/50 max-w-md mx-4 w-full">
          <CardContent className="p-6 sm:p-12 text-center">
            {step === "process" ? (
              <>
                <div className="w-20 h-20 rounded-2xl synapse-gradient flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/30">
                  <Loader2 className="w-10 h-10 text-white animate-spin" />
                </div>
                <h2 className="text-2xl font-bold text-foreground mb-2">Processing your content…</h2>
                <p className="text-muted-foreground mb-6">
                  AI is generating MCQs in <span className="text-cyan-400 font-bold">{modeLabel}</span>
                </p>
                {timeEstimate && (
                  <div className="mb-4 px-5 py-3 rounded-xl bg-muted text-left space-y-1">
                    <p className="text-sm text-cyan-400 font-medium">
                      Estimated: <span className="font-bold text-foreground">{timeEstimate.estimated_range}</span>
                    </p>
                    {timeEstimate.chunks > 1 && (
                      <p className="text-xs text-muted-foreground">
                        {timeEstimate.chunks} chunk{timeEstimate.chunks > 1 ? "s" : ""}
                        {(timeEstimate.keys ?? 1) > 1 && ` · ${timeEstimate.keys} keys in parallel`}
                      </p>
                    )}
                    {timeEstimate.estimated_seconds && elapsed < timeEstimate.estimated_seconds && (
                      <p className="text-xs text-muted-foreground">
                        ~{Math.max(0, timeEstimate.estimated_seconds - elapsed)}s remaining
                      </p>
                    )}
                  </div>
                )}
                <Progress
                  value={timeEstimate?.estimated_seconds
                    ? Math.min(95, (elapsed / timeEstimate.estimated_seconds) * 100)
                    : 50}
                  className="h-2 mb-3"
                />
                <p className="text-xs text-muted-foreground">{elapsed}s elapsed</p>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Done! Redirecting…</h2>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // ── Main upload page ───────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col">
      <div className="grain-overlay" />

      {/* Header */}
      {!isInTelegram && (
        <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-card/80 backdrop-blur-xl z-50 border-b border-border/50">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <Link href="/dashboard" className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">
              cortexQ
            </Link>
          </div>
          <nav className="hidden md:flex items-center gap-8">
            <span className="text-primary font-bold text-sm tracking-wide">+ Upload</span>
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Dashboard</Link>
            <Link href="/analytics" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">Analytics</Link>
          </nav>
        </header>
      )}

      <main className={`flex-grow flex flex-col items-center justify-center px-4 sm:px-6 max-w-5xl mx-auto w-full ${isInTelegram ? "pt-6 pb-24" : "pt-24 pb-32"}`}>
        <section className="w-full text-center space-y-8">

          {/* Heading */}
          <div className="space-y-3">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-foreground">
              Expand Your Intelligence
            </h1>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg font-medium leading-relaxed">
              Upload a PDF, snap a photo, or paste your notes — AI converts them into exam-ready MCQs.
            </p>
          </div>

          {/* Mode Selector */}
          <div className="w-full max-w-3xl mx-auto">
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
                  <p className="font-bold text-foreground mb-1">High Yield MCQs</p>
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

          {/* Input Mode Tabs */}
          <div className="w-full max-w-3xl mx-auto">
            <div className="flex gap-2 justify-center mb-6">
              {([
                { id: "file",   icon: CloudUpload,    label: "PDF File" },
                { id: "camera", icon: Camera,         label: "Camera"   },
                { id: "paste",  icon: ClipboardPaste, label: "Paste"    },
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

            {/* ── CAMERA ───────────────────────────────────────────────── */}
            {inputMode === "camera" && (
              <div className="relative group">
                <div className="absolute -inset-1 synapse-gradient rounded-xl blur opacity-10 group-hover:opacity-20 transition duration-500" />
                <div className="relative rounded-xl overflow-hidden border border-border/40 bg-black min-h-[300px] flex flex-col items-center justify-center">

                  {capturedImage ? (
                    /* ── Preview ── */
                    <div className="w-full flex flex-col items-center gap-4 p-6">
                      <div className="relative w-full max-w-md rounded-xl overflow-hidden border border-emerald-500/30">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={capturedImage} alt="Captured" className="w-full object-contain max-h-64" />
                        <div className="absolute top-2 right-2 bg-emerald-500/20 border border-emerald-500/40 rounded-full px-3 py-1 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-400 text-xs font-semibold">Captured</span>
                        </div>
                      </div>
                      <ValidationBadge v={capturedValidation} />
                      {capturedValidation?.valid && (
                        <p className="text-sm text-muted-foreground">AI will extract text from this image</p>
                      )}
                      <Button variant="outline" size="sm" onClick={resetCamera} className="gap-2">
                        <RotateCcw className="w-4 h-4" />Retake
                      </Button>
                    </div>

                  ) : cameraActive ? (
                    /* ── Live feed ── */
                    <div className="w-full flex flex-col items-center gap-3 p-4">
                      <div className="relative w-full max-w-md rounded-xl overflow-hidden bg-black">
                        <video ref={videoRef} autoPlay playsInline muted className="w-full object-contain max-h-72" />

                        {/* Document frame overlay */}
                        <div className="absolute inset-4 pointer-events-none">
                          {/* Corner brackets */}
                          {[
                            "top-0 left-0 border-t-2 border-l-2 rounded-tl",
                            "top-0 right-0 border-t-2 border-r-2 rounded-tr",
                            "bottom-0 left-0 border-b-2 border-l-2 rounded-bl",
                            "bottom-0 right-0 border-b-2 border-r-2 rounded-br",
                          ].map((cls, i) => (
                            <div key={i} className={`absolute w-6 h-6 border-white ${cls}`} />
                          ))}

                          {/* Scanning line */}
                          <div
                            className="absolute left-0 right-0 h-[2px] pointer-events-none transition-none"
                            style={{
                              top: `${scanLine}%`,
                              background: "linear-gradient(90deg, transparent, rgba(0,210,253,0.8), transparent)",
                              boxShadow: "0 0 8px rgba(0,210,253,0.6)",
                            }}
                          />

                          {/* Status badge */}
                          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 rounded-full px-3 py-1">
                            <ScanLine className="w-3.5 h-3.5 text-cyan-400" />
                            <span className="text-cyan-400 text-xs font-semibold">
                              {autoCapturing ? "Hold steady…" : "Align document in frame"}
                            </span>
                          </div>
                        </div>
                      </div>

                      <p className="text-xs text-muted-foreground">Position your notes to fill the frame, then capture</p>

                      <div className="flex gap-3">
                        <Button onClick={capturePhoto} className="synapse-gradient text-white gap-2 rounded-xl px-6">
                          <Camera className="w-4 h-4" />Capture
                        </Button>
                        <Button variant="outline" size="sm" onClick={stopCamera}>Cancel</Button>
                      </div>
                    </div>

                  ) : (
                    /* ── Start screen ── */
                    <div className="flex flex-col items-center gap-5 p-10">
                      {cameraError ? (
                        <div className="flex flex-col items-center gap-3">
                          <XCircle className="w-10 h-10 text-destructive" />
                          <p className="text-sm text-destructive text-center max-w-xs">{cameraError}</p>
                        </div>
                      ) : (
                        <div className="w-20 h-20 rounded-2xl synapse-gradient flex items-center justify-center shadow-lg shadow-primary/20">
                          <Camera className="w-10 h-10 text-white" />
                        </div>
                      )}
                      <div className="text-center">
                        <h3 className="text-xl font-bold text-foreground mb-1">Snap Your Notes</h3>
                        <p className="text-sm text-muted-foreground max-w-xs">
                          Take a photo of handwritten notes, a textbook page, or a whiteboard — AI extracts the text.
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs">
                        <Button onClick={startCamera} className="synapse-gradient text-white gap-2 rounded-xl flex-1">
                          <Camera className="w-4 h-4" />Open Camera
                        </Button>
                        {/* Phone gallery fallback */}
                        <Button
                          variant="outline"
                          className="gap-2 rounded-xl flex-1"
                          onClick={() => galleryInputRef.current?.click()}
                        >
                          <ImagePlus className="w-4 h-4" />From Gallery
                        </Button>
                        <input
                          ref={galleryInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (!f) return;
                            const v = validateImage(f);
                            if (!v.valid) { setError(v.error!); return; }
                            setError("");
                            const reader = new FileReader();
                            reader.onload = (ev) => {
                              const dataUrl = ev.target?.result as string;
                              setCapturedImage(dataUrl);
                              setCapturedValidation(v);
                            };
                            reader.readAsDataURL(f);
                          }}
                        />
                      </div>
                    </div>
                  )}
                  <canvas ref={canvasRef} className="hidden" />
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
                    <div className="absolute top-3 right-3 text-xs text-muted-foreground pointer-events-none">
                      {pasteText.length > 0 ? `${pasteText.length.toLocaleString()} chars` : "Ctrl+V to paste"}
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

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-card/95 backdrop-blur-lg rounded-t-3xl border-t border-border/50">
        <Link href="/dashboard" className="flex flex-col items-center text-muted-foreground">
          <Home className="w-6 h-6" />
          <span className="text-[10px] uppercase tracking-widest mt-1">Home</span>
        </Link>
        <div className="flex flex-col items-center text-primary scale-110 -translate-y-2">
          <div className="w-12 h-12 rounded-full synapse-gradient flex items-center justify-center shadow-lg shadow-primary/30">
            <Plus className="w-7 h-7 text-white" />
          </div>
        </div>
        <Link href="/analytics" className="flex flex-col items-center text-muted-foreground">
          <BarChart3 className="w-6 h-6" />
          <span className="text-[10px] uppercase tracking-widest mt-1">Stats</span>
        </Link>
      </nav>

      {/* Blobs */}
      <div className="fixed top-1/4 -left-20 w-80 h-80 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-1/4 -right-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
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
