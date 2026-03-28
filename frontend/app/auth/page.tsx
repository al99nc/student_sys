"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { signup, login } from "@/lib/api";
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

  useEffect(() => {
    const savedRemember = localStorage.getItem(REMEMBER_ME_KEY) === "true";
    setRememberMe(savedRemember);
    if (savedRemember) {
      const savedEmail = localStorage.getItem(REMEMBERED_EMAIL_KEY) || "";
      setEmail(savedEmail);
    }
  }, []);

  useEffect(() => {
    emailRef.current?.focus();
  }, [mode]);

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
      } else {
        const res = await login(email, password);
        saveToken(res.data.access_token);
      }
      if (rememberMe) {
        localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
        localStorage.setItem(REMEMBER_ME_KEY, "true");
      } else {
        localStorage.removeItem(REMEMBERED_EMAIL_KEY);
        localStorage.setItem(REMEMBER_ME_KEY, "false");
      }
      router.push("/dashboard");
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

  const strength = mode === "signup" ? getPasswordStrength(password) : null;

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
