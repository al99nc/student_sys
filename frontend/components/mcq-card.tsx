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
  BookmarkPlus,
  Copy,
  CheckCircle2,
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
}

export default function MCQCard({ mcq, lectureTitle, lectureId }: MCQCardProps) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleChatWithCoach = () => {
    // Navigate to coach page with MCQ context prepopulated
    const mcqContext = `
Question: ${mcq.question}

Options:
${mcq.options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join("\n")}

${mcq.answer ? `Correct Answer: ${mcq.answer}` : ""}
${mcq.explanation ? `Explanation: ${mcq.explanation}` : ""}
${mcq.topic ? `Topic: ${mcq.topic}` : ""}
${lectureTitle ? `From Lecture: ${lectureTitle}` : ""}
    `.trim();

    // Store in sessionStorage to pass to coach page
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

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="pt-3 sm:pt-4">
        {/* Header with Question */}
        <div className="space-y-3">
          {/* Badge and Topic */}
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="font-medium leading-relaxed text-sm sm:text-base break-words">{mcq.question}</p>
            </div>
            <div className="flex flex-wrap gap-2 justify-start sm:justify-end flex-shrink-0">
              {mcq.topic && (
                <Badge variant="secondary" className="text-xs whitespace-nowrap">
                  {mcq.topic}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs whitespace-nowrap truncate max-w-xs">
                {lectureTitle}
              </Badge>
            </div>
          </div>

          {/* Options - Always visible */}
          <div className="bg-muted/50 rounded-lg p-3 sm:p-4 space-y-2">
            {mcq.options.map((option, idx) => {
              const optionLabel = String.fromCharCode(65 + idx);
              const isCorrect = mcq.answer === optionLabel;

              return (
                <div
                  key={idx}
                  className={`flex items-start gap-2 p-2 rounded transition-colors text-sm sm:text-base ${
                    isCorrect
                      ? "bg-green-500/10 text-green-700 dark:text-green-400"
                      : ""
                  }`}
                >
                  <span
                    className={`font-semibold min-w-fit ${
                      isCorrect ? "text-green-600 dark:text-green-400" : ""
                    }`}
                  >
                    {optionLabel}.
                  </span>
                  <span className="flex-1 break-words">{option}</span>
                  {isCorrect && (
                    <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Expandable Details */}
          {(mcq.explanation || mcq.answer) && (
            <div>
              <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-2 text-xs sm:text-sm text-primary hover:text-primary/80 transition-colors"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Hide Details
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    Show Answer & Explanation
                  </>
                )}
              </button>

              {expanded && (
                <div className="mt-3 space-y-3 bg-blue-500/10 border border-blue-500/20 rounded-lg p-3 sm:p-4">
                  {mcq.answer && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">
                        CORRECT ANSWER
                      </p>
                      <p className="font-medium text-green-600 dark:text-green-400 text-sm">
                        {mcq.answer}
                      </p>
                    </div>
                  )}
                  {mcq.explanation && (
                    <div>
                      <p className="text-xs font-semibold text-muted-foreground mb-1">
                        EXPLANATION
                      </p>
                      <p className="text-xs sm:text-sm leading-relaxed">{mcq.explanation}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2 sm:pt-3 border-t">
            <Button
              onClick={handleChatWithCoach}
              size="sm"
              className="flex-1 gap-2 text-xs sm:text-sm h-9 sm:h-10"
              variant="default"
            >
              <MessageSquare className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Chat with Coach</span>
              <span className="sm:hidden">Chat</span>
            </Button>
            <Button
              onClick={handleCopyMCQ}
              size="sm"
              variant="outline"
              title="Copy MCQ"
              className="h-9 sm:h-10 px-2 sm:px-3"
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
