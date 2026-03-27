"use client";
import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { uploadLecture, processLecture, estimateProcessing, Difficulty } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";
import { Suspense } from "react";

type Tab = "study" | "exam";
type Mode = "highyield" | "exam" | "harder";

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
  const [tab, setTab] = useState<Tab>("study");
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
      return;
    }
    // Handle file shared via PWA share target
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
      // non-fatal — proceed without estimate
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

  const modeLabel =
    mode === "harder" ? "Harder Mode" :
    mode === "exam"   ? "Exam Mode"   :
                        "High Yield";

  if (step === "process" || step === "done") {
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
              <p className="text-xs text-gray-400 mt-3">{elapsed}s elapsed</p>
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

        {/* Tab switcher */}
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-1 flex">
          <button
            onClick={() => handleTabChange("study")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === "study" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Study
          </button>
          <button
            onClick={() => handleTabChange("exam")}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium transition-all ${
              tab === "exam" ? "bg-gray-900 text-white" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
            </svg>
            Exam
          </button>
        </div>

        {/* Mode cards */}
        <div className="mb-6 space-y-3">
          {tab === "study" ? (
            <button
              onClick={() => setMode("highyield")}
              className="w-full relative p-5 rounded-xl border-2 text-left transition-all border-blue-500 bg-blue-50"
            >
              <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-blue-500" />
              <p className="font-semibold text-sm text-blue-700">High Yield MCQs</p>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Systematic, topic-balanced questions. Covers all lecture sections with clinical vignettes, mechanism questions, and exception formats.
              </p>
              <ul className="mt-3 space-y-1.5">
                {[
                  "Balanced mix across all lecture topics",
                  "Clinical vignettes, mechanism questions, and exception formats",
                  "Summary and key concepts",
                ].map((item) => (
                  <li key={item} className="text-xs text-blue-700 flex items-start gap-1.5">
                    <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </button>
          ) : (
            <>
              {/* Hard sub-option */}
              <button
                onClick={() => setMode("exam")}
                className={`w-full relative p-5 rounded-xl border-2 text-left transition-all ${
                  mode === "exam"
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                {mode === "exam" && (
                  <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-blue-500" />
                )}
                <p className={`font-semibold text-sm ${mode === "exam" ? "text-blue-700" : "text-gray-800"}`}>
                  Hard
                </p>
                <p className={`text-xs mt-0.5 ${mode === "exam" ? "text-blue-600" : "text-gray-500"}`}>
                  Smart studying that also prepares for exams
                </p>
                <ul className="mt-3 space-y-1.5">
                  {[
                    "40% \"All FALSE EXCEPT\" questions for real exam prep",
                    "Clinical vignettes with specific labs and patient scenarios",
                    "Mechanism and classification trap questions",
                  ].map((item) => (
                    <li
                      key={item}
                      className={`text-xs flex items-start gap-1.5 ${mode === "exam" ? "text-blue-700" : "text-gray-500"}`}
                    >
                      <span
                        className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          mode === "exam" ? "bg-blue-400" : "bg-gray-300"
                        }`}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </button>

              {/* Harder sub-option */}
              <button
                onClick={() => setMode("harder")}
                className={`w-full relative p-5 rounded-xl border-2 text-left transition-all ${
                  mode === "harder"
                    ? "border-gray-800 bg-gray-900"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                {mode === "harder" && (
                  <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-white" />
                )}
                <p className={`font-semibold text-sm ${mode === "harder" ? "text-white" : "text-gray-800"}`}>
                  Harder
                </p>
                <p className={`text-xs mt-0.5 ${mode === "harder" ? "text-gray-400" : "text-gray-500"}`}>
                  Real exam pressure mode — no mercy
                </p>
                <ul className="mt-3 space-y-1.5">
                  {[
                    "~50% \"All FALSE EXCEPT\" questions like real boards",
                    "Multi-step clinical vignettes with complex reasoning",
                    "Classification traps, exact mechanisms, max difficulty",
                  ].map((item) => (
                    <li
                      key={item}
                      className={`text-xs flex items-start gap-1.5 ${mode === "harder" ? "text-gray-300" : "text-gray-500"}`}
                    >
                      <span
                        className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          mode === "harder" ? "bg-gray-500" : "bg-gray-300"
                        }`}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </button>

              {/* Difficulty bar */}
              <div className="pt-1 pb-0.5">
                <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                  <span>Easier</span>
                  <span>Harder</span>
                </div>
                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300 bg-blue-500"
                    style={{ width: mode === "harder" ? "100%" : "60%",
                             backgroundColor: mode === "harder" ? "#111827" : undefined }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* File drop zone */}
        <div
          className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors cursor-pointer ${
            dragging
              ? "border-blue-400 bg-blue-50"
              : file
              ? "border-green-400 bg-green-50"
              : "border-gray-200 hover:border-gray-300 bg-white"
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
              mode === "harder"
                ? "bg-gray-900 hover:bg-black"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {uploading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                Uploading...
              </span>
            ) : mode === "harder"
              ? "Generate Harder Questions"
              : mode === "exam"
              ? "Generate Exam Questions"
              : "Generate High Yield MCQs"}
          </button>
        )}

        {/* Info box */}
        <div
          className={`mt-6 rounded-xl p-4 ${
            mode === "harder" ? "bg-gray-900" : "bg-blue-50"
          }`}
        >
          <p
            className={`text-sm font-medium mb-2 ${
              mode === "harder" ? "text-white" : "text-blue-800"
            }`}
          >
            {mode === "harder"
              ? "Harder Mode generates:"
              : mode === "exam"
              ? "Exam Mode generates:"
              : "High Yield Mode generates:"}
          </p>
          <ul
            className={`text-sm space-y-1 ${
              mode === "harder" ? "text-gray-300" : "text-blue-700"
            }`}
          >
            {mode === "harder" ? (
              <>
                <li>1. ~50% &ldquo;All FALSE EXCEPT&rdquo; questions — one true, three plausible false</li>
                <li>2. Multi-step clinical vignettes with exact lab values and competing comorbidities</li>
                <li>3. Classification traps, drug mechanism traps, and exception questions</li>
              </>
            ) : mode === "exam" ? (
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
