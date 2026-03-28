"use client";
import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

const MOCK_QUESTIONS = [
  {
    question: "How does the transformer architecture handle long-range dependencies in sequence modeling?",
    options: [
      "Through the self-attention mechanism, allowing every token to attend to every other token regardless of distance.",
      "By utilizing recurrent layers that pass hidden states across timesteps sequentially.",
      "Using dilated convolutional filters that increase the receptive field exponentially.",
      "By implementing a sliding window approach with fixed-size local contexts.",
    ],
    answer: 0,
  },
  {
    question: "Which component of the transformer is responsible for injecting positional information into token representations?",
    options: [
      "The feed-forward network applied after attention.",
      "Positional encodings added to the input embeddings.",
      "The layer normalization applied before each sub-layer.",
      "The multi-head projection matrices.",
    ],
    answer: 1,
  },
  {
    question: "In the scaled dot-product attention formula, why is the dot product scaled by 1/√d_k?",
    options: [
      "To reduce computational complexity of the matrix multiplication.",
      "To prevent the softmax function from operating in regions with very small gradients.",
      "To normalize the output to have unit variance.",
      "To ensure the attention weights sum to exactly one.",
    ],
    answer: 1,
  },
  {
    question: "What is the primary advantage of multi-head attention over single-head attention?",
    options: [
      "It reduces the total number of parameters in the model.",
      "It allows the model to attend to information from different representation subspaces simultaneously.",
      "It enables processing of variable-length sequences.",
      "It replaces the need for positional encodings entirely.",
    ],
    answer: 1,
  },
  {
    question: "Which of the following best describes the role of the encoder in a sequence-to-sequence transformer?",
    options: [
      "It generates output tokens auto-regressively one at a time.",
      "It maps an input sequence to a continuous high-dimensional representation.",
      "It applies cross-attention to the decoder's hidden states.",
      "It performs beam search to find optimal output sequences.",
    ],
    answer: 1,
  },
];

