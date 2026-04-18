"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getSolved } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import {
  ArrowLeft, BookOpen, Brain, ChevronDown, ChevronUp,
  Loader2, XCircle, CheckCircle2,
} from "lucide-react";

interface SolvedMCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

interface SolvedEssay {
  question: string;
  ideal_answer: string;
  topic?: string;
  max_score: number;
}

interface SolvedData {
  lecture_id: number;
  lecture_title: string;
  created_at: string;
  mcqs: SolvedMCQ[];
  essays: SolvedEssay[];
}

export default function SolvedPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const lectureId = parseInt(id);

  const [data, setData] = useState<SolvedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    getSolved(lectureId)
      .then((res) => setData(res.data))
      .catch(() => setError("Failed to load study materials."))
      .finally(() => setLoading(false));
  }, [lectureId, router]);

  const toggle = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0f1c" }}>
        <Loader2 style={{ width: 40, height: 40, color: "#7B2FFF", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0d0f1c", gap: 16, padding: 16 }}>
        <XCircle style={{ width: 48, height: 48, color: "#f87171" }} />
        <p style={{ color: "#f87171", fontWeight: 600 }}>{error || "Not found"}</p>
        <Link href="/lectures" style={{ color: "#a78bfa", fontSize: 14, textDecoration: "underline" }}>Back to Lectures</Link>
      </div>
    );
  }

  const hasMCQs = data.mcqs.length > 0;
  const hasEssays = data.essays.length > 0;
  const totalItems = data.mcqs.length + data.essays.length;

  return (
    <div style={{ minHeight: "100vh", background: "#0d0f1c", color: "#e2e8f0", fontFamily: "inherit" }}>

      {/* Header */}
      <header style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(13,15,28,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(255,255,255,0.07)", padding: "14px 20px", display: "flex", alignItems: "center", gap: 14 }}>
        <Link href="/lectures" style={{ color: "#94a3b8", display: "flex", alignItems: "center" }}>
          <ArrowLeft style={{ width: 20, height: 20 }} />
        </Link>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, color: "#7B2FFF", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Study Guide</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.lecture_title}</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(123,47,255,0.12)", border: "1px solid rgba(123,47,255,0.25)", borderRadius: 8, padding: "5px 10px", flexShrink: 0 }}>
          <Brain style={{ width: 14, height: 14, color: "#a78bfa" }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>{totalItems} Items</span>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: "0 auto", padding: "24px 16px 80px" }}>

        {/* Intro */}
        <div style={{ background: "rgba(123,47,255,0.08)", border: "1px solid rgba(123,47,255,0.2)", borderRadius: 14, padding: "14px 18px", marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
          <BookOpen style={{ width: 20, height: 20, color: "#a78bfa", flexShrink: 0 }} />
          <p style={{ fontSize: 13, color: "#c4b5fd", lineHeight: 1.5 }}>
            Study mode — read each question, think of your answer, then expand to reveal the correct answer.
          </p>
        </div>

        {/* ── MCQs section ── */}
        {hasMCQs && (
          <div style={{ marginBottom: hasEssays ? 32 : 0 }}>
            {hasEssays && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  MCQs · {data.mcqs.length}
                </span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {data.mcqs.map((q, i) => {
                const key = `mcq-${i}`;
                const correctIdx = ["A","B","C","D"].indexOf(q.answer);
                return (
                  <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
                    {/* Question */}
                    <div style={{ padding: "18px 20px 14px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(123,47,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#a78bfa", flexShrink: 0 }}>
                          {i + 1}
                        </span>
                        {q.topic && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#7B2FFF", background: "rgba(123,47,255,0.12)", border: "1px solid rgba(123,47,255,0.25)", borderRadius: 6, padding: "2px 8px" }}>
                            {q.topic}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.65, color: "#e2e8f0", marginBottom: 12 }}>{q.question}</p>
                      {/* Options */}
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {q.options.map((opt, oi) => {
                          const label = ["A","B","C","D"][oi];
                          const isCorrect = label === q.answer;
                          return (
                            <div key={oi} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 14px", borderRadius: 10, background: isCorrect ? "rgba(16,185,129,0.1)" : "rgba(255,255,255,0.03)", border: `1px solid ${isCorrect ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.07)"}` }}>
                              <span style={{ fontSize: 13, fontWeight: 700, color: isCorrect ? "#34d399" : "#64748b", minWidth: 20, flexShrink: 0 }}>{label}.</span>
                              <span style={{ fontSize: 14, color: isCorrect ? "#d1fae5" : "#94a3b8", lineHeight: 1.5, flex: 1 }}>{opt}</span>
                              {isCorrect && <CheckCircle2 style={{ width: 16, height: 16, color: "#34d399", flexShrink: 0, marginTop: 2 }} />}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {/* Explanation toggle */}
                    {q.explanation && (
                      <>
                        <button
                          onClick={() => toggle(key)}
                          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 20px", background: expanded[key] ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", border: "none", color: "#34d399", fontSize: 13, fontWeight: 600 }}
                        >
                          <span>Explanation</span>
                          {expanded[key] ? <ChevronUp style={{ width: 16, height: 16 }} /> : <ChevronDown style={{ width: 16, height: 16 }} />}
                        </button>
                        {expanded[key] && (
                          <div style={{ padding: "14px 20px 18px", background: "rgba(16,185,129,0.05)", borderTop: "1px solid rgba(16,185,129,0.15)" }}>
                            <p style={{ fontSize: 14, lineHeight: 1.75, color: "#cbd5e1" }}>{q.explanation}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Essays section ── */}
        {hasEssays && (
          <div>
            {hasMCQs && (
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                  Essays · {data.essays.length}
                </span>
                <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.07)" }} />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {data.essays.map((q, i) => {
                const key = `essay-${i}`;
                return (
                  <div key={i} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, overflow: "hidden" }}>
                    <div style={{ padding: "18px 20px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                        <span style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(123,47,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#a78bfa", flexShrink: 0 }}>
                          {hasMCQs ? data.mcqs.length + i + 1 : i + 1}
                        </span>
                        {q.topic && (
                          <span style={{ fontSize: 11, fontWeight: 600, color: "#7B2FFF", background: "rgba(123,47,255,0.12)", border: "1px solid rgba(123,47,255,0.25)", borderRadius: 6, padding: "2px 8px" }}>
                            {q.topic}
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.65, color: "#e2e8f0" }}>{q.question}</p>
                    </div>
                    <button
                      onClick={() => toggle(key)}
                      style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 20px", background: expanded[key] ? "rgba(123,47,255,0.1)" : "rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.06)", cursor: "pointer", border: "none", color: "#a78bfa", fontSize: 13, fontWeight: 600 }}
                    >
                      <span>Ideal Answer</span>
                      {expanded[key] ? <ChevronUp style={{ width: 16, height: 16 }} /> : <ChevronDown style={{ width: 16, height: 16 }} />}
                    </button>
                    {expanded[key] && (
                      <div style={{ padding: "14px 20px 18px", background: "rgba(123,47,255,0.06)", borderTop: "1px solid rgba(123,47,255,0.15)" }}>
                        <p style={{ fontSize: 14, lineHeight: 1.75, color: "#cbd5e1", whiteSpace: "pre-wrap" }}>{q.ideal_answer}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom nav */}
        <div style={{ marginTop: 32, display: "flex", gap: 12 }}>
          <Link
            href="/lectures"
            style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 0", borderRadius: 14, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8", fontWeight: 600, fontSize: 14, textDecoration: "none" }}
          >
            <ArrowLeft style={{ width: 16, height: 16 }} />
            Lectures
          </Link>
          {hasMCQs && (
            <Link
              href={`/quiz/${lectureId}`}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 0", borderRadius: 14, background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "white", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
            >
              <Brain style={{ width: 16, height: 16 }} />
              Take MCQ Quiz
            </Link>
          )}
          {hasEssays && !hasMCQs && (
            <Link
              href={`/essay-quiz/${lectureId}`}
              style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "13px 0", borderRadius: 14, background: "linear-gradient(135deg, #7B2FFF, #00D2FD)", color: "white", fontWeight: 700, fontSize: 14, textDecoration: "none" }}
            >
              <Brain style={{ width: 16, height: 16 }} />
              Take Essay Quiz
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
