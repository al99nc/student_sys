"use client";
import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { uploadLecture, processLecture, estimateProcessing, Difficulty } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { useTelegram } from "@/lib/useTelegram";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  CloudUpload,
  FileText,
  Loader2,
  CheckCircle2,
  BookOpen,
  Medal,
  Brain,
  Layers,
  Home,
  Plus,
  BarChart3
} from "lucide-react";

type Tab = "study" | "exam";
type Mode = "highyield" | "exam" | "harder";

function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processId = searchParams.get("process");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { isInTelegram, mainButton } = useTelegram();

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"upload" | "process" | "done">("upload");
  const [tab, setTab] = useState<Tab>("study");
  const [mode, setMode] = useState<Mode>("highyield");
  const [timeEstimate, setTimeEstimate] = useState<{ estimated_range: string; chunks: number; keys?: number; estimated_seconds?: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tgFileLoading, setTgFileLoading] = useState(false);
  const [tgFileReady, setTgFileReady] = useState(false);

  // Telegram MainButton control
  useEffect(() => {
    if (!isInTelegram || !mainButton) return;

    if (file && step === "upload" && !uploading) {
      const label =
        mode === "harder"
          ? "Generate Harder Questions"
          : mode === "exam"
          ? "Generate Exam Questions"
          : "Generate High Yield MCQs";
      mainButton.setText(label).show().enable();
      mainButton.onClick(handleUpload);
      return () => { mainButton.offClick(handleUpload); };
    } else {
      mainButton.hide();
    }
  }, [isInTelegram, mainButton, file, step, uploading, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isInTelegram || !mainButton) return;
    if (uploading || processing) {
      mainButton.setText("Processing...").showProgress(true).disable();
    } else if (step === "done") {
      mainButton.hideProgress().setText("Done!").disable();
    }
  }, [isInTelegram, mainButton, uploading, processing, step]);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    if (processId) {
      handleProcess(parseInt(processId));
      return;
    }
    const isShared = searchParams.get("shared") === "1";
    if (isShared) {
      caches.open("share-target-v1").then(async (cache) => {
        const response = await cache.match("/shared-file");
        if (response) {
          const blob = await response.blob();
          const fileName = response.headers.get("X-File-Name") || "shared.pdf";
          const sharedFile = new File([blob], fileName, { type: "application/pdf" });
          setFile(sharedFile);
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
          setFile(new File([blob], fileName, { type: "application/pdf" }));
          setTgFileReady(true);
        })
        .catch(() => {})
        .finally(() => setTgFileLoading(false));
    }
  }, [processId, router, searchParams]);

  const handleTabChange = (newTab: Tab) => {
    setTab(newTab);
    setMode(newTab === "study" ? "highyield" : "exam");
  };

  const handleProcess = async (id: number) => {
    setStep("process");
    setProcessing(true);
    setElapsed(0);
    setError("");
    try {
      const est = await estimateProcessing(id, mode as Difficulty);
      setTimeEstimate(est.data);
    } catch {
      // non-fatal
    }
    elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    try {
      await processLecture(id, mode as Difficulty);
      setStep("done");
      setTimeout(() => router.push(`/results/${id}`), 1500);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Processing failed");
      setStep("upload");
    } finally {
      setProcessing(false);
      if (elapsedRef.current) clearInterval(elapsedRef.current);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.type === "application/pdf") {
      setFile(dropped);
      setError("");
    } else {
      setError("Please drop a PDF file");
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected?.type === "application/pdf") {
      setFile(selected);
      setError("");
    } else if (selected) {
      setError("Please select a PDF file");
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      const res = await uploadLecture(file);
      const id = res.data.id;
      await handleProcess(id);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Upload failed");
      setStep("upload");
    } finally {
      setUploading(false);
    }
  };

  const modeLabel = mode === "harder" ? "Harder Mode" : mode === "exam" ? "Exam Mode" : "High Yield";

  // Processing / Done states
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
                <h2 className="text-2xl font-bold text-foreground mb-2">Processing your lecture...</h2>
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
                        {(timeEstimate.keys ?? 1) > 1 && ` - ${timeEstimate.keys} keys in parallel`}
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
                  value={timeEstimate?.estimated_seconds ? Math.min(95, (elapsed / timeEstimate.estimated_seconds) * 100) : 50}
                  className="h-2 mb-3"
                />
                <p className="text-xs text-muted-foreground">{elapsed}s elapsed</p>
              </>
            ) : (
              <>
                <div className="w-20 h-20 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400" />
                </div>
                <h2 className="text-2xl font-bold text-foreground">Done! Redirecting...</h2>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Upload state
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
            <Link href="/dashboard" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
              Dashboard
            </Link>
            <Link href="/analytics" className="text-muted-foreground hover:text-foreground transition-colors text-sm font-medium">
              Analytics
            </Link>
          </nav>
        </header>
      )}

      <main className={`flex-grow flex flex-col items-center justify-center px-6 max-w-5xl mx-auto w-full ${isInTelegram ? "pt-6 pb-24" : "pt-24 pb-32"}`}>
        <section className="w-full text-center space-y-10">
          {/* Heading */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-foreground">
              Expand Your Intelligence
            </h1>
            <p className="text-muted-foreground max-w-xl mx-auto text-lg font-medium leading-relaxed">
              Upload your lecture notes or textbooks. Our AI transforms them into structured mastery tools.
            </p>
          </div>

          {/* Mode Selector */}
          <div className="w-full max-w-3xl mx-auto">
            <Tabs value={tab} onValueChange={(v) => handleTabChange(v as Tab)} className="mb-4">
              <TabsList className="grid w-full grid-cols-2 max-w-xs mx-auto bg-muted/50">
                <TabsTrigger value="study" className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4" />
                  Study
                </TabsTrigger>
                <TabsTrigger value="exam" className="flex items-center gap-2">
                  <Medal className="w-4 h-4" />
                  Exam
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Mode cards */}
            {tab === "study" ? (
              <Card className="glass-panel border-l-4 border-primary text-left">
                <CardContent className="p-5">
                  <p className="font-bold text-foreground mb-1">High Yield MCQs</p>
                  <p className="text-xs text-muted-foreground">
                    Balanced mix across all lecture topics with clinical vignettes, mechanism questions, and key concept summaries.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => setMode("exam")}
                  className={`p-5 rounded-xl text-left transition-all border-l-4 ${
                    mode === "exam"
                      ? "glass-panel border-primary"
                      : "bg-muted/30 border-transparent hover:border-border"
                  }`}
                >
                  <p className={`font-bold mb-1 ${mode === "exam" ? "text-foreground" : "text-muted-foreground"}`}>Hard</p>
                  <p className="text-xs text-muted-foreground">
                    40% "All FALSE EXCEPT" questions, clinical vignettes, mechanism traps.
                  </p>
                </button>
                <button
                  onClick={() => setMode("harder")}
                  className={`p-5 rounded-xl text-left transition-all border-l-4 ${
                    mode === "harder"
                      ? "glass-panel border-cyan-500"
                      : "bg-muted/30 border-transparent hover:border-border"
                  }`}
                >
                  <p className={`font-bold mb-1 ${mode === "harder" ? "text-foreground" : "text-muted-foreground"}`}>Harder</p>
                  <p className="text-xs text-muted-foreground">
                    ~50% "All FALSE EXCEPT" like real boards. Multi-step vignettes, max difficulty.
                  </p>
                </button>
              </div>
            )}
          </div>

          {/* Upload Zone */}
          <div className="relative group w-full max-w-3xl mx-auto">
            <div className="absolute -inset-1 synapse-gradient rounded-xl blur opacity-10 group-hover:opacity-25 transition duration-500" />
            <div
              className={`relative flex flex-col items-center justify-center w-full min-h-[280px] border-2 border-dashed rounded-xl px-8 py-12 transition-all duration-300 cursor-pointer ${
                tgFileLoading
                  ? "border-primary/60 bg-primary/5"
                  : dragging
                  ? "border-cyan-500/80 bg-cyan-500/5"
                  : file
                  ? "border-emerald-500/50 bg-emerald-500/5"
                  : "border-border/40 bg-muted/30 hover:border-primary/60 hover:-translate-y-1"
              }`}
              onDragOver={(e) => {
                if (!tgFileLoading) {
                  e.preventDefault();
                  setDragging(true);
                }
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                if (!tgFileLoading) handleDrop(e);
              }}
              onClick={() => {
                if (!tgFileLoading) fileInputRef.current?.click();
              }}
            >
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />

              {tgFileLoading ? (
                <div className="flex flex-col items-center justify-center w-full pointer-events-none select-none">
                  <div className="relative w-28 h-36 mb-8" style={{ animation: "floatPage 3s ease-in-out infinite" }}>
                    {[2, 1, 0].map((i) => (
                      <div
                        key={i}
                        className="absolute inset-0 rounded-xl border border-border/20 bg-muted"
                        style={{ transform: `rotate(${i * 4 - 4}deg) translate(${i * 5}px, ${i * 5}px)` }}
                      />
                    ))}
                  </div>
                  <h3 className="text-lg font-bold text-foreground mb-1">Attaching your PDF...</h3>
                  <p className="text-sm text-muted-foreground mb-5">Fetching file from Telegram</p>
                  <Progress value={40} className="w-56 h-1" />
                </div>
              ) : file ? (
                <div className="flex flex-col items-center">
                  <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-emerald-400" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-1">{file.name}</h3>
                  <p className="text-muted-foreground text-sm">
                    {(file.size / 1024 / 1024).toFixed(2)} MB - Click to change
                  </p>
                  {tgFileReady && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      Attached from Telegram
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-2xl synapse-gradient flex items-center justify-center mb-6 shadow-lg shadow-primary/20">
                    <CloudUpload className="w-10 h-10 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold text-foreground mb-2">Drag & Drop your PDF here</h3>
                  <p className="text-muted-foreground mb-6 font-medium">PDF files up to 50MB</p>
                  <Button variant="outline" className="rounded-lg">
                    Browse Files
                  </Button>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="w-full max-w-3xl mx-auto bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Upload button */}
          {file && !isInTelegram && (
            <Button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full max-w-3xl mx-auto synapse-gradient text-white font-bold py-6 rounded-xl shadow-lg hover:-translate-y-1 transition-all disabled:opacity-50"
            >
              {uploading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Uploading...
                </span>
              ) : mode === "harder"
              ? "Generate Harder Questions"
              : mode === "exam"
              ? "Generate Exam Questions"
              : "Generate High Yield MCQs"}
            </Button>
          )}

          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full pt-6">
            {[
              { icon: Brain, label: "MCQ Questions", desc: "Automated multiple choice questions based on key concepts found in your text." },
              { icon: Layers, label: "Smart Summary", desc: "High-level overview of complex topics, distilled into readable bullet points." },
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

      {/* Decorative blobs */}
      <div className="fixed top-1/4 -left-20 w-80 h-80 bg-primary/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-1/4 -right-20 w-80 h-80 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none" />
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
        </div>
      }
    >
      <UploadContent />
    </Suspense>
  );
}
