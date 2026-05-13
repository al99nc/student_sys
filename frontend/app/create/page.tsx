"use client";
import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { processLecture, CustomContext, LectureOut } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { AppHeader } from "@/components/app-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LectureSelector } from "@/components/lecture-selector";
import { Loader2, Brain, Target, FileText, ArrowRight } from "lucide-react";

type GenMode = "mcq" | "essay";
type ExamType = "revision" | "exam" | "harder" | "custom";

const EXAM_TYPE_OPTIONS: { value: ExamType; label: string; desc: string }[] = [
  { value: "revision", label: "Revision", desc: "Casual review — balanced mix across all topics" },
  { value: "exam", label: "Exam", desc: "Exam simulation — clinical vignettes, mechanism traps" },
  { value: "harder", label: "Harder", desc: "Challenging — multi-step vignettes, max difficulty" },
  { value: "custom", label: "Custom", desc: "I'll configure everything below" },
];

const CUSTOM_EXAM_TYPES = [
  { value: "final", label: "Final Exam" },
  { value: "midterm", label: "Midterm" },
  { value: "quiz", label: "Quiz" },
  { value: "certification", label: "Certification" },
  { value: "entrance", label: "Entrance Exam" },
  { value: "oral", label: "Oral Exam" },
  { value: "revision", label: "Revision" },
];

const TIME_TO_EXAM_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "3days", label: "In 3 days" },
  { value: "1week", label: "In 1 week" },
  { value: "1month", label: "In 1 month" },
];

const PRIOR_KNOWLEDGE_OPTIONS = [
  { value: "first_time", label: "First time studying this" },
  { value: "know_basics", label: "Know the basics" },
  { value: "deep_review", label: "Deep review" },
];

const DIFFICULTY_OPTIONS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "brutal", label: "Brutal" },
];

function CreateContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const lectureIdParam = searchParams.get("lecture_id");

  const [selectedLecture, setSelectedLecture] = useState<LectureOut | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");

  const [genMode, setGenMode] = useState<GenMode>("mcq");
  const [examType, setExamType] = useState<ExamType>("revision");

  const [customExamType, setCustomExamType] = useState("final");
  const [timeToExam, setTimeToExam] = useState("today");
  const [priorKnowledge, setPriorKnowledge] = useState("first_time");
  const [difficulty, setDifficulty] = useState("medium");
  const [mcqCount, setMcqCount] = useState(20);
  const [weakTopics, setWeakTopics] = useState("");

  const [focusInstruction, setFocusInstruction] = useState("");

  useEffect(() => {
    if (!isAuthenticated()) { router.push("/auth"); return; }
  }, [router]);

  const handleLectureSelected = (lecture: LectureOut) => {
    setSelectedLecture(lecture);
    setError("");
  };

  const handleGenerate = async () => {
    if (!selectedLecture) return;
    setError("");
    setGenerating(true);

    try {
      if (genMode === "essay") {
        const res = await processLecture(selectedLecture.id, "essay");
        router.push(`/upload/${res.data.job_id}`);
        return;
      }

      if (examType === "custom") {
        const customContext: CustomContext = {
          exam_type: customExamType,
          time_to_exam: timeToExam,
          prior_knowledge: priorKnowledge,
          difficulty,
          mcq_count: mcqCount,
          weak_topics: weakTopics.trim(),
        };
        const res = await processLecture(selectedLecture.id, "revision", customContext, focusInstruction.trim() || undefined);
        router.push(`/upload/${res.data.job_id}`);
      } else {
        const res = await processLecture(selectedLecture.id, examType, undefined, focusInstruction.trim() || undefined);
        router.push(`/upload/${res.data.job_id}`);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: unknown } } };
      const d = axiosErr.response?.data?.detail;
      setError(typeof d === "string" ? d : (d && typeof d === "object" && "message" in d ? `${(d as {message: string}).message}`.trim() : "Generation failed. Please try again."));
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = genMode === "mcq"
    ? examType !== "custom" || (!!customExamType && !!difficulty && mcqCount >= 10)
    : true;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <AppHeader activePage="Upload" />
      <main className="flex-grow px-4 sm:px-6 max-w-3xl mx-auto w-full pt-8 pb-32">
        <div className="space-y-8">

          {!selectedLecture ? (
            <>
              <div className="text-center space-y-3">
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  Create Practice Questions
                </h1>
                <p className="text-muted-foreground max-w-xl mx-auto text-sm">
                  Select a file to generate MCQs or essay questions from, or upload new content.
                </p>
              </div>
              <Card>
                <CardContent className="p-6">
                  <LectureSelector
                    preselectedId={lectureIdParam ? parseInt(lectureIdParam) : undefined}
                    onLectureSelected={handleLectureSelected}
                  />
                </CardContent>
              </Card>
            </>
          ) : (
            <>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground mb-2">
                  Configure Generation
                </h1>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <FileText className="w-4 h-4" />
                  <span className="text-sm font-medium">{selectedLecture.title}</span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedLecture(null)}
                  className="mt-1 text-xs text-muted-foreground"
                >
                  Change file
                </Button>
              </div>

              <Card>
                <CardContent className="p-6 space-y-6">

                  <div>
                    <label className="text-sm font-bold text-foreground mb-3 block">
                      What do you want to generate?
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { value: "mcq" as GenMode, icon: Target, label: "MCQs", desc: "Multiple choice questions" },
                        { value: "essay" as GenMode, icon: Brain, label: "Essay Questions", desc: "Open-ended with AI grading" },
                      ].map(({ value, icon: Icon, label, desc }) => (
                        <button
                          key={value}
                          onClick={() => { setGenMode(value); setError(""); }}
                          className={`p-4 rounded-xl border-2 text-left transition-all ${
                            genMode === value
                              ? "border-primary bg-primary/5"
                              : "border-border bg-card hover:border-primary/40"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${genMode === value ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <span className={`font-bold text-sm ${genMode === value ? "text-foreground" : "text-muted-foreground"}`}>
                              {label}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  {genMode === "mcq" && (
                    <div>
                      <label className="text-sm font-bold text-foreground mb-3 block">
                        Exam type
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {EXAM_TYPE_OPTIONS.map(({ value, label, desc }) => (
                          <button
                            key={value}
                            onClick={() => { setExamType(value); setError(""); }}
                            className={`p-4 rounded-xl border-2 text-left transition-all ${
                              examType === value
                                ? "border-primary bg-primary/5"
                                : "border-border bg-card hover:border-primary/40"
                            }`}
                          >
                            <span className={`font-bold text-sm ${examType === value ? "text-foreground" : "text-muted-foreground"}`}>
                              {label}
                            </span>
                            <p className="text-xs text-muted-foreground mt-1">{desc}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {genMode === "mcq" && examType === "custom" && (
                    <div className="space-y-5 border-t border-border pt-5">
                      <p className="text-sm font-bold text-foreground">Custom Configuration</p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                            Exam type
                          </label>
                          <select
                            value={customExamType}
                            onChange={(e) => setCustomExamType(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
                          >
                            {CUSTOM_EXAM_TYPES.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                            Time to exam
                          </label>
                          <select
                            value={timeToExam}
                            onChange={(e) => setTimeToExam(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
                          >
                            {TIME_TO_EXAM_OPTIONS.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                            Prior knowledge
                          </label>
                          <select
                            value={priorKnowledge}
                            onChange={(e) => setPriorKnowledge(e.target.value)}
                            className="w-full px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground outline-none focus:border-primary/60 transition-colors"
                          >
                            {PRIOR_KNOWLEDGE_OPTIONS.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                            Difficulty
                          </label>
                          <div className="flex gap-2">
                            {DIFFICULTY_OPTIONS.map(({ value, label }) => (
                              <button
                                key={value}
                                onClick={() => setDifficulty(value)}
                                className={`flex-1 px-2 py-2 rounded-lg text-xs font-bold transition-all ${
                                  difficulty === value
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted/50 text-muted-foreground border border-border hover:border-primary/40"
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                          Number of MCQs: {mcqCount}
                        </label>
                        <input
                          type="range"
                          min={10}
                          max={40}
                          step={5}
                          value={mcqCount}
                          onChange={(e) => setMcqCount(parseInt(e.target.value))}
                          className="w-full accent-primary"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>10</span>
                          <span>40</span>
                        </div>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-muted-foreground mb-1.5 block">
                          Weak topics{" "}
                          <span className="font-normal text-muted-foreground/60">(optional)</span>
                        </label>
                        <textarea
                          value={weakTopics}
                          onChange={(e) => setWeakTopics(e.target.value)}
                          placeholder="List topics you struggle with, one per line"
                          maxLength={300}
                          className="w-full min-h-[80px] resize-none px-3 py-2.5 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60 transition-colors"
                        />
                      </div>
                    </div>
                  )}

                  <div className="border-t border-border pt-5">
                    <label className="text-sm font-bold text-foreground mb-3 block">
                      Focus on specific topics?{" "}
                      <span className="font-normal text-muted-foreground/60">(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={focusInstruction}
                      onChange={(e) => setFocusInstruction(e.target.value)}
                      placeholder="e.g. focus on chapter 3 and cardiovascular system"
                      maxLength={300}
                      className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/60 transition-colors"
                    />
                  </div>

                </CardContent>
              </Card>

              {error && (
                <div className="bg-destructive/10 border border-destructive/20 text-destructive rounded-xl px-4 py-3 text-sm">
                  {error}
                </div>
              )}

              <Button
                onClick={handleGenerate}
                disabled={generating || !canGenerate}
                className="w-full synapse-gradient text-white font-bold py-6 rounded-xl shadow-lg hover:-translate-y-1 transition-all disabled:opacity-50 disabled:hover:translate-y-0 text-base"
              >
                {generating ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />Generating…
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Target className="w-5 h-5" />
                    Generate
                    <ArrowRight className="w-5 h-5" />
                  </span>
                )}
              </Button>
            </>
          )}

        </div>
      </main>
    </div>
  );
}

export default function CreatePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary" />
      </div>
    }>
      <CreateContent />
    </Suspense>
  );
}