export default function QuizPage() {
  const params = useParams();
  const lectureId = params.id;

  const [currentQ, setCurrentQ] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const [answers, setAnswers] = useState<(number | null)[]>(Array(MOCK_QUESTIONS.length).fill(null));
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  };

  const progress = ((currentQ) / MOCK_QUESTIONS.length) * 100;
  const question = MOCK_QUESTIONS[currentQ];
  const optionLetters = ["A", "B", "C", "D"];

  const handleSelect = (idx: number) => {
    setSelectedAnswer(idx);
  };

  const handleNext = () => {
    if (selectedAnswer !== null) {
      const updated = [...answers];
      updated[currentQ] = selectedAnswer;
      setAnswers(updated);
    }
    if (currentQ < MOCK_QUESTIONS.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedAnswer(answers[currentQ + 1]);
    }
  };

  const handleSkip = () => {
    if (currentQ < MOCK_QUESTIONS.length - 1) {
      setCurrentQ((q) => q + 1);
      setSelectedAnswer(answers[currentQ + 1]);
    }
  };

  return (
    <div className="relative min-h-screen text-on-surface overflow-hidden" style={{ backgroundColor: "#0D0F1C" }}>
      <div className="grain-overlay" />

      {/* Progress bar */}
      <div className="fixed top-0 left-0 w-full h-1 bg-surface-container-highest z-[60]">
        <div
          className="h-full synapse-gradient transition-all duration-500"
          style={{ width: `${progress}%`, boxShadow: "0px 0px 10px rgba(0,210,253,0.5)" }}
        />
      </div>

      {/* Top Nav */}
      <nav className="fixed top-0 w-full z-50 px-8 py-6 flex justify-between items-center bg-transparent">
        <span className="text-2xl font-black bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">cortexQ</span>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel">
            <span className="material-symbols-outlined text-tertiary text-lg" style={{ fontVariationSettings: "'FILL' 1" }}>timer</span>
            <span className="text-tertiary font-bold tracking-tight text-sm">{formatTime(elapsed)}</span>
          </div>
          <Link
            href={lectureId ? `/results/${lectureId}` : "/dashboard"}
            className="flex items-center gap-2 text-on-surface-variant hover:text-white transition-colors group"
          >
            <span className="material-symbols-outlined transition-transform group-hover:-translate-x-1">arrow_back</span>
            <span className="font-bold text-sm">Exit Quiz</span>
          </Link>
        </div>
      </nav>

      <main className="min-h-screen flex flex-col items-center justify-center px-4 relative">
        {/* Background glows */}
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-container/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary-container/10 blur-[120px] rounded-full pointer-events-none" />

        {/* Question counter */}
        <div className="mb-8 text-center">
          <span className="text-xs uppercase tracking-[0.2em] font-bold text-secondary-fixed-dim block mb-2">Neural Assessment in Progress</span>
          <h2 className="text-on-surface-variant font-medium">
            Question <span className="text-white font-bold">{currentQ + 1}</span> of {MOCK_QUESTIONS.length}
          </h2>
        </div>

        <div className="w-full max-w-4xl z-10">
          {/* Question */}
          <section className="mb-12 text-center px-4">
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-white leading-tight tracking-tight">
              {question.question}
            </h1>
          </section>

          {/* Options */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {question.options.map((option, idx) => {
              const isSelected = selectedAnswer === idx;
              return (
                <button
                  key={idx}
                  onClick={() => handleSelect(idx)}
                  className={`group relative text-left p-6 rounded-xl transition-all duration-300 ${
                    isSelected
                      ? "synapse-gradient shadow-[0px_8px_24px_rgba(123,47,255,0.2)] scale-[1.02]"
                      : "glass-panel hover:bg-surface-variant hover:-translate-y-1"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                      isSelected ? "bg-white/20" : "bg-surface-container-highest group-hover:bg-outline-variant"
                    }`}>
                      <span className={`font-bold ${isSelected ? "text-white" : "text-on-surface-variant"}`}>
                        {optionLetters[idx]}
                      </span>
                    </div>
                    <p className={`font-medium text-lg transition-colors ${
                      isSelected ? "text-on-primary-container" : "text-on-surface-variant group-hover:text-white"
                    }`}>
                      {option}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Footer actions */}
        <div className="fixed bottom-10 right-10 flex items-center gap-6 z-50">
          <button onClick={handleSkip} className="text-on-surface-variant font-bold hover:text-white transition-colors px-6">
            Skip for now
          </button>
          <button
            onClick={handleNext}
            disabled={currentQ === MOCK_QUESTIONS.length - 1 && selectedAnswer === null}
            className="synapse-gradient px-8 py-4 rounded-xl flex items-center gap-3 shadow-[0px_8px_24px_rgba(0,210,253,0.3)] hover:shadow-[0px_12px_32px_rgba(0,210,253,0.45)] transition-all group active:scale-95 disabled:opacity-50"
          >
            <span className="font-bold text-on-primary">
              {currentQ === MOCK_QUESTIONS.length - 1 ? "Finish Quiz" : "Next Question"}
            </span>
            <span className="material-symbols-outlined text-on-primary group-hover:translate-x-1 transition-transform">arrow_forward</span>
          </button>
        </div>
      </main>

      {/* Background rings */}
      <div className="fixed top-1/2 left-0 -translate-y-1/2 -translate-x-1/2 opacity-20 pointer-events-none">
        <svg fill="none" height="600" viewBox="0 0 600 600" width="600" xmlns="http://www.w3.org/2000/svg">
          <circle cx="300" cy="300" r="299" stroke="#7B2FFF" strokeWidth="0.5" />
          <circle cx="300" cy="300" r="240" stroke="#00D2FD" strokeWidth="0.5" />
          <circle cx="300" cy="300" r="180" stroke="#7B2FFF" strokeWidth="0.5" />
        </svg>
      </div>
    </div>
  );
}
