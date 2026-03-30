"use client";
import { useState, useRef, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { uploadLecture, processLecture, estimateProcessing, Difficulty } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";
import { useTelegram } from "@/lib/useTelegram";

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
  const [timeEstimate, setTimeEstimate] = useState<{ estimated_range: string; chunks: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Telegram MainButton control ──────────────────────────────────────────
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
      mainButton.setText("Processing…").showProgress(true).disable();
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
      fetch(`/api/bot/temp/${tgFileToken}`)
        .then(async (res) => {
          if (!res.ok) return;
          const fileName = res.headers.get("X-File-Name") || "lecture.pdf";
          const blob = await res.blob();
          setFile(new File([blob], fileName, { type: "application/pdf" }));
        })
        .catch(() => {});
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
      <div className="min-h-screen flex items-center justify-center relative" style={{ backgroundColor: "#111220" }}>
        <div className="grain-overlay" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary-container/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="relative z-10 text-center glass-panel rounded-3xl p-12 max-w-md mx-4">
          {step === "process" ? (
            <>
              <div className="w-20 h-20 rounded-2xl synapse-gradient flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary-container/30">
                <span className="material-symbols-outlined text-4xl text-white animate-spin" style={{ animationDuration: "2s" }}>autorenew</span>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Processing your lecture…</h2>
              <p className="text-on-surface-variant mb-6">
                AI is generating MCQs in <span className="text-secondary font-bold">{modeLabel}</span>
              </p>
              {timeEstimate && (
                <div className="mb-4 px-5 py-3 rounded-xl bg-surface-container-highest text-left">
                  <p className="text-sm text-secondary font-medium">
                    Estimated: <span className="font-bold text-white">{timeEstimate.estimated_range}</span>
                  </p>
                  {timeEstimate.chunks > 1 && (
                    <p className="text-xs text-on-surface-variant mt-0.5">Processing in {timeEstimate.chunks} chunks</p>
                  )}
                </div>
              )}
              <div className="w-full h-2 bg-surface-container-highest rounded-full overflow-hidden">
                <div className="h-full synapse-gradient rounded-full w-full animate-pulse" />
              </div>
              <p className="text-xs text-on-surface-variant mt-3">{elapsed}s elapsed</p>
            </>
          ) : (
            <>
              <div className="w-20 h-20 rounded-2xl bg-green-500/20 flex items-center justify-center mx-auto mb-6">
                <span className="material-symbols-outlined text-4xl text-green-400">check_circle</span>
              </div>
              <h2 className="text-2xl font-bold text-white">Done! Redirecting…</h2>
            </>
          )}
        </div>
      </div>
    );
  }

  // Upload state
  return (
    <div className="relative min-h-screen text-on-surface flex flex-col" style={{ backgroundColor: "#111220", backgroundImage: "radial-gradient(at 0% 0%, rgba(123,47,255,0.1) 0px, transparent 50%), radial-gradient(at 100% 100%, rgba(0,210,253,0.1) 0px, transparent 50%)" }}>
      <div className="grain-overlay" />

      {/* Header — hidden inside Telegram (Telegram provides its own chrome) */}
      {!isInTelegram && <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)]">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="text-on-surface-variant hover:text-white transition-colors">
            <span className="material-symbols-outlined">arrow_back</span>
          </Link>
          <span className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">cortexQ</span>
        </div>
        <nav className="hidden md:flex items-center gap-8">
          <a className="text-[#00D2FD] font-bold text-sm tracking-wide">+ Upload</a>
          <Link href="/dashboard" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Dashboard</Link>
          <Link href="/analytics" className="text-slate-400 hover:text-white transition-colors text-sm font-medium">Analytics</Link>
        </nav>
      </header>}

      <main className={`flex-grow flex flex-col items-center justify-center px-6 max-w-5xl mx-auto w-full ${isInTelegram ? "pt-6 pb-24" : "pt-24 pb-32"}`}>
        <section className="w-full text-center space-y-10">

          {/* Heading */}
          <div className="space-y-4">
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-white">Expand Your Intelligence</h1>
            <p className="text-on-surface-variant max-w-xl mx-auto text-lg font-medium leading-relaxed">
              Upload your lecture notes or textbooks. Our AI transforms them into structured mastery tools.
            </p>
          </div>

          {/* Mode Selector */}
          <div className="w-full max-w-3xl mx-auto">
            {/* Tab switcher */}
            <div className="mb-4 glass-panel rounded-xl p-1 flex max-w-xs mx-auto">
              <button
                onClick={() => handleTabChange("study")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${tab === "study" ? "synapse-gradient text-white" : "text-on-surface-variant hover:text-white"}`}
              >
                <span className="material-symbols-outlined text-sm">menu_book</span>
                Study
              </button>
              <button
                onClick={() => handleTabChange("exam")}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-bold transition-all ${tab === "exam" ? "synapse-gradient text-white" : "text-on-surface-variant hover:text-white"}`}
              >
                <span className="material-symbols-outlined text-sm">military_tech</span>
                Exam
              </button>
            </div>

            {/* Mode cards */}
            {tab === "study" ? (
              <div className="glass-panel p-5 rounded-xl border-l-4 border-primary-container text-left">
                <p className="font-bold text-white mb-1">High Yield MCQs</p>
                <p className="text-xs text-on-surface-variant">Balanced mix across all lecture topics with clinical vignettes, mechanism questions, and key concept summaries.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => setMode("exam")}
                  className={`p-5 rounded-xl text-left transition-all border-l-4 ${mode === "exam" ? "glass-panel border-primary-container" : "bg-surface-container-low/40 border-transparent hover:border-outline-variant"}`}
                >
                  <p className={`font-bold mb-1 ${mode === "exam" ? "text-white" : "text-on-surface-variant"}`}>Hard</p>
                  <p className="text-xs text-on-surface-variant">40% &ldquo;All FALSE EXCEPT&rdquo; questions, clinical vignettes, mechanism traps.</p>
                </button>
                <button
                  onClick={() => setMode("harder")}
                  className={`p-5 rounded-xl text-left transition-all border-l-4 ${mode === "harder" ? "glass-panel border-secondary-container" : "bg-surface-container-low/40 border-transparent hover:border-outline-variant"}`}
                >
                  <p className={`font-bold mb-1 ${mode === "harder" ? "text-white" : "text-on-surface-variant"}`}>Harder</p>
                  <p className="text-xs text-on-surface-variant">~50% &ldquo;All FALSE EXCEPT&rdquo; like real boards. Multi-step vignettes, max difficulty.</p>
                </button>
              </div>
            )}
          </div>

          {/* Upload Zone */}
          <div className="relative group w-full max-w-3xl mx-auto">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary-container to-secondary-container rounded-xl blur opacity-10 group-hover:opacity-25 transition duration-500" />
            <div
              className={`relative flex flex-col items-center justify-center w-full min-h-[280px] border-2 border-dashed rounded-xl px-8 py-12 cursor-pointer transition-all duration-300 ${
                dragging ? "border-secondary-container/80 bg-secondary-container/5" : file ? "border-green-500/50 bg-green-500/5" : "border-primary-container/40 bg-surface-container-low/60 hover:border-secondary-container/60 hover:-translate-y-1"
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
              {file ? (
                <>
                  <div className="w-16 h-16 rounded-2xl bg-green-500/20 flex items-center justify-center mb-4">
                    <span className="material-symbols-outlined text-4xl text-green-400">description</span>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-1">{file.name}</h3>
                  <p className="text-on-surface-variant text-sm">{(file.size / 1024 / 1024).toFixed(2)} MB · Click to change</p>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 rounded-2xl synapse-gradient flex items-center justify-center mb-6 shadow-lg shadow-primary-container/20">
                    <span className="material-symbols-outlined text-4xl text-white">cloud_upload</span>
                  </div>
                  <h3 className="text-2xl font-bold text-white mb-2">Drag &amp; Drop your PDF here</h3>
                  <p className="text-on-surface-variant mb-6 font-medium">PDF files up to 50MB</p>
                  <button className="px-8 py-3 bg-surface-variant/40 border border-outline-variant/20 rounded-lg font-bold text-secondary transition-all hover:bg-surface-variant/60 hover:scale-105 active:scale-95">
                    Browse Files
                  </button>
                </>
              )}
            </div>
          </div>

          {error && (
            <div className="w-full max-w-3xl mx-auto bg-error/10 border border-error/20 text-error rounded-xl px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* In Telegram the MainButton handles this; in browser we show the regular button */}
          {file && !isInTelegram && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full max-w-3xl mx-auto synapse-gradient text-white font-bold py-4 rounded-xl shadow-[0px_8px_24px_rgba(123,47,255,0.3)] hover:shadow-[0px_12px_32px_rgba(0,210,253,0.4)] hover:-translate-y-1 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                  Uploading…
                </span>
              ) : mode === "harder" ? "Generate Harder Questions" : mode === "exam" ? "Generate Exam Questions" : "Generate High Yield MCQs"}
            </button>
          )}

          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full pt-6">
            {[
              { icon: "quiz", color: "primary", label: "MCQ Questions", desc: "Automated multiple choice questions based on key concepts found in your text." },
              { icon: "summarize", color: "secondary", label: "Smart Summary", desc: "High-level overview of complex topics, distilled into readable bullet points." },
              { icon: "style", color: "tertiary", label: "Flashcard Deck", desc: "Spaced-repetition ready cards automatically generated for long-term retention." },
            ].map((c) => (
              <div key={c.label} className="glass-panel p-6 rounded-xl flex flex-col items-start text-left hover:-translate-y-1 transition-transform duration-300">
                <div className="w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center mb-4">
                  <span className={`material-symbols-outlined text-${c.color}`}>{c.icon}</span>
                </div>
                <h4 className="text-lg font-bold text-white mb-2">{c.label}</h4>
                <p className="text-sm text-on-surface-variant leading-relaxed">{c.desc}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-slate-950/90 backdrop-blur-lg rounded-t-3xl border-t border-white/5">
        <Link href="/dashboard" className="flex flex-col items-center text-slate-500">
          <span className="material-symbols-outlined text-[24px]">home</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Home</span>
        </Link>
        <div className="flex flex-col items-center text-[#00D2FD] scale-110 -translate-y-2">
          <div className="w-12 h-12 rounded-full synapse-gradient flex items-center justify-center shadow-lg shadow-primary-container/30">
            <span className="material-symbols-outlined text-white text-[28px]">add</span>
          </div>
        </div>
        <Link href="/analytics" className="flex flex-col items-center text-slate-500">
          <span className="material-symbols-outlined text-[24px]">insights</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Stats</span>
        </Link>
      </nav>

      {/* Decorative blobs */}
      <div className="fixed top-1/4 -left-20 w-80 h-80 bg-primary-container/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="fixed bottom-1/4 -right-20 w-80 h-80 bg-secondary-container/10 rounded-full blur-[120px] pointer-events-none" />
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#111220" }}>
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-container" />
      </div>
    }>
      <UploadContent />
    </Suspense>
  );
}
