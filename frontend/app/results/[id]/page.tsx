"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getResults, processLecture } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";

interface MCQ {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
  topic?: string;
}

interface Results {
  id: number;
  lecture_id: number;
  summary: string;
  key_concepts: string[];
  mcqs: MCQ[];
  created_at: string;
}

// Group MCQs by their topic field
function groupByTopic(mcqs: MCQ[]): Record<string, MCQ[]> {
  return mcqs.reduce((acc, mcq, idx) => {
    const topic = mcq.topic || "General";
    if (!acc[topic]) acc[topic] = [];
    acc[topic].push({ ...mcq, _index: idx } as MCQ & { _index: number });
    return acc;
  }, {} as Record<string, MCQ[]>);
}

const TOPIC_EMOJIS: Record<string, string> = {
  "Pathophysiology": "🧬",
  "Diagnosis": "🔬",
  "Treatment": "💊",
  "Complications": "⚠️",
  "Anatomy": "🫀",
  "Pharmacology": "💉",
  "Neurology": "🧠",
  "Cardiology": "❤️",
  "Respiratory": "🫁",
  "General": "📋",
};

function getEmoji(topic: string): string {
  for (const [key, emoji] of Object.entries(TOPIC_EMOJIS)) {
    if (topic.toLowerCase().includes(key.toLowerCase())) return emoji;
  }
  return "📌";
}

