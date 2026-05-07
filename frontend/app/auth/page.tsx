"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signup, login, saveOnboarding } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { useTelegram } from "@/lib/useTelegram";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, ArrowRight, ArrowLeft, Loader2, Check } from "lucide-react";

const REMEMBERED_EMAIL_KEY = "studyai_remembered_email";
const REMEMBER_ME_KEY = "studyai_remember_me";

function getPasswordStrength(password: string): { score: number; label: string; bg: string; color: string } {
  if (!password) return { score: 0, label: "", bg: "", color: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { score, label: "Weak",       bg: "#ef4444", color: "#ef4444" };
  if (score <= 2) return { score, label: "Fair",       bg: "#f97316", color: "#f97316" };
  if (score <= 3) return { score, label: "Good",       bg: "#eab308", color: "#eab308" };
  if (score <= 4) return { score, label: "Strong",     bg: "#22c55e", color: "#22c55e" };
  return            { score, label: "Very strong", bg: "#16a34a", color: "#16a34a" };
}

const COLLEGES = [
  { id: "medicine",    label: "Medicine",         icon: "stethoscope" },
  { id: "pharmacy",    label: "Pharmacy",          icon: "medication" },
  { id: "dentistry",   label: "Dentistry",         icon: "dentistry" },
  { id: "nursing",     label: "Nursing",           icon: "medical_services" },
  { id: "engineering", label: "Engineering",       icon: "engineering" },
  { id: "computer",    label: "Computer Science",  icon: "code" },
  { id: "business",    label: "Business",          icon: "business_center" },
  { id: "law",         label: "Law",               icon: "gavel" },
  { id: "science",     label: "Science",           icon: "science" },
  { id: "arts",        label: "Arts & Humanities", icon: "palette" },
  { id: "education",   label: "Education",         icon: "school" },
  { id: "other",       label: "Other",             icon: "more_horiz" },
];

const STEP_ICONS = ["person", "school", "domain", "military_tech"];

export default function AuthPage() {
  const router = useRouter();
  const { isInTelegram } = useTelegram();
  const [mode, setMode]                         = useState<"login" | "signup">("login");
  const [email, setEmail]                       = useState("");
  const [password, setPassword]                 = useState("");
  const [confirmPassword, setConfirmPassword]   = useState("");
  const [showPassword, setShowPassword]         = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe]             = useState(false);
  const [error, setError]                       = useState("");
  const [success, setSuccess]                   = useState("");
  const [loading, setLoading]                   = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [animKey, setAnimKey]           = useState(0);
  const [userName, setUserName]         = useState("");
  const [university, setUniversity]     = useState("");
  const [college, setCollege]           = useState("");
  const [yearOfStudy, setYearOfStudy]   = useState<number | null>(null);

  useEffect(() => {
    if (isInTelegram) {
      const token = localStorage.getItem("token");
      if (token) router.replace("/dashboard");
    }
  }, [isInTelegram, router]);

  useEffect(() => {
    const saved = localStorage.getItem(REMEMBER_ME_KEY) === "true";
    setRememberMe(saved);
    if (saved) setEmail(localStorage.getItem(REMEMBERED_EMAIL_KEY) || "");
  }, []);

  useEffect(() => {
    if (!showOnboarding) emailRef.current?.focus();
  }, [mode, showOnboarding]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "signup") {
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setLoading(false);
          return;
        }
        await signup(email, password);
        const isBro = email.split("@")[0].toLowerCase().endsWith("-fromali");
        setSuccess(isBro ? "yo bro 👊 welcome — 100 free credits dropped for you!" : "Account created! Signing you in…");
        const res = await login(email, password);
        saveToken(res.data.access_token);
        persistRememberMe();
        setShowOnboarding(true);
      } else {
        const res = await login(email, password);
        saveToken(res.data.access_token);
        persistRememberMe();
        const redirectTo = new URLSearchParams(window.location.search).get("redirect");
        router.push(redirectTo || "/welcome");
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Something went wrong. Please try again.");
    } finally { setLoading(false); }
  };

  const persistRememberMe = () => {
    if (rememberMe) {
      localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
      localStorage.setItem(REMEMBER_ME_KEY, "true");
    } else {
      localStorage.removeItem(REMEMBERED_EMAIL_KEY);
      localStorage.setItem(REMEMBER_ME_KEY, "false");
    }
  };

  const switchMode = (m: "login" | "signup") => {
    setMode(m); setError(""); setSuccess(""); setPassword(""); setConfirmPassword(""); setShowPassword(false); setShowConfirmPassword(false);
  };

  const advance = async () => {
    if (onboardingStep === 0) { setOnboardingStep(1); setAnimKey(k => k + 1); }
    else if (onboardingStep === 1 && userName.trim())    { setOnboardingStep(2); setAnimKey(k => k + 1); }
    else if (onboardingStep === 2 && university.trim())  { setOnboardingStep(3); setAnimKey(k => k + 1); }
    else if (onboardingStep === 3 && college)            { setOnboardingStep(4); setAnimKey(k => k + 1); }
    else if (onboardingStep === 4 && yearOfStudy !== null) {
      setLoading(true);
      try { await saveOnboarding(userName.trim(), university.trim(), college, yearOfStudy); } catch {}
      finally { setLoading(false); }
      localStorage.setItem("themcq_profile", JSON.stringify({ name: userName, university, college, yearOfStudy }));
      router.push(`/welcome?name=${encodeURIComponent(userName.trim())}`);
    }
  };

  const goBack = () => {
    if (onboardingStep > 0) { setOnboardingStep(s => s - 1); setAnimKey(k => k + 1); }
  };

  const strength = mode === "signup" ? getPasswordStrength(password) : null;

  const inputClass =
    "w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground transition-colors";

  // ── Onboarding ───────────────────────────────────────────────────────────────

  if (showOnboarding) {
    const stepSubtitles = [
      "",
      "We'll personalize your experience",
      "Your university or college",
      "Your college or faculty of study",
      "Your current year of study",
    ];
    const stepTitles = [
      "",
      "What should we call you?",
      userName ? `Hey ${userName}! Where do you study?` : "Where do you study?",
      "Which faculty are you in?",
      "What year are you in?",
    ];

    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">

          {/* Logo */}
          <div className="text-2xl font-black tracking-tight mb-8">
            cortex<span className="text-primary">Q</span>
          </div>

          {/* Progress */}
          {onboardingStep > 0 && (
            <div className="flex items-center gap-3.5 mb-6">
              <button
                onClick={goBack}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex gap-1.5">
                {[1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-300",
                      i <= onboardingStep ? "bg-primary" : "bg-border",
                      i === onboardingStep ? "w-6" : "w-1.5"
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          <div key={animKey} className="w-full max-w-[420px]">

            {/* Step 0 — Welcome */}
            {onboardingStep === 0 && (
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-[72px] h-[72px] rounded-2xl mb-6 bg-primary/10 border border-primary/20">
                  <span
                    className="material-symbols-outlined text-primary"
                    style={{ fontSize: 36, fontVariationSettings: "'FILL' 1" }}
                  >
                    neurology
                  </span>
                </div>
                <h1 className="text-2xl font-black tracking-tight mb-2.5">Nice to meet you!</h1>
                <p className="text-sm text-muted-foreground leading-relaxed mx-auto max-w-xs mb-7">
                  themcq turns your lecture PDFs into smart MCQ quizzes — study smarter, retain more, enjoy exam prep.
                </p>
                <div className="grid grid-cols-3 gap-2 mb-7">
                  {[
                    { icon: "upload_file", title: "Upload",   desc: "Drop your lectures" },
                    { icon: "quiz",        title: "Generate", desc: "AI builds MCQs" },
                    { icon: "trending_up", title: "Improve",  desc: "Track your growth" },
                  ].map(f => (
                    <div key={f.icon} className="rounded-xl p-3.5 text-center bg-card border border-border">
                      <span
                        className="material-symbols-outlined text-primary block mb-1.5"
                        style={{ fontSize: 26, fontVariationSettings: "'FILL' 1" }}
                      >
                        {f.icon}
                      </span>
                      <div className="text-xs font-bold mb-0.5">{f.title}</div>
                      <div className="text-[11px] text-muted-foreground leading-snug">{f.desc}</div>
                    </div>
                  ))}
                </div>
                <Button onClick={advance} size="lg" className="w-full">
                  <span>Let&apos;s get started</span>
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            {/* Steps 1–4 */}
            {onboardingStep > 0 && (
              <Card>
                <CardHeader className="pb-0">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider mb-1 bg-primary/10 text-primary border border-primary/20 w-fit">
                    <span
                      className="material-symbols-outlined"
                      style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}
                    >
                      {STEP_ICONS[onboardingStep - 1]}
                    </span>
                    Step {onboardingStep} of 4
                  </div>
                  <CardTitle className="text-xl font-extrabold tracking-tight">
                    {stepTitles[onboardingStep]}
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{stepSubtitles[onboardingStep]}</p>
                </CardHeader>
                <CardContent className="flex flex-col gap-3.5">

                  {/* Step 1 — Name */}
                  {onboardingStep === 1 && (
                    <>
                      <input
                        autoFocus
                        type="text"
                        value={userName}
                        onChange={e => setUserName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && userName.trim() && advance()}
                        placeholder="Your first name"
                        className={inputClass}
                      />
                      <Button onClick={advance} disabled={!userName.trim()} size="lg" className="w-full">
                        <span>Continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </>
                  )}

                  {/* Step 2 — University */}
                  {onboardingStep === 2 && (
                    <>
                      <input
                        autoFocus
                        type="text"
                        value={university}
                        onChange={e => setUniversity(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && university.trim() && advance()}
                        placeholder="University or College name"
                        className={inputClass}
                      />
                      <Button onClick={advance} disabled={!university.trim()} size="lg" className="w-full">
                        <span>Continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </>
                  )}

                  {/* Step 3 — College */}
                  {onboardingStep === 3 && (
                    <>
                      <div className="grid grid-cols-2 gap-1.5">
                        {COLLEGES.map(col => {
                          const sel = college === col.id;
                          return (
                            <button
                              key={col.id}
                              onClick={() => setCollege(col.id)}
                              className={cn(
                                "flex items-center gap-2 p-2.5 rounded-lg text-left cursor-pointer transition-all border font-[inherit]",
                                sel
                                  ? "bg-primary/10 border-primary/40 text-foreground"
                                  : "bg-muted border-border text-muted-foreground hover:border-primary/40"
                              )}
                            >
                              <span
                                className="material-symbols-outlined flex-shrink-0"
                                style={{
                                  fontSize: 16,
                                  color: sel ? "var(--color-primary)" : undefined,
                                  fontVariationSettings: "'FILL' 1",
                                }}
                              >
                                {col.icon}
                              </span>
                              <span className="text-xs font-semibold leading-snug flex-1">{col.label}</span>
                              {sel && <Check className="w-3.5 h-3.5 flex-shrink-0 text-primary" />}
                            </button>
                          );
                        })}
                      </div>
                      <Button onClick={advance} disabled={!college} size="lg" className="w-full">
                        <span>Continue</span>
                        <ArrowRight className="w-4 h-4" />
                      </Button>
                    </>
                  )}

                  {/* Step 4 — Year */}
                  {onboardingStep === 4 && (
                    <>
                      <div className="grid grid-cols-3 gap-2">
                        {[1, 2, 3, 4, 5, 6].map(yr => {
                          const sel = yearOfStudy === yr;
                          return (
                            <button
                              key={yr}
                              onClick={() => setYearOfStudy(yr)}
                              className={cn(
                                "flex flex-col items-center justify-center gap-1 py-4 rounded-xl border cursor-pointer transition-all font-[inherit]",
                                sel
                                  ? "bg-primary/10 border-primary/40"
                                  : "bg-muted border-border hover:border-primary/40"
                              )}
                            >
                              <span className={cn("text-2xl font-black", sel ? "text-primary" : "text-foreground")}>{yr}</span>
                              <span className={cn("text-[10px] font-semibold", sel ? "text-muted-foreground" : "text-muted-foreground/50")}>
                                {yr === 1 ? "1st" : yr === 2 ? "2nd" : yr === 3 ? "3rd" : `${yr}th`} year
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <Button onClick={advance} disabled={yearOfStudy === null || loading} size="lg" className="w-full">
                        {loading
                          ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Saving…</span></>
                          : <><span>Start studying</span><ArrowRight className="w-4 h-4" /></>}
                      </Button>
                    </>
                  )}

                </CardContent>
              </Card>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Auth form ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">

        {/* Logo */}
        <div className="text-3xl font-black tracking-tight mb-7">
          cortex<span className="text-primary">Q</span>
        </div>

        <div className="w-full max-w-[420px] bg-card rounded-xl border border-border shadow-sm p-7">

          {/* Tabs */}
          <div className="flex border-b border-border mb-6">
            {(["login", "signup"] as const).map(m => (
              <button
                key={m}
                onClick={() => switchMode(m)}
                className={cn(
                  "flex-1 py-2.5 text-sm font-bold bg-transparent border-0 cursor-pointer transition-colors relative font-[inherit]",
                  mode === m ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {m === "login" ? "Log In" : "Sign Up"}
                {mode === m && (
                  <span className="absolute bottom-[-1px] left-0 right-0 h-0.5 rounded-t-sm bg-primary" />
                )}
              </button>
            ))}
          </div>

          {/* Banners */}
          {success && (
            <div className="mb-4 rounded-md p-3 text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              {success}
            </div>
          )}
          {error && (
            <div className="mb-4 rounded-md p-3 text-sm bg-destructive/10 border border-destructive/20 text-destructive-foreground">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Email Address</label>
              <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@university.edu"
                className={inputClass}
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={6}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "signup" ? "Min. 6 characters" : "••••••••"}
                  className={cn(inputClass, "pr-10")}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {mode === "signup" && password && strength && (
                <div>
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4, 5].map(i => (
                      <div
                        key={i}
                        className="h-0.5 flex-1 rounded-full transition-colors duration-300"
                        style={{ background: i <= strength.score ? strength.bg : "var(--color-muted)" }}
                      />
                    ))}
                  </div>
                  <p className="text-[11px]" style={{ color: strength.color }}>{strength.label}</p>
                </div>
              )}
            </div>

            {/* Confirm Password — signup only */}
            {mode === "signup" && (
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-muted-foreground">Confirm Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    placeholder="Re-enter your password"
                    className={cn(inputClass, "pr-10", confirmPassword && confirmPassword !== password ? "border-destructive/60 focus:ring-destructive/30" : "")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword && confirmPassword !== password && (
                  <p className="text-[11px] text-destructive">Passwords do not match</p>
                )}
                {confirmPassword && confirmPassword === password && (
                  <p className="text-[11px] text-emerald-500 flex items-center gap-1"><Check className="w-3 h-3" /> Passwords match</p>
                )}
              </div>
            )}

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <div
                  onClick={() => setRememberMe(v => !v)}
                  className={cn(
                    "w-9 h-5 rounded-full border relative cursor-pointer transition-colors flex-shrink-0",
                    rememberMe ? "bg-primary border-transparent" : "bg-muted border-border"
                  )}
                >
                  <div
                    className={cn(
                      "absolute top-[3px] w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all duration-200",
                      rememberMe ? "left-[18px]" : "left-[3px]"
                    )}
                  />
                </div>
                <span className="text-xs text-muted-foreground">Remember me</span>
              </label>
              {mode === "login" && (
                <a
                  href="mailto:support@themcq.app?subject=Password%20Reset%20Request"
                  className="text-xs text-primary hover:opacity-70 transition-opacity"
                >
                  Forgot password?
                </a>
              )}
            </div>

            {/* Submit */}
            <Button type="submit" disabled={loading} size="lg" className="w-full mt-1">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /><span>{mode === "login" ? "Signing in…" : "Creating account…"}</span></>
                : <span>{mode === "login" ? "Continue" : "Create Account"}</span>}
            </Button>

            {/* Divider */}
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            {/* Google */}
            <Button type="button" variant="outline" size="lg" className="w-full gap-2.5">
              <svg width="17" height="17" viewBox="0 0 24 24" className="flex-shrink-0">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </Button>
          </form>

          {/* Switch mode */}
          <div className="mt-5 text-center">
            <button
              type="button"
              onClick={() => switchMode(mode === "login" ? "signup" : "login")}
              className="text-sm text-muted-foreground bg-transparent border-0 cursor-pointer font-[inherit]"
            >
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <span className="text-primary font-semibold">{mode === "login" ? "Sign up" : "Sign in"}</span>
            </button>
          </div>
        </div>

        {/* Tagline */}
        <p className="mt-7 text-xs text-center text-muted-foreground/40 max-w-xs leading-relaxed">
          &ldquo;The most fluid learning interface I&apos;ve ever navigated.&rdquo;
          <br /><span className="text-[11px] text-muted-foreground/20">— Elena Vance, PhD</span>
        </p>
      </main>
    </div>
  );
}
