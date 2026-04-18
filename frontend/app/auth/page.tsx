"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signup, login, saveOnboarding } from "@/lib/api";
import { saveToken } from "@/lib/auth";

const REMEMBERED_EMAIL_KEY = "studyai_remembered_email";
const REMEMBER_ME_KEY = "studyai_remember_me";

// Dashboard palette (from globals.css oklch values)
const C = {
  bg:       "#0b0c14",
  card:     "#131420",
  cardBorder:"#1e2033",
  muted:    "#1a1b28",
  input:    "#1a1b28",
  inputBorder:"#262840",
  primary:  "#7c3aed",
  primaryHover:"#6d28d9",
  fg:       "#f0f1f7",
  fgMuted:  "#8f96a8",
  fgDim:    "#404568",
};

function getPasswordStrength(password: string): { score: number; label: string; bg: string; color: string } {
  if (!password) return { score: 0, label: "", bg: "", color: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { score, label: "Weak",        bg: "#ef4444", color: "#ef4444" };
  if (score <= 2) return { score, label: "Fair",        bg: "#f97316", color: "#f97316" };
  if (score <= 3) return { score, label: "Good",        bg: "#eab308", color: "#eab308" };
  if (score <= 4) return { score, label: "Strong",      bg: "#22c55e", color: "#22c55e" };
  return           { score, label: "Very strong",   bg: "#16a34a", color: "#16a34a" };
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

const inputBase: React.CSSProperties = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: 10,
  background: C.input,
  border: `1px solid ${C.inputBorder}`,
  color: C.fg,
  fontSize: 14,
  outline: "none",
  fontFamily: "inherit",
  transition: "border-color 0.15s",
  boxSizing: "border-box",
};

function OnboardingCard({ step, title, subtitle, children }: { step: number; title: string; subtitle: string; children: React.ReactNode }) {
  const icons = ["person", "school", "domain", "military_tech"];
  return (
    <div style={{ borderRadius: 16, padding: 28, background: C.card, border: `1px solid ${C.cardBorder}`, position: "relative", overflow: "hidden" }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.07em", marginBottom: 14, background: "rgba(124,58,237,0.12)", color: "#a78bfa", border: "1px solid rgba(124,58,237,0.25)" }}>
          <span className="material-symbols-outlined" style={{ fontSize: 13, fontVariationSettings: "'FILL' 1" }}>{icons[step - 1]}</span>
          Step {step} of 4
        </div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: C.fg, letterSpacing: "-0.01em", margin: "0 0 5px" }}>{title}</h2>
        <p style={{ fontSize: 13, color: C.fgMuted, margin: 0 }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>{children}</div>
    </div>
  );
}

function PrimaryBtn({ onClick, disabled, loading, children }: { onClick?: () => void; disabled?: boolean; loading?: boolean; children: React.ReactNode }) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      disabled={disabled || loading}
      style={{ width: "100%", padding: "12px 0", borderRadius: 10, background: disabled ? C.muted : C.primary, color: "white", fontWeight: 700, fontSize: 14, border: "none", cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.5 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit", transition: "background 0.15s, opacity 0.15s" }}
      onMouseEnter={e => { if (!disabled && !loading) e.currentTarget.style.background = C.primaryHover; }}
      onMouseLeave={e => { if (!disabled && !loading) e.currentTarget.style.background = C.primary; }}
    >
      {children}
    </button>
  );
}

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode]               = useState<"login" | "signup">("login");
  const [email, setEmail]             = useState("");
  const [password, setPassword]       = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe]   = useState(false);
  const [error, setError]             = useState("");
  const [success, setSuccess]         = useState("");
  const [loading, setLoading]         = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [animKey, setAnimKey]         = useState(0);
  const [userName, setUserName]       = useState("");
  const [university, setUniversity]   = useState("");
  const [college, setCollege]         = useState("");
  const [yearOfStudy, setYearOfStudy] = useState<number | null>(null);

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
        router.push(new URLSearchParams(window.location.search).get("redirect") || "/dashboard");
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
    setMode(m); setError(""); setSuccess(""); setPassword(""); setShowPassword(false);
  };

  const advance = async () => {
    if (onboardingStep === 0) { setOnboardingStep(1); setAnimKey(k => k + 1); }
    else if (onboardingStep === 1 && userName.trim())   { setOnboardingStep(2); setAnimKey(k => k + 1); }
    else if (onboardingStep === 2 && university.trim()) { setOnboardingStep(3); setAnimKey(k => k + 1); }
    else if (onboardingStep === 3 && college)           { setOnboardingStep(4); setAnimKey(k => k + 1); }
    else if (onboardingStep === 4 && yearOfStudy !== null) {
      setLoading(true);
      try { await saveOnboarding(userName.trim(), university.trim(), college, yearOfStudy); } catch {}
      finally { setLoading(false); }
      localStorage.setItem("cortexq_profile", JSON.stringify({ name: userName, university, college, yearOfStudy }));
      router.push("/dashboard");
    }
  };

  const goBack = () => {
    if (onboardingStep > 0) { setOnboardingStep(s => s - 1); setAnimKey(k => k + 1); }
  };

  const strength = mode === "signup" ? getPasswordStrength(password) : null;

  // ── Onboarding ──────────────────────────────────────────────────────────────

  if (showOnboarding) {
    return (
      <div style={{ minHeight: "100vh", backgroundColor: C.bg, color: C.fg }}>
        <style>{`
          @keyframes cq-slide-in { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:translateX(0); } }
          @keyframes cq-fade-up  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
          @keyframes spin        { to { transform:rotate(360deg); } }
          .cq-enter   { animation: cq-slide-in 0.35s ease forwards; }
          .cq-up-1    { opacity:0; animation: cq-fade-up 0.4s ease 0.1s forwards; }
          .cq-up-2    { opacity:0; animation: cq-fade-up 0.4s ease 0.22s forwards; }
          .cq-up-3    { opacity:0; animation: cq-fade-up 0.4s ease 0.34s forwards; }
        `}</style>

        <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>
          {/* Logo */}
          <div style={{ fontSize: 24, fontWeight: 900, color: C.fg, letterSpacing: "-0.02em", marginBottom: 32 }}>
            cortex<span style={{ color: C.primary }}>Q</span>
          </div>

          {/* Progress */}
          {onboardingStep > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
              <button onClick={goBack} style={{ width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: C.muted, border: `1px solid ${C.cardBorder}`, cursor: "pointer", color: C.fgMuted, flexShrink: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: 17 }}>arrow_back</span>
              </button>
              <div style={{ display: "flex", gap: 5 }}>
                {[1,2,3,4].map(i => (
                  <div key={i} style={{ height: 5, borderRadius: 999, transition: "all 0.3s ease", width: i === onboardingStep ? 24 : 5, background: i <= onboardingStep ? C.primary : C.cardBorder }} />
                ))}
              </div>
            </div>
          )}

          <div key={animKey} className="cq-enter" style={{ width: "100%", maxWidth: 420 }}>

            {/* Step 0 — Welcome */}
            {onboardingStep === 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 72, height: 72, borderRadius: 20, marginBottom: 24, background: "rgba(124,58,237,0.15)", border: `1px solid rgba(124,58,237,0.3)` }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 36, color: C.primary, fontVariationSettings: "'FILL' 1" }}>neurology</span>
                </div>
                <h1 style={{ fontSize: 26, fontWeight: 900, color: C.fg, letterSpacing: "-0.02em", margin: "0 0 10px" }}>Nice to meet you!</h1>
                <p style={{ color: C.fgMuted, lineHeight: 1.65, margin: "0 auto 28px", maxWidth: 320, fontSize: 14 }}>
                  cortexQ turns your lecture PDFs into smart MCQ quizzes — study smarter, retain more, enjoy exam prep.
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 28 }}>
                  {[
                    { icon: "upload_file", title: "Upload",   desc: "Drop your lectures", cls: "cq-up-1" },
                    { icon: "quiz",        title: "Generate", desc: "AI builds MCQs",     cls: "cq-up-2" },
                    { icon: "trending_up", title: "Improve",  desc: "Track your growth",  cls: "cq-up-3" },
                  ].map(f => (
                    <div key={f.icon} className={f.cls} style={{ borderRadius: 12, padding: "14px 8px", textAlign: "center", background: C.card, border: `1px solid ${C.cardBorder}` }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 26, display: "block", marginBottom: 6, color: C.primary, fontVariationSettings: "'FILL' 1" }}>{f.icon}</span>
                      <div style={{ fontSize: 12, fontWeight: 700, color: C.fg, marginBottom: 2 }}>{f.title}</div>
                      <div style={{ fontSize: 11, color: C.fgMuted, lineHeight: 1.4 }}>{f.desc}</div>
                    </div>
                  ))}
                </div>
                <PrimaryBtn onClick={advance}>
                  <span>Let&apos;s get started</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                </PrimaryBtn>
              </div>
            )}

            {/* Step 1 — Name */}
            {onboardingStep === 1 && (
              <OnboardingCard step={1} title="What should we call you?" subtitle="We'll personalize your experience">
                <input autoFocus type="text" value={userName} onChange={e => setUserName(e.target.value)} onKeyDown={e => e.key === "Enter" && userName.trim() && advance()} placeholder="Your first name" style={inputBase} onFocus={e => (e.target.style.borderColor = C.primary)} onBlur={e => (e.target.style.borderColor = C.inputBorder)} />
                <PrimaryBtn onClick={advance} disabled={!userName.trim()}>
                  <span>Continue</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                </PrimaryBtn>
              </OnboardingCard>
            )}

            {/* Step 2 — University */}
            {onboardingStep === 2 && (
              <OnboardingCard step={2} title={userName ? `Hey ${userName}! Where do you study?` : "Where do you study?"} subtitle="Your university or college">
                <input autoFocus type="text" value={university} onChange={e => setUniversity(e.target.value)} onKeyDown={e => e.key === "Enter" && university.trim() && advance()} placeholder="University or College name" style={inputBase} onFocus={e => (e.target.style.borderColor = C.primary)} onBlur={e => (e.target.style.borderColor = C.inputBorder)} />
                <PrimaryBtn onClick={advance} disabled={!university.trim()}>
                  <span>Continue</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                </PrimaryBtn>
              </OnboardingCard>
            )}

            {/* Step 3 — College */}
            {onboardingStep === 3 && (
              <OnboardingCard step={3} title="Which faculty are you in?" subtitle="Your college or faculty of study">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
                  {COLLEGES.map(col => {
                    const sel = college === col.id;
                    return (
                      <button key={col.id} onClick={() => setCollege(col.id)}
                        style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 10, textAlign: "left", background: sel ? "rgba(124,58,237,0.15)" : C.muted, border: `1px solid ${sel ? "rgba(124,58,237,0.4)" : C.inputBorder}`, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit" }}
                        onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = C.primary; }}
                        onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = C.inputBorder; }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 16, flexShrink: 0, color: sel ? C.primary : C.fgDim, fontVariationSettings: "'FILL' 1" }}>{col.icon}</span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: sel ? C.fg : C.fgMuted, lineHeight: 1.3, flex: 1 }}>{col.label}</span>
                        {sel && <span className="material-symbols-outlined" style={{ fontSize: 14, color: C.primary, flexShrink: 0, fontVariationSettings: "'FILL' 1" }}>check_circle</span>}
                      </button>
                    );
                  })}
                </div>
                <PrimaryBtn onClick={advance} disabled={!college}>
                  <span>Continue</span>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_forward</span>
                </PrimaryBtn>
              </OnboardingCard>
            )}

            {/* Step 4 — Year */}
            {onboardingStep === 4 && (
              <OnboardingCard step={4} title="What year are you in?" subtitle="Your current year of study">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[1,2,3,4,5,6].map(yr => {
                    const sel = yearOfStudy === yr;
                    return (
                      <button key={yr} onClick={() => setYearOfStudy(yr)}
                        style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, padding: "18px 0", borderRadius: 12, background: sel ? "rgba(124,58,237,0.15)" : C.muted, border: `1px solid ${sel ? "rgba(124,58,237,0.4)" : C.inputBorder}`, cursor: "pointer", transition: "all 0.15s", fontFamily: "inherit" }}
                        onMouseEnter={e => { if (!sel) e.currentTarget.style.borderColor = C.primary; }}
                        onMouseLeave={e => { if (!sel) e.currentTarget.style.borderColor = C.inputBorder; }}
                      >
                        <span style={{ fontSize: 26, fontWeight: 900, color: sel ? C.primary : C.fg }}>{yr}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, color: sel ? C.fgMuted : C.fgDim }}>{yr === 1 ? "1st" : yr === 2 ? "2nd" : yr === 3 ? "3rd" : `${yr}th`} year</span>
                      </button>
                    );
                  })}
                </div>
                <PrimaryBtn onClick={advance} disabled={yearOfStudy === null || loading} loading={loading}>
                  {loading
                    ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", animation: "spin 0.8s linear infinite" }} /><span>Saving…</span></>
                    : <><span className="material-symbols-outlined" style={{ fontSize: 18 }}>rocket_launch</span><span>Start studying</span></>}
                </PrimaryBtn>
              </OnboardingCard>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Auth form ─────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: "100vh", backgroundColor: C.bg, color: C.fg }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      <main style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 24px" }}>

        {/* Logo */}
        <div style={{ fontSize: 28, fontWeight: 900, color: C.fg, letterSpacing: "-0.02em", marginBottom: 28 }}>
          cortex<span style={{ color: C.primary }}>Q</span>
        </div>

        {/* Card */}
        <div style={{ width: "100%", maxWidth: 420, borderRadius: 16, padding: "28px 28px 24px", background: C.card, border: `1px solid ${C.cardBorder}` }}>

          {/* Tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${C.cardBorder}`, marginBottom: 24 }}>
            {(["login", "signup"] as const).map(m => (
              <button key={m} onClick={() => switchMode(m)}
                style={{ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 700, background: "none", border: "none", cursor: "pointer", color: mode === m ? C.fg : C.fgDim, position: "relative", fontFamily: "inherit", transition: "color 0.15s" }}>
                {m === "login" ? "Log In" : "Sign Up"}
                {mode === m && <span style={{ position: "absolute", bottom: -1, left: 0, width: "100%", height: 2, borderRadius: "2px 2px 0 0", background: C.primary }} />}
              </button>
            ))}
          </div>

          {/* Banners */}
          {success && <div style={{ marginBottom: 16, padding: "11px 14px", borderRadius: 10, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", color: "#4ade80", fontSize: 13 }}>{success}</div>}
          {error   && <div style={{ marginBottom: 16, padding: "11px 14px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", fontSize: 13 }}>{error}</div>}

          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }} noValidate>

            {/* Email */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.fgMuted }}>Email Address</label>
              <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" placeholder="you@university.edu"
                style={inputBase} onFocus={e => (e.target.style.borderColor = C.primary)} onBlur={e => (e.target.style.borderColor = C.inputBorder)} />
            </div>

            {/* Password */}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: C.fgMuted }}>Password</label>
              <div style={{ position: "relative" }}>
                <input type={showPassword ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "signup" ? "Min. 6 characters" : "••••••••"}
                  style={{ ...inputBase, paddingRight: 44 }}
                  onFocus={e => (e.target.style.borderColor = C.primary)} onBlur={e => (e.target.style.borderColor = C.inputBorder)} />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: C.fgDim, padding: 0, transition: "color 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.color = C.fgMuted)} onMouseLeave={e => (e.currentTarget.style.color = C.fgDim)}>
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>{showPassword ? "visibility_off" : "visibility"}</span>
                </button>
              </div>
              {mode === "signup" && password && strength && (
                <div>
                  <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                    {[1,2,3,4,5].map(i => (
                      <div key={i} style={{ height: 3, flex: 1, borderRadius: 999, background: i <= strength.score ? strength.bg : C.muted, transition: "background 0.3s" }} />
                    ))}
                  </div>
                  <p style={{ fontSize: 11, color: strength.color, margin: 0 }}>{strength.label}</p>
                </div>
              )}
            </div>

            {/* Remember + Forgot */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <div onClick={() => setRememberMe(v => !v)}
                  style={{ width: 34, height: 19, borderRadius: 999, background: rememberMe ? C.primary : C.muted, border: `1px solid ${C.cardBorder}`, position: "relative", cursor: "pointer", transition: "background 0.2s", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 2, left: rememberMe ? 16 : 2, width: 13, height: 13, borderRadius: "50%", background: "white", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.4)" }} />
                </div>
                <span style={{ fontSize: 12, color: C.fgMuted }}>Remember me</span>
              </label>
              {mode === "login" && (
                <button type="button" onClick={() => setError("Password reset coming soon!")}
                  style={{ fontSize: 12, color: C.primary, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", transition: "opacity 0.15s" }}
                  onMouseEnter={e => (e.currentTarget.style.opacity = "0.7")} onMouseLeave={e => (e.currentTarget.style.opacity = "1")}>
                  Forgot password?
                </button>
              )}
            </div>

            {/* Submit */}
            <button type="submit" disabled={loading}
              style={{ width: "100%", padding: "12px 0", borderRadius: 10, background: C.primary, color: "white", fontWeight: 700, fontSize: 14, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.75 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontFamily: "inherit", transition: "background 0.15s, opacity 0.15s", marginTop: 4 }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.background = C.primaryHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = C.primary; }}>
              {loading
                ? <><div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", animation: "spin 0.8s linear infinite" }} /><span>{mode === "login" ? "Signing in…" : "Creating account…"}</span></>
                : <span>{mode === "login" ? "Continue" : "Create Account"}</span>}
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, height: 1, background: C.cardBorder }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.fgDim, textTransform: "uppercase" as const, letterSpacing: "0.1em" }}>or</span>
              <div style={{ flex: 1, height: 1, background: C.cardBorder }} />
            </div>

            {/* Google */}
            <button type="button"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 9, padding: "11px 0", borderRadius: 10, background: C.muted, border: `1px solid ${C.cardBorder}`, color: C.fgMuted, fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = C.primary; e.currentTarget.style.color = C.fg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = C.cardBorder; e.currentTarget.style.color = C.fgMuted; }}>
              <svg width="17" height="17" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>
          </form>

          {/* Switch */}
          <div style={{ marginTop: 20, textAlign: "center" }}>
            <button type="button" onClick={() => switchMode(mode === "login" ? "signup" : "login")}
              style={{ fontSize: 13, color: C.fgMuted, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <span style={{ color: C.primary, fontWeight: 600 }}>{mode === "login" ? "Sign up" : "Sign in"}</span>
            </button>
          </div>
        </div>

        {/* Tagline */}
        <p style={{ marginTop: 28, color: C.fgDim, fontSize: 12, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
          &ldquo;The most fluid learning interface I&apos;ve ever navigated.&rdquo;
          <br /><span style={{ color: "#2a2d45", fontSize: 11 }}>— Elena Vance, PhD</span>
        </p>
      </main>
    </div>
  );
}
