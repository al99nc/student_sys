"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Copy,
  CheckCircle2,
  Eye,
  ThumbsUp,
  RotateCcw,
  X,
} from "lucide-react";

interface MCQCardProps {
  mcq: {
    question: string;
    options: string[];
    answer: string;
    explanation?: string;
    topic?: string;
  };
  lectureTitle: string;
  lectureId: number;
  studyMode?: boolean;
  fontSize?: "sm" | "md" | "lg";
  onReviewed?: (knew: boolean) => void;
}

export default function MCQCard({
  mcq,
  lectureTitle,
  lectureId,
  studyMode = false,
  fontSize = "md",
  onReviewed,
}: MCQCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [answerRevealed, setAnswerRevealed] = useState(!studyMode);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [reviewState, setReviewState] = useState<"none" | "knew" | "missed">("none");

  const textSizes = {
    sm: { question: "text-sm", option: "text-sm", meta: "text-xs" },
    md: { question: "text-base md:text-lg", option: "text-sm md:text-base", meta: "text-xs md:text-sm" },
    lg: { question: "text-lg md:text-xl", option: "text-base md:text-lg", meta: "text-sm" },
  };
  const ts = textSizes[fontSize];

  const handleSelectOption = (label: string) => {
    if (!answerRevealed && studyMode) setSelectedOption(label);
  };

  const handleReveal = () => setAnswerRevealed(true);

  const handleReviewed = (knew: boolean) => {
    setReviewState(knew ? "knew" : "missed");
    onReviewed?.(knew);
  };

  const handleReset = () => {
    setAnswerRevealed(!studyMode);
    setSelectedOption(null);
    setReviewState("none");
    setExpanded(false);
  };

  const handleChatWithCoach = () => {
    const mcqContext = `
Question: ${mcq.question}

Options:
${mcq.options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join("\n")}

${mcq.answer ? `Correct Answer: ${mcq.answer}` : ""}
${mcq.explanation ? `Explanation: ${mcq.explanation}` : ""}
${mcq.topic ? `Topic: ${mcq.topic}` : ""}
${lectureTitle ? `From Lecture: ${lectureTitle}` : ""}
    `.trim();

    if (typeof window !== "undefined") {
      sessionStorage.setItem("mcqContext", mcqContext);
      sessionStorage.setItem("fromMcq", "true");
    }
    router.push("/coach?source=mcq");
  };

  const handleCopyMCQ = () => {
    const mcqText = `
Q: ${mcq.question}

${mcq.options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join("\n")}

Answer: ${mcq.answer}
${mcq.explanation ? `\nExplanation: ${mcq.explanation}` : ""}
    `.trim();

    navigator.clipboard.writeText(mcqText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getOptionStyle = (optionLabel: string) => {
    const isCorrect = mcq.answer === optionLabel;
    const isSelected = selectedOption === optionLabel;

    if (answerRevealed) {
      if (isCorrect)
        return "bg-green-500/15 text-green-700 dark:text-green-300 border border-green-500/40";
      if (isSelected && !isCorrect)
        return "bg-red-500/10 text-red-700 dark:text-red-400 border border-red-500/30 line-through opacity-70";
      return "opacity-50 border border-transparent";
    }
    if (isSelected)
      return "bg-primary/10 border border-primary/40";
    return "hover:bg-muted/80 active:bg-muted/60 border border-transparent";
  };

  const cardBorder =
    reviewState === "knew"
      ? "border-green-500/40 bg-green-500/5"
      : reviewState === "missed"
      ? "border-orange-400/40 bg-orange-500/5"
      : "";

  return (
    <Card className={`transition-all duration-200 ${cardBorder}`}>
      <CardContent className="pt-4 pb-4 px-4 md:px-6">
        <div className="space-y-4">

          {/* Question + badges */}
          <div className="flex items-start justify-between gap-3">
            <p className={`font-medium leading-relaxed break-words flex-1 ${ts.question}`}>
              {mcq.question}
            </p>
            <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
              {mcq.topic && (
                <Badge variant="secondary" className={`${ts.meta} whitespace-nowrap`}>
                  {mcq.topic}
                </Badge>
              )}
              <Badge variant="outline" className={`${ts.meta} whitespace-nowrap max-w-[9rem] truncate`}>
                {lectureTitle}
              </Badge>
              {reviewState === "knew" && (
                <Badge className="bg-green-500/20 text-green-600 dark:text-green-400 border-green-500/30 text-xs">
                  ✓ Got it
                </Badge>
              )}
              {reviewState === "missed" && (
                <Badge className="bg-orange-500/20 text-orange-500 border-orange-400/30 text-xs">
                  ↩ Review
                </Badge>
              )}
            </div>
          </div>

          {/* Options */}
          <div className="space-y-2">
            {mcq.options.map((option, idx) => {
              const optionLabel = String.fromCharCode(65 + idx);
              const isCorrect = mcq.answer === optionLabel;

              return (
                <button
                  key={idx}
                  onClick={() => handleSelectOption(optionLabel)}
                  disabled={answerRevealed || !studyMode}
                  className={`w-full flex items-start gap-3 p-3 md:p-3.5 rounded-xl text-left transition-all touch-manipulation ${getOptionStyle(optionLabel)} ${
                    !answerRevealed && studyMode ? "cursor-pointer" : "cursor-default"
                  }`}
                >
                  <span
                    className={`font-semibold min-w-[1.5rem] ${ts.option} ${
                      answerRevealed && isCorrect ? "text-green-600 dark:text-green-400" : ""
                    }`}
                  >
                    {optionLabel}.
                  </span>
                  <span className={`flex-1 break-words ${ts.option}`}>{option}</span>
                  {answerRevealed && isCorrect && (
                    <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5 flex-shrink-0" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Reveal button (study mode only, before reveal) */}
          {studyMode && !answerRevealed && (
            <Button
              onClick={handleReveal}
              className="w-full h-12 gap-2 text-sm md:text-base"
              variant="outline"
            >
              <Eye className="w-4 h-4" />
              Reveal Answer
            </Button>
          )}

          {/* Explanation (after reveal) */}
          {answerRevealed && mcq.explanation && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className={`flex items-center gap-2 ${ts.meta} text-primary hover:text-primary/80 transition-colors py-1`}
              >
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {expanded ? "Hide Explanation" : "Show Explanation"}
              </button>
              {expanded && (
                <div className="mt-2 bg-blue-500/10 border border-blue-500/20 rounded-xl p-3 md:p-4">
                  <p className={`leading-relaxed ${ts.option}`}>{mcq.explanation}</p>
                </div>
              )}
            </div>
          )}

          {/* Self-assessment (study mode, after reveal, not yet assessed) */}
          {studyMode && answerRevealed && reviewState === "none" && (
            <div className="flex gap-2">
              <Button
                onClick={() => handleReviewed(true)}
                size="sm"
                variant="outline"
                className="flex-1 h-12 gap-2 text-sm border-green-500/40 hover:bg-green-500/10 hover:text-green-600 hover:border-green-500/60"
              >
                <ThumbsUp className="w-4 h-4" />
                Got it
              </Button>
              <Button
                onClick={() => handleReviewed(false)}
                size="sm"
                variant="outline"
                className="flex-1 h-12 gap-2 text-sm border-orange-400/40 hover:bg-orange-500/10 hover:text-orange-500 hover:border-orange-400/60"
              >
                <RotateCcw className="w-4 h-4" />
                Need Review
              </Button>
            </div>
          )}

          {/* Action row */}
          <div className="flex gap-2 pt-2 border-t border-border/60">
            {studyMode && reviewState !== "none" && (
              <Button
                onClick={handleReset}
                size="sm"
                variant="ghost"
                className="h-12 px-3 text-muted-foreground hover:text-foreground"
                title="Reset card"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            )}
            <Button
              onClick={handleChatWithCoach}
              size="sm"
              className="flex-1 gap-2 text-sm h-12"
              variant="default"
            >
              <MessageSquare className="w-4 h-4" />
              <span>Ask Coach</span>
            </Button>
            <Button
              onClick={handleCopyMCQ}
              size="sm"
              variant="outline"
              title="Copy MCQ"
              className="h-12 px-3"
            >
              {copied ? (
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
