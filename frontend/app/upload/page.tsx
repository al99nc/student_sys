"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { uploadLecture, processLecture, estimateProcessing } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";
import { Suspense } from "react";

type Mode = "highyield" | "exam";

function UploadContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const processId = searchParams.get("process");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"upload" | "process" | "done">("upload");
  const [mode, setMode] = useState<Mode>("highyield");
  const [timeEstimate, setTimeEstimate] = useState<{ estimated_range: string; chunks: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/auth");
      return;
    }
    if (processId) {
      handleProcess(parseInt(processId));
    }
  }, [processId, router]);

  const handleProcess = async (id: number) => {
    setStep("process");
    setProcessing(true);
    setElapsed(0);
    setError("");

    // Fetch time estimate
    try {
      const est = await estimateProcessing(id, mode);
      setTimeEstimate(est.data);
    } catch {
      // non-fatal — proceed without estimate
    }

    // Start elapsed timer
    elapsedRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      await processLecture(id, mode);
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

  if (step === "process" || step === "done") {
    const modeLabel = mode === "exam" ? "Exam Mode" : "High Yield";
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          {step === "process" ? (
            <>
              <div className="animate-spin rounded-full h-14 w-14 border-b-2 border-blue-600 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900">Processing your lecture...</h2>
              <p className="text-gray-500 text-sm mt-2">
                AI is generating MCQs in <span className="font-medium text-blue-600">{modeLabel}</span>
              </p>
              {timeEstimate && (
                <div className="mt-4 bg-blue-50 rounded-xl px-5 py-3 inline-block text-left">
                  <p className="text-sm text-blue-700 font-medium">
                    Estimated time: <span className="font-semibold">{timeEstimate.estimated_range}</span>
                  </p>
                  {timeEstimate.chunks > 1 && (
                    <p className="text-xs text-blue-500 mt-0.5">
                      Processing in {timeEstimate.chunks} chunks
                    </p>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400 mt-3">
                {elapsed}s elapsed
              </p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Done! Redirecting...</h2>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/dashboard" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="font-semibold text-gray-900">Upload Lecture</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10">

        {/* Mode selector */}
        <div className="mb-6">
          <p className="text-sm font-medium text-gray-700 mb-3">Select generation mode</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setMode("highyield")}
              className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                mode === "highyield"
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              {mode === "highyield" && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blue-500" />
              )}
              <p className={`font-semibold text-sm ${mode === "highyield" ? "text-blue-700" : "text-gray-800"}`}>
                High Yield MCQs
              </p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Systematic, topic-balanced questions. Covers all lecture sections with clinical vignettes, mechanism questions, and exception formats.
              </p>
            </button>

            <button
              onClick={() => setMode("exam")}
              className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                mode === "exam"
                  ? "border-red-500 bg-red-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              {mode === "exam" && (
                <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
              )}
              <p className={`font-semibold text-sm ${mode === "exam" ? "text-red-700" : "text-gray-800"}`}>
                Exam Mode
              </p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Simulates a real licensing exam. Heavy use of &ldquo;all FALSE EXCEPT&rdquo;, clinical vignettes, drug classification traps, and combination options.
              </p>
            </button>
          </div>
        </div>

        {/* File drop zone */}
        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer ${
            dragging ? "border-blue-400 bg-blue-50" : file ? "border-green-400 bg-green-50" : "border-gray-200 hover:border-gray-300 bg-white"
          }`}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />

          {file ? (
            <>
              <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <p className="font-medium text-gray-900">{file.name}</p>
              <p className="text-sm text-gray-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              <p className="text-xs text-gray-400 mt-2">Click to change file</p>
            </>
          ) : (
            <>
              <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="font-medium text-gray-900">Drop your PDF here</p>
              <p className="text-sm text-gray-400 mt-1">or click to browse</p>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
            {error}
          </div>
        )}

        {file && (
          <button
            onClick={handleUpload}
            disabled={uploading}
            className={`mt-6 w-full disabled:opacity-50 text-white font-medium py-3 rounded-xl transition-colors ${
              mode === "exam"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {uploading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Uploading...
              </span>
            ) : mode === "exam" ? "Generate Exam Questions" : "Generate High Yield MCQs"}
          </button>
        )}

        <div className={`mt-6 rounded-xl p-4 ${mode === "exam" ? "bg-red-50" : "bg-blue-50"}`}>
          <p className={`text-sm font-medium mb-2 ${mode === "exam" ? "text-red-800" : "text-blue-800"}`}>
            {mode === "exam" ? "Exam Mode generates:" : "High Yield Mode generates:"}
          </p>
          <ul className={`text-sm space-y-1 ${mode === "exam" ? "text-red-700" : "text-blue-700"}`}>
            {mode === "exam" ? (
              <>
                <li>1. &ldquo;All FALSE EXCEPT&rdquo; and exception questions (~40%)</li>
                <li>2. Clinical vignettes with specific patient scenarios (~35%)</li>
                <li>3. Exact mechanism and classification traps (~25%)</li>
              </>
            ) : (
              <>
                <li>1. Balanced mix across all lecture topics</li>
                <li>2. Clinical vignettes, mechanism questions, and exception formats</li>
                <li>3. Summary and key concepts</li>
              </>
            )}
          </ul>
        </div>
      </main>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>}>
      <UploadContent />
    </Suspense>
  );
}
