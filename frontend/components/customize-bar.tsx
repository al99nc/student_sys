
"use client";
import { useState } from "react";
import { Sparkles, Lock, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export interface CustomContext {
  exam_type: string;
  time_to_exam: string;
  prior_knowledge: string;
  difficulty: string;
  mcq_count: number;
  weak_topics: string;
}

interface CustomizeBarProps {
  plan: "free" | "pro" | "enterprise";
  extraUsageEnabled: boolean;
  creditBalance: number;
  value: CustomContext | null;
  onChange: (ctx: CustomContext | null) => void;
}

const EXAM_TYPES = [
  { id: "final",         label: "Final" },
  { id: "midterm",       label: "Midterm" },
  { id: "quiz",          label: "Quiz" },
  { id: "certification", label: "Certification" },
  { id: "entrance",      label: "Entrance" },
  { id: "oral",          label: "Oral / Viva" },
  { id: "revision",      label: "Just Studying" },
];

const TIME_OPTIONS = [
  { id: "today",  label: "Today 🔥" },
  { id: "3days",  label: "3 days" },
  { id: "1week",  label: "1 week" },
  { id: "1month", label: "1 month+" },
];

const KNOWLEDGE_OPTIONS = [
  { id: "first_time",  label: "First time", desc: "Never seen this before" },
  { id: "know_basics", label: "Know basics", desc: "Familiar with fundamentals" },
  { id: "deep_review", label: "Deep review", desc: "Well-prepared, need edge cases" },
];

const DIFFICULTY_OPTIONS = [
  { id: "easy",   label: "Easy",   color: "text-emerald-400" },
  { id: "medium", label: "Medium", color: "text-yellow-400" },
  { id: "hard",   label: "Hard",   color: "text-orange-400" },
  { id: "brutal", label: "Brutal", color: "text-red-400" },
];

const DEFAULT_CONTEXT: CustomContext = {
  exam_type: "final",
  time_to_exam: "1week",
  prior_knowledge: "know_basics",
  difficulty: "medium",
  mcq_count: 20,
  weak_topics: "",
};

export default function CustomizeBar({ plan, extraUsageEnabled, creditBalance, value, onChange }: CustomizeBarProps) {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<CustomContext>(DEFAULT_CONTEXT);

  // Unlocked when: pro/enterprise always; free users only when toggle is ON + has credits
  const isPaid =
    plan === "pro" ||
    plan === "enterprise" ||
    (extraUsageEnabled && creditBalance > 0);

  // Why it's locked (for the right CTA message)
  const lockReason: "toggle_off" | "no_credits" | "upgrade" | null = isPaid
    ? null
    : !extraUsageEnabled
    ? "toggle_off"
    : creditBalance <= 0
    ? "no_credits"
    : "upgrade";

  const enabled = value !== null;

  const toggle = () => {
    if (!isPaid) return;
    if (enabled) {
      onChange(null);
    } else {
      setOpen(true);
      onChange({ ...ctx });
    }
  };

  const update = <K extends keyof CustomContext>(key: K, val: CustomContext[K]) => {
    const next = { ...ctx, [key]: val };
    setCtx(next);
    if (enabled) onChange(next);
  };

  const lockTitle =
    lockReason === "toggle_off" ? "Enable Extra Usage First"
    : lockReason === "no_credits" ? "You Need Credits"
    : "Unlock Smart Context";

  const lockDesc =
    lockReason === "toggle_off"
      ? "Turn on the Extra Usage toggle in your billing settings, then come back to use Smart Context."
      : lockReason === "no_credits"
      ? "You have Extra Usage enabled but no credits left. Buy credits to tailor MCQs to your exact situation."
      : "Upgrade to Pro or buy credits to tailor MCQs to your exact exam situation.";

  const lockCta =
    lockReason === "toggle_off" ? "Go to Billing" : "Buy Credits";

  return (
    <div className={`w-full max-w-3xl mx-auto rounded-2xl border transition-all duration-300 ${
      enabled
        ? "border-primary/60 bg-primary/5 shadow-lg shadow-primary/10"
        : "border-border/40 bg-muted/20"
    }`}>

      {/* ── Header row ────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer select-none"
        onClick={() => isPaid ? setOpen(o => !o) : undefined}
      >
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
            enabled ? "synapse-gradient shadow-md shadow-primary/30" : "bg-muted/50"
          }`}>
            <Sparkles className={`w-4 h-4 ${enabled ? "text-white" : "text-muted-foreground"}`} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className={`font-bold text-sm ${enabled ? "text-foreground" : "text-muted-foreground"}`}>
                Smart Context
              </span>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full synapse-gradient text-white tracking-wide">
                PRO
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {enabled
                ? "Active — MCQs tailored to your situation"
                : "Tailor MCQs to your exact exam situation"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {isPaid ? (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); toggle(); }}
                className={`relative w-11 h-6 rounded-full transition-all duration-200 focus:outline-none ${
                  enabled ? "synapse-gradient" : "bg-muted"
                }`}
              >
                <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                  enabled ? "left-[22px]" : "left-0.5"
                }`} />
              </button>
              {open
                ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground" />
              }
            </>
          ) : (
            <Lock className="w-4 h-4 text-muted-foreground" />
          )}
        </div>
      </div>

      {/* ── Locked state ──────────────────────────────────────── */}
      {!isPaid && (
        <div className="px-5 pb-5">
          <div className="rounded-xl border border-border/30 bg-muted/30 p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-foreground text-sm mb-1">{lockTitle}</p>
              <p className="text-xs text-muted-foreground max-w-xs">{lockDesc}</p>
            </div>
            <Link href="/billing">
              <Button className="synapse-gradient text-white rounded-xl text-sm font-bold whitespace-nowrap">
                {lockCta}
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* ── Expanded fields (unlocked + open) ─────────────────── */}
      {isPaid && open && (
        <div className="px-5 pb-6 space-y-6 border-t border-border/30 pt-5">

          {/* Exam type */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Exam Type
            </label>
            <div className="flex flex-wrap gap-2">
              {EXAM_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => update("exam_type", t.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
                    ctx.exam_type === t.id
                      ? "synapse-gradient text-white border-transparent shadow shadow-primary/20"
                      : "bg-muted/40 text-muted-foreground border-border/40 hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Time to exam */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Time to Exam
            </label>
            <div className="flex flex-wrap gap-2">
              {TIME_OPTIONS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => update("time_to_exam", t.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                    ctx.time_to_exam === t.id
                      ? "synapse-gradient text-white border-transparent shadow shadow-primary/20"
                      : "bg-muted/40 text-muted-foreground border-border/40 hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prior knowledge */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              How Well Do You Know This?
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {KNOWLEDGE_OPTIONS.map((k) => (
                <button
                  key={k.id}
                  onClick={() => update("prior_knowledge", k.id)}
                  className={`px-4 py-3 rounded-xl text-left transition-all border ${
                    ctx.prior_knowledge === k.id
                      ? "glass-panel border-primary/60 shadow shadow-primary/10"
                      : "bg-muted/30 border-border/30 hover:border-border/60"
                  }`}
                >
                  <p className={`text-sm font-semibold ${ctx.prior_knowledge === k.id ? "text-foreground" : "text-muted-foreground"}`}>
                    {k.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{k.desc}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Difficulty */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Difficulty
            </label>
            <div className="flex flex-wrap gap-2">
              {DIFFICULTY_OPTIONS.map((d) => (
                <button
                  key={d.id}
                  onClick={() => update("difficulty", d.id)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                    ctx.difficulty === d.id
                      ? "synapse-gradient text-white border-transparent shadow shadow-primary/20"
                      : `bg-muted/40 border-border/40 hover:border-primary/40 ${d.color}`
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* MCQ count */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
                Number of Questions
              </label>
              <span className="text-sm font-bold text-primary">{ctx.mcq_count} MCQs</span>
            </div>
            <div className="relative">
              <input
                type="range"
                min={10}
                max={40}
                step={5}
                value={ctx.mcq_count}
                onChange={(e) => update("mcq_count", parseInt(e.target.value))}
                className="w-full h-2 rounded-full appearance-none cursor-pointer accent-primary bg-muted"
              />
              <div className="flex justify-between text-xs text-muted-foreground mt-1 px-0.5">
                <span>10</span>
                <span>20</span>
                <span>30</span>
                <span>40</span>
              </div>
            </div>
          </div>

          {/* Weak topics */}
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">
              Weak Topics{" "}
              <span className="normal-case font-normal text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              value={ctx.weak_topics}
              onChange={(e) => update("weak_topics", e.target.value)}
              placeholder={`e.g. "I always confuse the iron studies" or "I struggle with recursion"`}
              rows={2}
              className="w-full px-4 py-3 rounded-xl bg-muted/30 border border-border/40 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60 transition-colors resize-none leading-relaxed"
              maxLength={300}
            />
            {ctx.weak_topics.length > 0 && (
              <p className="text-xs text-muted-foreground text-right">{ctx.weak_topics.length}/300</p>
            )}
          </div>

          {/* Enable / disable CTA */}
          <button
            onClick={toggle}
            className={`w-full py-3 rounded-xl text-sm font-bold transition-all border ${
              enabled
                ? "border-destructive/40 text-destructive hover:bg-destructive/10"
                : "synapse-gradient text-white border-transparent shadow-lg shadow-primary/20 hover:-translate-y-0.5"
            }`}
          >
            {enabled ? "Disable Smart Context" : "Apply Smart Context"}
          </button>
        </div>
      )}
    </div>
  );
}
