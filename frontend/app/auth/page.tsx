"use client";
import { Suspense } from "react";
import { useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { requestMagicLink, saveOnboarding, verifyCode, getMe } from "@/lib/api";
import { saveToken } from "@/lib/auth";
import { useTelegram } from "@/lib/useTelegram";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowRight, ArrowLeft, Loader2, Check, Mail, RefreshCw } from "lucide-react";

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

type Screen = "form" | "otp" | "onboarding";

function AuthPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isInTelegram } = useTelegram();

  const [screen, setScreen]       = useState<Screen>("form");
  const [email, setEmail]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [sentEmail, setSentEmail] = useState("");
  const [otpDigits, setOtpDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [otpError, setOtpError]   = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [resendDisabled, setResendDisabled] = useState(false);
  const resendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const verifyOtpRef = useRef<() => void>(() => {});
  const otpDigitsRef = useRef(otpDigits);
  const emailRef = useRef<HTMLInputElement>(null);

  // Onboarding state
  const SAVED_ONBOARDING_KEY = "onboarding_progress";
  const [onboardingStep, setOnboardingStep]   = useState(1);
  const [animKey, setAnimKey]                 = useState(0);
  const [userName, setUserName]               = useState("");
  const [university, setUniversity]           = useState("");
  const [college, setCollege]                 = useState("");
  const [yearOfStudy, setYearOfStudy]         = useState<number | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);

  useEffect(() => {
    if (isInTelegram) {
      const token = localStorage.getItem("token");
      if (token) router.replace("/dashboard");
    }
  }, [isInTelegram, router]);

  useEffect(() => {
    if (searchParams.get("error") === "invalid_link") {
      setError("That sign-in link is invalid or has expired. Request a new one below.");
    }
    if (searchParams.get("onboarding") === "true") {
      const saved = localStorage.getItem(SAVED_ONBOARDING_KEY);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          if (data.step && data.step >= 1 && data.step <= 4) {
            setOnboardingStep(data.step);
            setUserName(data.name || "");
            setUniversity(data.university || "");
            setCollege(data.college || "");
            setYearOfStudy(data.yearOfStudy ?? null);
          }
        } catch {}
      }
      setScreen("onboarding");
    }
  }, [searchParams]);

  useEffect(() => {
    if (screen === "form") emailRef.current?.focus();
  }, [screen]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await requestMagicLink(email.trim().toLowerCase());
      setSentEmail(email.trim().toLowerCase());
      setOtpDigits(["", "", "", "", "", ""]);
      setOtpError("");
      setScreen("otp");
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string }; status?: number } };
      if (axiosErr.response?.status === 429) {
        setError("Too many requests — wait a few minutes before trying again.");
      } else {
        setError(axiosErr.response?.data?.detail || "Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resendDisabled) return;
    setLoading(true);
    setResendDisabled(true);
    try {
      await requestMagicLink(sentEmail);
      setOtpError("");
    } catch {
      // silently ignore on resend
    } finally {
      setLoading(false);
      if (resendTimerRef.current) clearTimeout(resendTimerRef.current);
      resendTimerRef.current = setTimeout(() => setResendDisabled(false), 60000);
    }
  };

  const handleVerifyOtp = async () => {
    const code = otpDigits.join("");
    if (code.length !== 6 || otpLoading) return;
    setOtpError("");
    setOtpLoading(true);
    try {
      const res = await verifyCode(sentEmail, code);
      saveToken(res.data.access_token);
      const userRes = await getMe();
      if (!userRes.data.name) {
        router.replace("/auth?onboarding=true");
      } else {
        const redirectTo = sessionStorage.getItem("auth_redirect") || "/dashboard";
        sessionStorage.removeItem("auth_redirect");
        router.replace(redirectTo);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string }; status?: number } };
      if (axiosErr.response?.status === 429) {
        setOtpError("Too many attempts. Please wait a few minutes.");
      } else {
        setOtpError("Incorrect or expired code. Try again.");
      }
    } finally {
      setOtpLoading(false);
    }
  };

  verifyOtpRef.current = handleVerifyOtp;
  otpDigitsRef.current = otpDigits;

  useEffect(() => {
    if (screen === "otp" && otpDigits.every(d => d !== "") && !otpLoading) {
      verifyOtpRef.current();
    }
  }, [otpDigits.join("")]);

  useEffect(() => {
    if (screen !== "otp") return;
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      if (otpRefs.current.some(el => el === active)) return;
      const digits = otpDigitsRef.current;
      if (e.key >= "0" && e.key <= "9") {
        e.preventDefault();
        const nextEmpty = digits.indexOf("");
        if (nextEmpty === -1) return;
        const newDigits = [...digits];
        newDigits[nextEmpty] = e.key;
        setOtpDigits(newDigits);
        otpRefs.current[nextEmpty]?.focus();
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        let lastFilled = -1;
        for (let i = digits.length - 1; i >= 0; i--) {
          if (digits[i]) { lastFilled = i; break; }
        }
        if (lastFilled === -1) return;
        const newDigits = [...digits];
        newDigits[lastFilled] = "";
        setOtpDigits(newDigits);
        otpRefs.current[lastFilled]?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [screen]);

  const handleOtpDigit = (index: number, value: string) => {
    if (value.length > 1) return;
    const digit = value.replace(/\D/g, "");
    const newDigits = [...otpDigits];
    newDigits[index] = digit;
    setOtpDigits(newDigits);
    setOtpError("");
    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
    if (e.key === "Enter") {
      handleVerifyOtp();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const newDigits = [...otpDigits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setOtpDigits(newDigits);
    setOtpError("");
    const nextIndex = Math.min(pasted.length, 5);
    otpRefs.current[nextIndex]?.focus();
  };

  // ── Onboarding ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (screen === "onboarding") {
      localStorage.setItem(SAVED_ONBOARDING_KEY, JSON.stringify({
        step: onboardingStep,
        name: userName,
        university,
        college,
        yearOfStudy,
      }));
    }
  }, [onboardingStep, userName, university, college, yearOfStudy, screen]);

  const advanceOnboarding = async () => {
    if (onboardingStep === 1 && userName.trim()) {
      setOnboardingStep(2);
      setAnimKey(k => k + 1);
    } else if (onboardingStep === 2 && university.trim()) {
      setOnboardingStep(3);
      setAnimKey(k => k + 1);
    } else if (onboardingStep === 3 && college) {
      setOnboardingStep(4);
      setAnimKey(k => k + 1);
    } else if (onboardingStep === 4 && yearOfStudy !== null) {
      setSavingOnboarding(true);
      try { await saveOnboarding(userName.trim(), university.trim(), college, yearOfStudy); } catch {}
      finally { setSavingOnboarding(false); }
      localStorage.setItem("themcq_profile", JSON.stringify({ name: userName, university, college, yearOfStudy }));
      localStorage.removeItem(SAVED_ONBOARDING_KEY);
      router.push(`/welcome?name=${encodeURIComponent(userName.trim())}`);
    }
  };

  const goBackOnboarding = () => {
    if (onboardingStep > 1) { setOnboardingStep(s => s - 1); setAnimKey(k => k + 1); }
  };

  const inputClass =
    "w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground transition-colors";

  // ── Onboarding screen ────────────────────────────────────────────────────────

  if (screen === "onboarding") {
    const stepTitles = [
      "",
      "What should we call you?",
      userName ? `Hey ${userName}! Where do you study?` : "Where do you study?",
      "Which faculty are you in?",
      "What year are you in?",
    ];
    const stepSubtitles = [
      "",
      "We'll personalize your experience",
      "Your university or college",
      "Your college or faculty of study",
      "Your current year of study",
    ];

    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
          <div className="text-2xl font-black tracking-tight mb-8">
            the<span className="text-primary">mcq</span>
          </div>

          <div className="flex items-center gap-3.5 mb-6">
            <button
              onClick={goBackOnboarding}
              disabled={onboardingStep === 1}
              className="w-8 h-8 rounded-full flex items-center justify-center bg-muted border border-border text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30"
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

          <div key={animKey} className="w-full max-w-[420px]">
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

                {onboardingStep === 1 && (
                  <>
                    <input
                      autoFocus
                      type="text"
                      value={userName}
                      onChange={e => setUserName(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && userName.trim() && advanceOnboarding()}
                      placeholder="Your first name"
                      className={inputClass}
                    />
                    <Button onClick={advanceOnboarding} disabled={!userName.trim()} size="lg" className="w-full">
                      <span>Continue</span><ArrowRight className="w-4 h-4" />
                    </Button>
                  </>
                )}

                {onboardingStep === 2 && (
                  <>
                    <input
                      autoFocus
                      type="text"
                      value={university}
                      onChange={e => setUniversity(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && university.trim() && advanceOnboarding()}
                      placeholder="University or College name"
                      className={inputClass}
                    />
                    <Button onClick={advanceOnboarding} disabled={!university.trim()} size="lg" className="w-full">
                      <span>Continue</span><ArrowRight className="w-4 h-4" />
                    </Button>
                  </>
                )}

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
                              style={{ fontSize: 16, color: sel ? "var(--color-primary)" : undefined, fontVariationSettings: "'FILL' 1" }}
                            >
                              {col.icon}
                            </span>
                            <span className="text-xs font-semibold leading-snug flex-1">{col.label}</span>
                            {sel && <Check className="w-3.5 h-3.5 flex-shrink-0 text-primary" />}
                          </button>
                        );
                      })}
                    </div>
                    <Button onClick={advanceOnboarding} disabled={!college} size="lg" className="w-full">
                      <span>Continue</span><ArrowRight className="w-4 h-4" />
                    </Button>
                  </>
                )}

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
                              sel ? "bg-primary/10 border-primary/40" : "bg-muted border-border hover:border-primary/40"
                            )}
                          >
                            <span className={cn("text-2xl font-black", sel ? "text-primary" : "text-foreground")}>{yr}</span>
                            <span className={cn("text-[10px] font-semibold text-muted-foreground", !sel && "opacity-50")}>
                              {yr === 1 ? "1st" : yr === 2 ? "2nd" : yr === 3 ? "3rd" : `${yr}th`} year
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    <Button onClick={advanceOnboarding} disabled={yearOfStudy === null || savingOnboarding} size="lg" className="w-full">
                      {savingOnboarding
                        ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Saving…</span></>
                        : <><span>Start studying</span><ArrowRight className="w-4 h-4" /></>}
                    </Button>
                  </>
                )}

              </CardContent>
            </Card>
          </div>
        </main>
      </div>
    );
  }

  // ── OTP verification screen ──────────────────────────────────────────────────

  if (screen === "otp") {
    const digitBoxClass = (filled: boolean) =>
      cn(
        "w-11 h-14 text-center text-2xl font-bold rounded-lg border transition-all outline-none",
        filled
          ? "border-primary bg-primary/5 text-foreground"
          : "border-input bg-background text-foreground",
        "focus:border-primary focus:ring-2 focus:ring-primary/30",
      );

    const allFilled = otpDigits.every(d => d !== "");

    return (
      <div className="min-h-screen bg-background text-foreground">
        <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">
          <div className="text-3xl font-black tracking-tight mb-10">
            the<span className="text-primary">mcq</span>
          </div>

          <div className="w-full max-w-[400px] text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 mb-6">
              <Mail className="w-7 h-7 text-primary" />
            </div>

            <h1 className="text-2xl font-black tracking-tight mb-2">Check your email</h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-1">
              We sent a sign-in link and a code to
            </p>
            <p className="text-sm font-semibold text-foreground mb-8">{sentEmail}</p>

            {otpError && (
              <div className="mb-4 rounded-md p-3 text-sm bg-destructive/10 border border-destructive/20 text-destructive-foreground">
                {otpError}
              </div>
            )}

            <p className="text-xs font-medium text-muted-foreground mb-4 uppercase tracking-wider">
              Enter code
            </p>

            <div className="flex items-center justify-center gap-2.5 mb-6">
              {otpDigits.map((digit, i) => (
                <input
                  key={i}
                  ref={el => { otpRefs.current[i] = el; }}
                  autoFocus={i === 0}
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpDigit(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  onPaste={i === 0 ? handleOtpPaste : undefined}
                  className={digitBoxClass(digit !== "")}
                />
              ))}
            </div>

            <Button
              onClick={handleVerifyOtp}
              disabled={!allFilled || otpLoading}
              size="lg"
              className="w-full max-w-[200px] mb-6"
            >
              {otpLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Verifying…</span></>
                : <><span>Verify</span><ArrowRight className="w-4 h-4" /></>}
            </Button>

            <div className="flex items-center gap-3 mb-5">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] text-muted-foreground/50">or</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <p className="text-xs text-muted-foreground/60 leading-relaxed mb-4">
              On desktop? Click the link in your email — no code needed.
            </p>

            <button
              onClick={handleResend}
              disabled={loading || resendDisabled}
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors bg-transparent border-0 cursor-pointer font-[inherit] disabled:opacity-50"
            >
              {loading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {resendDisabled ? "Resend available in 60s" : "Didn't receive it? Resend"}
            </button>

            <div className="mt-8">
              <button
                onClick={() => { setScreen("form"); setError(""); setOtpDigits(["", "", "", "", "", ""]); setOtpError(""); }}
                className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors bg-transparent border-0 cursor-pointer font-[inherit]"
              >
                Use a different email
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // ── Magic link form ──────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="min-h-screen flex flex-col items-center justify-center px-6 py-12">

        <div className="text-3xl font-black tracking-tight mb-8">
          the<span className="text-primary">mcq</span>
        </div>

        <div className="w-full max-w-[400px] bg-card rounded-xl border border-border shadow-sm p-7">
          <div className="mb-6">
            <h1 className="text-xl font-extrabold tracking-tight mb-1">Sign in</h1>
            <p className="text-sm text-muted-foreground">
              Enter your email — we&apos;ll send you a link. No password needed.
            </p>
          </div>

          {error && (
            <div className="mb-4 rounded-md p-3 text-sm bg-destructive/10 border border-destructive/20 text-destructive-foreground">
              {error}
            </div>
          )}

          {!isInTelegram && (
            <>
              <a
                href="/api/auth/google"
                className="flex items-center justify-center gap-2.5 w-full h-10 rounded-md border border-border bg-background text-sm font-semibold text-foreground hover:bg-muted transition-colors no-underline"
              >
                <svg width="17" height="17" viewBox="0 0 24 24" className="flex-shrink-0">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </a>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border" />
                <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
            </>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Email address</label>
              <input
                ref={emailRef}
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@university.edu"
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring/50 placeholder:text-muted-foreground transition-colors"
              />
            </div>

            <Button type="submit" disabled={loading || !email.trim()} size="lg" className="w-full">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Sending link…</span></>
                : <><span>Send sign-in link</span><ArrowRight className="w-4 h-4" /></>}
            </Button>
          </form>
        </div>

        <p className="mt-7 text-xs text-center text-muted-foreground/40 max-w-xs leading-relaxed">
          New here? Just enter your email — we&apos;ll create your account automatically.
        </p>
      </main>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <AuthPageInner />
    </Suspense>
  );
}
