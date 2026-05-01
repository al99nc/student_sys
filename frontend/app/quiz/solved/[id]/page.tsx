"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { getSolved } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  const [wakeLockActive, setWakeLockActive] = useState(false);
  const [supportsWakeLock, setSupportsWakeLock] = useState(false);
  const [workMinutes, setWorkMinutes] = useState(25);
  const [breakMinutes, setBreakMinutes] = useState(5);
  const [timeLeft, setTimeLeft] = useState(25 * 60);
  const [mode, setMode] = useState<"work" | "break">("work");
  const [running, setRunning] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const wakeLockRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);

  const requestWakeLock = async () => {
    if (typeof window === "undefined" || !("wakeLock" in navigator)) return;
    try {
      const lock = await (navigator as any).wakeLock.request("screen");
      wakeLockRef.current = lock;
      setWakeLockActive(true);
      lock.addEventListener("release", () => {
        wakeLockRef.current = null;
        setWakeLockActive(false);
      });
    } catch {
      setWakeLockActive(false);
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current?.release) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // ignore release failure
      }
      wakeLockRef.current = null;
      setWakeLockActive(false);
    }
  };

  const startTimer = async () => {
    setRunning(true);
    if (supportsWakeLock) {
      await requestWakeLock();
    }
  };

  const playBeep = () => {
    if (typeof window === "undefined") return;
    if (window.AudioContext || (window as any).webkitAudioContext) {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(520, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
      oscillator.connect(gain);
      gain.connect(audioCtx.destination);
      oscillator.start();
      oscillator.stop(audioCtx.currentTime + 0.28);
      return;
    }
    if (navigator.vibrate) {
      navigator.vibrate([120, 80, 120]);
    }
  };

  const notifyUser = async (title: string, body: string) => {
    if (typeof window === "undefined") return;
    try {
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification(title, { body });
          return;
        }
        if (Notification.permission !== "denied") {
          const permission = await Notification.requestPermission();
          if (permission === "granted") {
            new Notification(title, { body });
            return;
          }
        }
      }
      if (navigator.vibrate) {
        navigator.vibrate([100, 70, 100]);
      }
    } catch {
      if (navigator.vibrate) {
        navigator.vibrate([100, 70, 100]);
      }
    }
  };

  const handleTimerComplete = async () => {
    setRunning(false);
    setSessionComplete(true);
    await releaseWakeLock();
    playBeep();
    notifyUser(
      "Pomodoro complete",
      mode === "work"
        ? "Time for a break or keep studying."
        : "Break finished. Ready for the next work session?"
    );
  };

  const resetTimer = () => {
    setRunning(false);
    setSessionComplete(false);
    setTimeLeft(mode === "work" ? workMinutes * 60 : breakMinutes * 60);
  };

  useEffect(() => {
    const wakeLockSupported = typeof window !== "undefined" && "wakeLock" in navigator;
    setSupportsWakeLock(wakeLockSupported);
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && wakeLockSupported && !wakeLockRef.current) {
        await requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    if (running) {
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            window.clearInterval(timerRef.current!);
            handleTimerComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [running]);

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
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border/70 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-4 sm:px-6">
          <Link href="/lectures" className="text-muted-foreground hover:text-foreground transition-colors flex items-center">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.32em] text-primary">Study Guide</p>
            <p className="truncate text-base font-semibold text-foreground">{data.lecture_title}</p>
          </div>
          <div className="ml-auto inline-flex items-center gap-2 rounded-2xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm text-primary">
            <Brain className="w-4 h-4" />
            <span>{totalItems} Items</span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-20 pt-6 sm:px-6">

        {/* Intro */}
        <Card className="border-border/80 bg-background/90 shadow-sm mb-6">
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <BookOpen className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Study mode</p>
                <p className="text-sm text-muted-foreground">Read each question, think through your answer, then expand to reveal the correct solution.</p>
              </div>
            </div>
            <div className="rounded-2xl border border-primary/20 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary">
              {totalItems} items in this lecture
            </div>
          </CardContent>
        </Card>

        {/* Pomodoro timer */}
        <Card className="border-border/80 bg-background/90 shadow-sm mb-8">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Pomodoro timer</CardTitle>
              <p className="text-sm text-muted-foreground">Keep the screen active while studying and switch cleanly between work and break sessions.</p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-sm font-semibold text-foreground border-border/50 bg-muted/10">
              <span className={`h-2.5 w-2.5 rounded-full ${wakeLockActive ? "bg-emerald-400" : "bg-slate-500"}`} />
              <span>
                {wakeLockActive
                  ? "Screen awake"
                  : supportsWakeLock
                  ? "Tap start to keep awake"
                  : "Wake lock unsupported"
                }
              </span>
            </div>
          </CardHeader>

          <CardContent className="grid gap-4 md:grid-cols-4">
            <div className="rounded-3xl border border-border/70 bg-background/50 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Work</p>
              <input
                type="number"
                min={1}
                value={workMinutes}
                onChange={(event) => {
                  const value = Math.max(1, Number(event.target.value) || 1);
                  setWorkMinutes(value);
                  if (!running && mode === "work" && !sessionComplete) {
                    setTimeLeft(value * 60);
                  }
                }}
                className="mt-3 w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="rounded-3xl border border-border/70 bg-background/50 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Break</p>
              <input
                type="number"
                min={1}
                value={breakMinutes}
                onChange={(event) => {
                  const value = Math.max(1, Number(event.target.value) || 1);
                  setBreakMinutes(value);
                  if (!running && mode === "break" && !sessionComplete) {
                    setTimeLeft(value * 60);
                  }
                }}
                className="mt-3 w-full rounded-2xl border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div className="rounded-3xl border border-border/70 bg-background/50 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Mode</p>
              <div className="mt-3 text-lg font-semibold text-foreground">{mode === "work" ? "Study" : "Break"}</div>
            </div>
            <div className="rounded-3xl border border-border/70 bg-background/50 p-4">
              <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Time left</p>
              <div className="mt-3 text-3xl font-semibold text-foreground">{`${String(Math.floor(timeLeft / 60)).padStart(2, "0")}:${String(timeLeft % 60).padStart(2, "0")}`}</div>
            </div>
          </CardContent>

          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-3">
              <Button onClick={async () => {
                if (sessionComplete) {
                  setSessionComplete(false);
                  setTimeLeft(mode === "work" ? workMinutes * 60 : breakMinutes * 60);
                }
                if (running) {
                  setRunning(false);
                } else {
                  await startTimer();
                }
              }}>
                {running ? "Pause" : "Start"}
              </Button>
              <Button variant="outline" onClick={() => resetTimer()}>
                Reset
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{running ? "Timer is running" : "Ready to start your session"}</p>
          </CardContent>

          {sessionComplete && (
            <CardContent className="rounded-3xl border border-primary/20 bg-primary/10 p-4">
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-foreground">
                  {mode === "work" ? "Work session complete" : "Break complete"}
                </p>
                <div className="flex flex-wrap gap-3">
                  {mode === "work" ? (
                    <>
                      <Button onClick={() => {
                        setMode("break");
                        setTimeLeft(breakMinutes * 60);
                        setSessionComplete(false);
                        setRunning(true);
                      }}>
                        Take break
                      </Button>
                      <Button variant="outline" onClick={() => {
                        setMode("work");
                        setTimeLeft(workMinutes * 60);
                        setSessionComplete(false);
                        setRunning(true);
                      }}>
                        Keep studying
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => {
                      setMode("work");
                      setTimeLeft(workMinutes * 60);
                      setSessionComplete(false);
                      setRunning(true);
                    }}>
                      Continue Pomodoro
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          )}
        </Card>

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
      </main>
    </div>
  );
}