export default function ResultsPage() {
  const params = useParams();
  const router = useRouter();
  const lectureId = parseInt(params.id as string);

  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);

  // Per-question: track selected answer (revealed immediately on click)
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
    fetchResults();
  }, [lectureId, router]);

  const fetchResults = async () => {
    try {
      const res = await getResults(lectureId);
      setResults(res.data);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { status?: number } };
      setError(axiosErr.response?.status === 404 ? "not_found" : "Failed to load results");
    } finally {
      setLoading(false);
    }
  };

  const handleProcess = async () => {
    setProcessing(true);
    setError("");
    try {
      await processLecture(lectureId);
      setSelectedAnswers({});
      setScore(0);
      await fetchResults();
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Processing failed");
    } finally {
      setProcessing(false);
    }
  };

  // Reveal answer immediately on click (active recall style)
  const handleSelectAnswer = (globalIndex: number, letter: string) => {
    if (selectedAnswers[globalIndex] !== undefined) return; // already answered
    setSelectedAnswers((prev) => {
      const updated = { ...prev, [globalIndex]: letter };
      // Recalculate score
      if (results) {
        const correct = results.mcqs.filter(
          (mcq, i) => updated[i] === mcq.answer
        ).length;
        setScore(correct);
      }
      return updated;
    });
  };

  const handleReset = () => {
    setSelectedAnswers({});
    setScore(0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error === "not_found") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center bg-white rounded-2xl p-10 shadow-sm border border-gray-200 max-w-md">
          <div className="w-14 h-14 bg-yellow-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Not Processed Yet</h2>
          <p className="text-gray-500 text-sm mb-6">Click below to generate study materials.</p>
          <button onClick={handleProcess} disabled={processing}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg transition-colors">
            {processing ? <span className="flex items-center gap-2"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />Processing...</span> : "Generate Study Materials"}
          </button>
        </div>
      </div>
    );
  }

  if (!results) return null;

  const answeredCount = Object.keys(selectedAnswers).length;
  const totalCount = results.mcqs.length;
  const grouped = groupByTopic(results.mcqs);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="font-semibold text-gray-900">Study Materials</h1>
          </div>
          <div className="flex items-center gap-3">
            {answeredCount > 0 && (
              <span className="text-sm font-medium text-gray-500">
                {score}/{answeredCount} correct
              </span>
            )}
            {answeredCount > 0 && (
              <button onClick={handleReset} className="text-sm text-gray-500 hover:text-gray-700 font-medium">
                Reset
              </button>
            )}
            <button onClick={handleProcess} disabled={processing}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">
              {processing ? "Regenerating..." : "Regenerate"}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Summary */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">📝</span>
            <h2 className="font-semibold text-gray-900">Summary</h2>
          </div>
          <p className="text-gray-600 text-sm leading-relaxed">{results.summary}</p>
        </div>

        {/* Key Concepts */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">💡</span>
            <h2 className="font-semibold text-gray-900">High-Yield Key Concepts</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {results.key_concepts.map((concept, i) => (
              <span key={i} className="bg-amber-50 text-amber-800 text-sm font-medium px-3 py-1.5 rounded-full border border-amber-100">
                {concept}
              </span>
            ))}
          </div>
        </div>

        {/* Score banner when all answered */}
        {answeredCount === totalCount && totalCount > 0 && (
          <div className={`rounded-2xl p-5 flex items-center justify-between ${score / totalCount >= 0.7 ? "bg-green-50 border border-green-200" : "bg-orange-50 border border-orange-200"}`}>
            <div>
              <p className={`font-semibold ${score / totalCount >= 0.7 ? "text-green-800" : "text-orange-800"}`}>
                {score / totalCount >= 0.7 ? "🎉 Great work!" : "📖 Keep studying!"} — {score}/{totalCount} correct ({Math.round((score / totalCount) * 100)}%)
              </p>
              <p className={`text-sm mt-0.5 ${score / totalCount >= 0.7 ? "text-green-600" : "text-orange-600"}`}>
                {score / totalCount >= 0.7 ? "You are well-prepared for this topic." : "Review the explanations for the questions you missed."}
              </p>
            </div>
            <button onClick={handleReset} className="text-sm font-medium bg-white border px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors">
              Retake
            </button>
          </div>
        )}

        {/* MCQs grouped by topic */}
        {Object.entries(grouped).map(([topic, mcqs]) => (
          <div key={topic} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {/* Topic header */}
            <div className="bg-gray-50 border-b border-gray-100 px-6 py-3 flex items-center gap-2">
              <span className="text-xl">{getEmoji(topic)}</span>
              <h3 className="font-semibold text-gray-800">{topic}</h3>
              <span className="ml-auto text-xs text-gray-400">{mcqs.length} questions</span>
            </div>

            <div className="p-4 space-y-5">
              {(mcqs as Array<MCQ & { _index: number }>).map((mcq) => {
                const globalIdx = mcq._index;
                const selected = selectedAnswers[globalIdx];
                const isAnswered = selected !== undefined;
                const isCorrect = selected === mcq.answer;

                return (
                  <div key={globalIdx} className={`border rounded-xl p-4 transition-all ${isAnswered ? (isCorrect ? "border-green-200 bg-green-50/30" : "border-red-200 bg-red-50/30") : "border-gray-100"}`}>
                    {/* Question */}
                    <p className="font-medium text-gray-900 text-sm mb-3">
                      <span className="text-blue-500 font-bold mr-2">Q{globalIdx + 1}.</span>
                      {mcq.question}
                    </p>

                    {/* Options */}
                    <div className="space-y-2">
                      {mcq.options.map((option, j) => {
                        const letter = option.charAt(0);
                        const isThisSelected = selected === letter;
                        const isThisCorrect = letter === mcq.answer;

                        let cls = "border border-gray-200 text-gray-700 cursor-pointer hover:border-blue-300 hover:bg-blue-50";
                        if (!isAnswered) {
                          cls = "border border-gray-200 text-gray-700 cursor-pointer hover:border-blue-300 hover:bg-blue-50";
                        } else if (isThisCorrect) {
                          cls = "border-green-500 bg-green-50 text-green-800 cursor-default";
                        } else if (isThisSelected && !isThisCorrect) {
                          cls = "border-red-400 bg-red-50 text-red-700 cursor-default";
                        } else {
                          cls = "border-gray-100 text-gray-400 cursor-default";
                        }

                        return (
                          <button key={j} onClick={() => handleSelectAnswer(globalIdx, letter)}
                            className={`w-full text-left px-4 py-2.5 rounded-lg text-sm transition-all border ${cls}`}>
                            <span className="flex items-center justify-between">
                              <span>{option}</span>
                              {isAnswered && isThisCorrect && <span className="text-green-600 font-bold">✓</span>}
                              {isAnswered && isThisSelected && !isThisCorrect && <span className="text-red-500 font-bold">✗</span>}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Explanation — shown immediately after answering */}
                    {isAnswered && mcq.explanation && (
                      <div className={`mt-3 px-4 py-2.5 rounded-lg text-sm flex items-start gap-2 ${isCorrect ? "bg-green-100 text-green-800" : "bg-blue-50 text-blue-800"}`}>
                        <span className="text-base flex-shrink-0">👉</span>
                        <span><strong>Answer: {mcq.answer}</strong> — {mcq.explanation.replace(/^[A-D]\s*[—–-]\s*/i, "")}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
