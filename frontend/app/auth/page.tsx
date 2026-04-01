"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signup, login, saveOnboarding } from "@/lib/api";
import { saveToken } from "@/lib/auth";

const REMEMBERED_EMAIL_KEY = "studyai_remembered_email";
const REMEMBER_ME_KEY = "studyai_remember_me";

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: "", color: "" };
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 1) return { score, label: "Weak", color: "bg-red-400" };
  if (score <= 2) return { score, label: "Fair", color: "bg-orange-400" };
  if (score <= 3) return { score, label: "Good", color: "bg-yellow-400" };
  if (score <= 4) return { score, label: "Strong", color: "bg-green-400" };
  return { score, label: "Very strong", color: "bg-green-500" };
}

const COLLEGES = [
  { id: "medicine",       label: "Medicine",        icon: "stethoscope" },
  { id: "pharmacy",       label: "Pharmacy",         icon: "medication" },
  { id: "dentistry",      label: "Dentistry",        icon: "dentistry" },
  { id: "nursing",        label: "Nursing",          icon: "medical_services" },
  { id: "engineering",    label: "Engineering",      icon: "engineering" },
  { id: "computer",       label: "Computer Science", icon: "code" },
  { id: "business",       label: "Business",         icon: "business_center" },
  { id: "law",            label: "Law",              icon: "gavel" },
  { id: "science",        label: "Science",          icon: "science" },
  { id: "arts",           label: "Arts & Humanities",icon: "palette" },
  { id: "education",      label: "Education",        icon: "school" },
  { id: "other",          label: "Other",            icon: "more_horiz" },
];

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const [userName, setUserName] = useState("");
  const [university, setUniversity] = useState("");
  const [college, setCollege] = useState("");
  const [yearOfStudy, setYearOfStudy] = useState<number | null>(null);

  useEffect(() => {
    const savedRemember = localStorage.getItem(REMEMBER_ME_KEY) === "true";
    setRememberMe(savedRemember);
    if (savedRemember) {
      const savedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY) || "";
      setEmail(savedEmail);
    }
  }, []);

  useEffect(() => {
    if (!showOnboarding) emailRef.current?.focus();
  }, [mode, showOnboarding]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (mode === "signup") {
        await signup(email, password);
        setSuccess("Account created! Signing you in…");
        const res = await login(email, password);
        saveToken(res.data.access_token);
        if (rememberMe) {
          localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
          localStorage.setItem(REMEMBER_ME_KEY, "true");
        } else {
          localStorage.removeItem(REMEMBERED_EMAIL_KEY);
          localStorage.setItem(REMEMBER_ME_KEY, "false");
        }
        setShowOnboarding(true);
      } else {
        const res = await login(email, password);
        saveToken(res.data.access_token);
        if (rememberMe) {
          localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
          localStorage.setItem(REMEMBER_ME_KEY, "true");
        } else {
          localStorage.removeItem(REMEMBERED_EMAIL_KEY);
          localStorage.setItem(REMEMBER_ME_KEY, "false");
        }
        const redirectTo = new URLSearchParams(window.location.search).get("redirect") || "/dashboard";
        router.push(redirectTo);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } };
      setError(axiosErr.response?.data?.detail || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (newMode: "login" | "signup") => {
    setMode(newMode);
    setError("");
    setSuccess("");
    setPassword("");
    setShowPassword(false);
  };

  const advanceOnboarding = async () => {
    if (onboardingStep === 0) {
      setOnboardingStep(1); setAnimKey((k) => k + 1);
    } else if (onboardingStep === 1 && userName.trim()) {
      setOnboardingStep(2); setAnimKey((k) => k + 1);
    } else if (onboardingStep === 2 && university.trim()) {
      setOnboardingStep(3); setAnimKey((k) => k + 1);
    } else if (onboardingStep === 3 && college) {
      setOnboardingStep(4); setAnimKey((k) => k + 1);
    } else if (onboardingStep === 4 && yearOfStudy !== null) {
      setLoading(true);
      try {
        await saveOnboarding(userName.trim(), university.trim(), college, yearOfStudy);
      } catch {
        // non-blocking — profile saved locally even if request fails
      } finally {
        setLoading(false);
      }
      localStorage.setItem("cortexq_profile", JSON.stringify({ name: userName, university, college, yearOfStudy }));
      router.push("/dashboard");
    }
  };

  const goBackOnboarding = () => {
    if (onboardingStep > 0) {
      setOnboardingStep((s) => s - 1);
      setAnimKey((k) => k + 1);
    }
  };

  const strength = mode === "signup" ? getPasswordStrength(password) : null;

  // ── Shared background ────────────────────────────────────────────────────────
  const Bg = () => (
    <>
      <div className="grain-overlay" />
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full"
          style={{
            filter: "blur(80px)",
            background:
              "radial-gradient(circle, rgba(123,47,255,0.4) 0%, rgba(0,210,253,0.2) 60%, transparent 100%)",
          }}
        />
        <div className="absolute top-[20%] right-[10%] w-64 h-64 bg-primary-container/10 blur-[100px] rounded-full" />
        <div className="absolute bottom-[20%] left-[10%] w-96 h-96 bg-secondary-container/10 blur-[120px] rounded-full" />
      </div>
    </>
  );

  // ── Onboarding ────────────────────────────────────────────────────────────────
  if (showOnboarding) {
    return (
      <div
        className="relative min-h-screen text-on-surface overflow-x-hidden"
        style={{ backgroundColor: "#0d0f1c" }}
      >
        <Bg />

        <style>{`
          @keyframes cq-slide-in {
            from { opacity: 0; transform: translateX(52px) scale(0.97); }
            to   { opacity: 1; transform: translateX(0)   scale(1);    }
          }
          @keyframes cq-fade-up {
            from { opacity: 0; transform: translateY(22px); }
            to   { opacity: 1; transform: translateY(0);    }
          }
          @keyframes cq-pulse-icon {
            0%, 100% { box-shadow: 0 0 0 0 rgba(123,47,255,0); }
            50%       { box-shadow: 0 0 32px 8px rgba(123,47,255,0.35); }
          }
          @keyframes cq-spin-slow {
            from { transform: rotate(0deg); }
            to   { transform: rotate(360deg); }
          }
          .cq-step-enter { animation: cq-slide-in 0.45s cubic-bezier(0.16,1,0.3,1) forwards; }
          .cq-fade-up-1  { opacity:0; animation: cq-fade-up 0.5s ease 0.15s forwards; }
          .cq-fade-up-2  { opacity:0; animation: cq-fade-up 0.5s ease 0.28s forwards; }
          .cq-fade-up-3  { opacity:0; animation: cq-fade-up 0.5s ease 0.41s forwards; }
          .cq-level-card { transition: background 0.2s, border-color 0.2s, transform 0.15s; }
          .cq-level-card:hover { transform: scale(1.03); }
        `}</style>

        <main className="relative min-h-screen flex flex-col items-center justify-center px-6 py-12 z-10">
          {/* Logo */}
          <div className="text-2xl font-black bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent tracking-tighter mb-8">
            cortexQ
          </div>

          {/* Progress dots + back button – steps 1-3 only */}
          {onboardingStep > 0 && (
            <div className="flex items-center gap-4 mb-8">
              <button
                onClick={goBackOnboarding}
                className="flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200 hover:scale-110 active:scale-95 flex-shrink-0"
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.12)" }}
                aria-label="Go back"
              >
                <span className="material-symbols-outlined text-base text-on-surface-variant">arrow_back</span>
              </button>
              <div className="flex items-center gap-2">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="rounded-full transition-all duration-500"
                    style={{
                      height: 8,
                      width: i === onboardingStep ? 28 : 8,
                      background:
                        i <= onboardingStep
                          ? "linear-gradient(90deg,#7B2FFF,#00D2FD)"
                          : "rgba(255,255,255,0.12)",
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Step content — re-keyed so CSS entry animation re-fires */}
          <div key={animKey} className="cq-step-enter w-full max-w-md">

            {/* ── Step 0: Welcome ───────────────────────────────────────── */}
            {onboardingStep === 0 && (
              <div className="text-center">
                {/* Animated icon */}
                <div
                  className="inline-flex items-center justify-center w-20 h-20 rounded-3xl mb-6 mx-auto"
                  style={{
                    background:
                      "linear-gradient(135deg,rgba(123,47,255,0.25),rgba(0,210,253,0.15))",
                    border: "1px solid rgba(123,47,255,0.4)",
                    animation: "cq-pulse-icon 2.8s ease-in-out infinite",
                  }}
                >
                  <span
                    className="material-symbols-outlined text-[2.4rem]"
                    style={{
                      background: "linear-gradient(135deg,#7B2FFF,#00D2FD)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                      fontVariationSettings: "'FILL' 1",
                    }}
                  >
                    neurology
                  </span>
                </div>

                <h1 className="text-3xl font-black text-white mb-3 tracking-tight">
                  Nice to meet you!
                </h1>
                <p className="text-on-surface-variant leading-relaxed mb-10 max-w-sm mx-auto">
                  cortexQ turns your lecture PDFs into smart MCQ quizzes — so you
                  study smarter, retain more, and actually enjoy exam prep.
                </p>

                {/* Feature cards */}
                <div className="grid grid-cols-3 gap-3 mb-10">
                  {[
                    { icon: "upload_file", title: "Upload", desc: "Drop your lectures" },
                    { icon: "quiz",        title: "Generate", desc: "AI builds MCQs" },
                    { icon: "trending_up", title: "Improve",  desc: "Track your growth" },
                  ].map((feat, i) => (
                    <div
                      key={feat.icon}
                      className={`rounded-2xl p-4 text-center cq-fade-up-${i + 1}`}
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid rgba(255,255,255,0.08)",
                      }}
                    >
                      <span
                        className="material-symbols-outlined text-[1.7rem] mb-2 block"
                        style={{
                          background: "linear-gradient(135deg,#7B2FFF,#00D2FD)",
                          WebkitBackgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          fontVariationSettings: "'FILL' 1",
                        }}
                      >
                        {feat.icon}
                      </span>
                      <div className="text-sm font-bold text-white">{feat.title}</div>
                      <div className="text-xs text-on-surface-variant mt-0.5 leading-snug">
                        {feat.desc}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={advanceOnboarding}
                  className="w-full py-4 text-white font-bold rounded-xl shadow-lg hover:-translate-y-1 active:scale-[0.98] transition-all duration-300 flex items-center justify-center gap-2"
                  style={{
                    background: "linear-gradient(90deg,#7B2FFF,#00D2FD)",
                    boxShadow: "0 8px 32px rgba(123,47,255,0.35)",
                  }}
                >
                  <span>Let&apos;s get started</span>
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
              </div>
            )}

            {/* ── Step 1: Name ──────────────────────────────────────────── */}
            {onboardingStep === 1 && (
              <div
                className="rounded-3xl p-8 shadow-2xl relative overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(24px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#7B2FFF]/40 to-transparent" />

                <div className="mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4"
                    style={{ background: "rgba(123,47,255,0.15)", color: "#a78bfa", border: "1px solid rgba(123,47,255,0.25)" }}>
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>person</span>
                    Step 1 of 4
                  </div>
                  <h2 className="text-2xl font-black text-white">What should we call you?</h2>
                  <p className="text-on-surface-variant text-sm mt-1">
                    We&apos;ll personalize your experience
                  </p>
                </div>

                <div className="relative mb-8">
                  <input
                    autoFocus
                    type="text"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && userName.trim() && advanceOnboarding()}
                    placeholder=" "
                    className="block px-4 pb-2.5 pt-6 w-full text-on-surface bg-surface-container-lowest rounded-xl border-0 focus:ring-2 focus:ring-secondary/50 appearance-none peer transition-all duration-300 outline-none text-base"
                  />
                  <label className="absolute text-sm text-on-surface-variant duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] left-4 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-secondary">
                    Your first name
                  </label>
                </div>

                <button
                  onClick={advanceOnboarding}
                  disabled={!userName.trim()}
                  className="w-full py-4 text-white font-bold rounded-xl transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:-translate-y-1 active:scale-[0.98] disabled:hover:translate-y-0"
                  style={{
                    background: "linear-gradient(90deg,#7B2FFF,#00D2FD)",
                    boxShadow: "0 8px 32px rgba(123,47,255,0.3)",
                  }}
                >
                  <span>Continue</span>
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
              </div>
            )}

            {/* ── Step 2: University ────────────────────────────────────── */}
            {onboardingStep === 2 && (
              <div
                className="rounded-3xl p-8 shadow-2xl relative overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(24px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#00D2FD]/40 to-transparent" />

                <div className="mb-8">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4"
                    style={{ background: "rgba(0,210,253,0.12)", color: "#67e8f9", border: "1px solid rgba(0,210,253,0.2)" }}>
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>school</span>
                    Step 2 of 4
                  </div>
                  <h2 className="text-2xl font-black text-white">
                    {userName ? `Hey ${userName}! ` : ""}Where do you study?
                  </h2>
                  <p className="text-on-surface-variant text-sm mt-1">
                    Your university or college
                  </p>
                </div>

                <div className="relative mb-8">
                  <input
                    autoFocus
                    type="text"
                    value={university}
                    onChange={(e) => setUniversity(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && university.trim() && advanceOnboarding()}
                    placeholder=" "
                    className="block px-4 pb-2.5 pt-6 w-full text-on-surface bg-surface-container-lowest rounded-xl border-0 focus:ring-2 focus:ring-secondary/50 appearance-none peer transition-all duration-300 outline-none text-base"
                  />
                  <label className="absolute text-sm text-on-surface-variant duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] left-4 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-secondary">
                    University or College name
                  </label>
                </div>

                <button
                  onClick={advanceOnboarding}
                  disabled={!university.trim()}
                  className="w-full py-4 text-white font-bold rounded-xl transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:-translate-y-1 active:scale-[0.98] disabled:hover:translate-y-0"
                  style={{
                    background: "linear-gradient(90deg,#7B2FFF,#00D2FD)",
                    boxShadow: "0 8px 32px rgba(123,47,255,0.3)",
                  }}
                >
                  <span>Continue</span>
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
              </div>
            )}

            {/* ── Step 3: College ───────────────────────────────────────── */}
            {onboardingStep === 3 && (
              <div
                className="rounded-3xl p-8 shadow-2xl relative overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(24px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#7B2FFF]/40 via-50% to-[#00D2FD]/40 to-transparent" />

                <div className="mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4"
                    style={{ background: "rgba(123,47,255,0.15)", color: "#a78bfa", border: "1px solid rgba(123,47,255,0.25)" }}>
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>domain</span>
                    Step 3 of 4
                  </div>
                  <h2 className="text-2xl font-black text-white">Which faculty are you in?</h2>
                  <p className="text-on-surface-variant text-sm mt-1">
                    Your college or faculty of study
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 mb-6">
                  {COLLEGES.map((col) => {
                    const selected = college === col.id;
                    return (
                      <button
                        key={col.id}
                        onClick={() => setCollege(col.id)}
                        className="cq-level-card flex items-center gap-3 p-3 rounded-xl text-left"
                        style={{
                          background: selected
                            ? "linear-gradient(135deg,rgba(123,47,255,0.28),rgba(0,210,253,0.14))"
                            : "rgba(255,255,255,0.03)",
                          border: selected
                            ? "1px solid rgba(123,47,255,0.5)"
                            : "1px solid rgba(255,255,255,0.08)",
                          transform: selected ? "scale(1.02)" : "scale(1)",
                        }}
                      >
                        <span
                          className="material-symbols-outlined text-xl flex-shrink-0"
                          style={{
                            color: selected ? "#00D2FD" : "rgba(255,255,255,0.35)",
                            fontVariationSettings: "'FILL' 1",
                          }}
                        >
                          {col.icon}
                        </span>
                        <span
                          className="text-sm font-semibold leading-tight"
                          style={{ color: selected ? "#fff" : "rgba(255,255,255,0.55)" }}
                        >
                          {col.label}
                        </span>
                        {selected && (
                          <span
                            className="material-symbols-outlined text-base ml-auto flex-shrink-0"
                            style={{ color: "#00D2FD", fontVariationSettings: "'FILL' 1" }}
                          >
                            check_circle
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={advanceOnboarding}
                  disabled={!college}
                  className="w-full py-4 text-white font-bold rounded-xl transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:-translate-y-1 active:scale-[0.98] disabled:hover:translate-y-0"
                  style={{
                    background: "linear-gradient(90deg,#7B2FFF,#00D2FD)",
                    boxShadow: college ? "0 8px 32px rgba(123,47,255,0.35)" : "none",
                  }}
                >
                  <span>Continue</span>
                  <span className="material-symbols-outlined text-xl">arrow_forward</span>
                </button>
              </div>
            )}

            {/* ── Step 4: Year of study ─────────────────────────────────── */}
            {onboardingStep === 4 && (
              <div
                className="rounded-3xl p-8 shadow-2xl relative overflow-hidden"
                style={{
                  background: "rgba(255,255,255,0.03)",
                  backdropFilter: "blur(24px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#00D2FD]/50 to-transparent" />

                <div className="mb-6">
                  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-4"
                    style={{ background: "rgba(0,210,253,0.12)", color: "#67e8f9", border: "1px solid rgba(0,210,253,0.2)" }}>
                    <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>military_tech</span>
                    Step 4 of 4
                  </div>
                  <h2 className="text-2xl font-black text-white">What year are you in?</h2>
                  <p className="text-on-surface-variant text-sm mt-1">
                    Your current year of study
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-6">
                  {[1, 2, 3, 4, 5, 6].map((yr) => {
                    const selected = yearOfStudy === yr;
                    return (
                      <button
                        key={yr}
                        onClick={() => setYearOfStudy(yr)}
                        className="cq-level-card flex flex-col items-center justify-center gap-1 py-5 rounded-2xl"
                        style={{
                          background: selected
                            ? "linear-gradient(135deg,rgba(123,47,255,0.3),rgba(0,210,253,0.15))"
                            : "rgba(255,255,255,0.03)",
                          border: selected
                            ? "1px solid rgba(0,210,253,0.5)"
                            : "1px solid rgba(255,255,255,0.08)",
                          transform: selected ? "scale(1.05)" : "scale(1)",
                          boxShadow: selected ? "0 0 20px rgba(0,210,253,0.15)" : "none",
                        }}
                      >
                        <span
                          className="text-3xl font-black"
                          style={{
                            background: selected
                              ? "linear-gradient(135deg,#7B2FFF,#00D2FD)"
                              : "rgba(255,255,255,0.3)",
                            WebkitBackgroundClip: "text",
                            WebkitTextFillColor: "transparent",
                          }}
                        >
                          {yr}
                        </span>
                        <span
                          className="text-xs font-medium"
                          style={{ color: selected ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.25)" }}
                        >
                          {yr === 1 ? "1st" : yr === 2 ? "2nd" : yr === 3 ? "3rd" : `${yr}th`} year
                        </span>
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={advanceOnboarding}
                  disabled={yearOfStudy === null}
                  className="w-full py-4 text-white font-bold rounded-xl transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 hover:-translate-y-1 active:scale-[0.98] disabled:hover:translate-y-0"
                  style={{
                    background: "linear-gradient(90deg,#7B2FFF,#00D2FD)",
                    boxShadow: yearOfStudy !== null ? "0 8px 32px rgba(123,47,255,0.4)" : "none",
                  }}
                >
                  {loading ? (
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                  ) : (
                    <span className="material-symbols-outlined text-xl">rocket_launch</span>
                  )}
                  <span>{loading ? "Saving…" : "Start studying"}</span>
                </button>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  // ── Auth page (unchanged) ─────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen text-on-surface overflow-x-hidden" style={{ backgroundColor: "#0d0f1c" }}>
      <div className="grain-overlay" />

      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full" style={{ filter: "blur(80px)", background: "radial-gradient(circle, rgba(123,47,255,0.4) 0%, rgba(0,210,253,0.2) 60%, transparent 100%)" }} />
        <div className="absolute top-[20%] right-[10%] w-64 h-64 bg-primary-container/10 blur-[100px] rounded-full" />
        <div className="absolute bottom-[20%] left-[10%] w-96 h-96 bg-secondary-container/10 blur-[120px] rounded-full" />
      </div>

      <main className="relative min-h-screen flex flex-col items-center justify-center px-6 py-12 z-10">
        {/* Logo */}
        <header className="mb-8 flex flex-col items-center">
          <div className="text-3xl font-black bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent tracking-tighter">
            cortexQ
          </div>
        </header>

        {/* Auth Card */}
        <div className="w-full max-w-md rounded-3xl p-8 shadow-2xl relative overflow-hidden" style={{ background: "rgba(255,255,255,0.03)", backdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.1)" }}>
          {/* Top highlight */}
          <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-secondary/40 to-transparent" />

          {/* Tabs */}
          <nav className="flex border-b border-outline-variant/20 mb-8">
            <button
              onClick={() => switchMode("login")}
              className={`flex-1 py-4 text-sm font-bold tracking-wider relative transition-all ${mode === "login" ? "text-on-surface" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              LOG IN
              {mode === "login" && <span className="absolute bottom-0 left-0 w-full h-1 bg-primary-container rounded-t-full shadow-[0_-4px_12px_rgba(123,47,255,0.6)]" />}
            </button>
            <button
              onClick={() => switchMode("signup")}
              className={`flex-1 py-4 text-sm font-bold tracking-wider relative transition-all ${mode === "signup" ? "text-on-surface" : "text-on-surface-variant hover:text-on-surface"}`}
            >
              SIGN UP
              {mode === "signup" && <span className="absolute bottom-0 left-0 w-full h-1 bg-primary-container rounded-t-full shadow-[0_-4px_12px_rgba(123,47,255,0.6)]" />}
            </button>
          </nav>

          {/* Banners */}
          {success && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm">
              {success}
            </div>
          )}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-error/10 border border-error/20 text-error text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6" noValidate>
            {/* Email */}
            <div className="relative">
              <input
                ref={emailRef}
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder=" "
                className="block px-4 pb-2.5 pt-6 w-full text-sm text-on-surface bg-surface-container-lowest rounded-xl border-0 focus:ring-2 focus:ring-secondary/50 appearance-none peer transition-all duration-300 outline-none"
              />
              <label
                htmlFor="email"
                className="absolute text-sm text-on-surface-variant duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] left-4 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-secondary"
              >
                Email Address
              </label>
            </div>

            {/* Password */}
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder=" "
                className="block px-4 pb-2.5 pt-6 w-full text-sm text-on-surface bg-surface-container-lowest rounded-xl border-0 focus:ring-2 focus:ring-secondary/50 appearance-none peer transition-all duration-300 outline-none pr-12"
              />
              <label
                htmlFor="password"
                className="absolute text-sm text-on-surface-variant duration-300 transform -translate-y-4 scale-75 top-4 z-10 origin-[0] left-4 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-4 peer-focus:text-secondary"
              >
                Password
              </label>
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-white transition-colors"
              >
                <span className="material-symbols-outlined text-xl">{showPassword ? "visibility_off" : "visibility"}</span>
              </button>
            </div>

            {/* Password strength */}
            {mode === "signup" && password && strength && (
              <div className="space-y-1 -mt-2">
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= strength.score ? strength.color : "bg-surface-container-highest"}`} />
                  ))}
                </div>
                <p className={`text-xs ${strength.score <= 1 ? "text-error" : strength.score <= 2 ? "text-orange-400" : strength.score <= 3 ? "text-tertiary" : "text-green-400"}`}>
                  {strength.label}
                </p>
              </div>
            )}

            {/* Remember + Forgot */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <div className="relative">
                  <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} className="sr-only peer" />
                  <div className="w-9 h-5 bg-surface-container-highest peer-checked:bg-primary-container rounded-full transition-colors border border-outline-variant/20" />
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 peer-checked:translate-x-4" />
                </div>
                <span className="text-xs text-on-surface-variant">Remember me</span>
              </label>
              {mode === "login" && (
                <button type="button" onClick={() => setError("Password reset coming soon!")} className="text-xs text-secondary hover:text-on-secondary-fixed transition-colors">
                  Forgot password?
                </button>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 bg-gradient-to-r from-primary-container to-secondary-container text-white font-bold rounded-xl shadow-lg shadow-primary-container/20 hover:shadow-secondary-container/40 hover:-translate-y-1 active:scale-[0.98] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white" />
                  {mode === "login" ? "Signing in…" : "Creating account…"}
                </span>
              ) : mode === "login" ? "Continue" : "Create Account"}
            </button>

            {/* Divider */}
            <div className="relative flex items-center py-2">
              <div className="flex-grow border-t border-outline-variant/15" />
              <span className="flex-shrink mx-4 text-xs font-medium text-on-surface-variant uppercase tracking-widest">or continue with</span>
              <div className="flex-grow border-t border-outline-variant/15" />
            </div>

            {/* Google */}
            <button
              type="button"
              className="w-full flex items-center justify-center gap-3 py-3.5 bg-surface-container-high hover:bg-surface-bright text-on-surface font-medium rounded-xl border border-outline-variant/20 transition-all duration-300 active:scale-[0.98]"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="currentColor" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" />
              </svg>
              <span>Google</span>
            </button>
          </form>

          <div className="mt-6 text-center">
            <button type="button" onClick={() => switchMode(mode === "login" ? "signup" : "login")} className="text-xs text-on-surface-variant hover:text-white transition-colors">
              {mode === "login" ? "Don't have an account? " : "Already have an account? "}
              <span className="text-secondary font-semibold">{mode === "login" ? "Sign up" : "Sign in"}</span>
            </button>
          </div>
        </div>

        {/* Testimonial */}
        <div className="mt-12 max-w-sm text-center">
          <p className="text-on-surface-variant font-medium text-sm leading-relaxed italic opacity-80">
            &ldquo;The most fluid learning interface I&apos;ve ever navigated. It feels like the future of personalized education.&rdquo;
          </p>
          <div className="mt-2 text-primary-fixed-dim font-bold text-xs uppercase tracking-[0.2em]">
            — Elena Vance, PhD
          </div>
        </div>
      </main>
    </div>
  );
}
