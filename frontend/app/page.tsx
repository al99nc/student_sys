"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Link from "next/link";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    if (isAuthenticated()) {
      router.push("/dashboard");
    }
  }, [router]);

  return (
    <div className="relative min-h-screen text-on-surface overflow-x-hidden" style={{ backgroundColor: "#0D0F1C", backgroundImage: "radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)", backgroundSize: "32px 32px" }}>
      <div className="grain-overlay" />

      {/* Top Nav */}
      <header className="fixed top-0 w-full flex justify-between items-center px-6 py-4 bg-slate-950/80 backdrop-blur-xl z-50 shadow-[0px_8px_24px_rgba(123,47,255,0.15)]">
        <span className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent">cortexQ</span>
        <nav className="hidden md:flex items-center gap-8">
          <a className="text-[#00D2FD] font-bold text-sm" href="#">Home</a>
          <a className="text-slate-400 hover:text-white transition-colors text-sm" href="#">Features</a>
          <a className="text-slate-400 hover:text-white transition-colors text-sm" href="#">Pricing</a>
        </nav>
        <div className="flex items-center gap-4">
          <Link href="/auth" className="text-slate-400 hover:text-white transition-colors font-medium text-sm hidden sm:block">Log In</Link>
          <Link href="/auth" className="synapse-gradient text-white font-bold py-2.5 px-6 rounded-lg text-sm shadow-[0px_8px_24px_rgba(123,47,255,0.15)] hover:-translate-y-1 transition-transform duration-300 active:scale-95">
            + Upload
          </Link>
        </div>
      </header>

      <main className="relative pt-28 sm:pt-32 pb-28 md:pb-24 px-4 sm:px-6 overflow-hidden">
        {/* Hero glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-container/20 rounded-full blur-[120px] -z-10 animate-pulse pointer-events-none" />

        {/* Hero */}
        <section className="max-w-6xl mx-auto text-center mb-32">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-outline-variant/15 glass-panel mb-8">
            <span className="w-2 h-2 rounded-full bg-secondary-container animate-ping" />
            <span className="text-xs font-bold uppercase tracking-widest text-secondary">New: AI Flashcard Engine</span>
          </div>
          <h1 className="text-4xl sm:text-5xl md:text-7xl lg:text-8xl font-black text-white mb-8 leading-[1.1] tracking-tight">
            Turn Your Lectures Into <br />
            <span className="relative inline-block">
              Mastery
              <span className="absolute bottom-2 left-0 w-full h-3 synapse-gradient opacity-60 -z-10 blur-sm" />
              <span className="absolute bottom-0 left-0 w-full h-1 synapse-gradient rounded-full" />
            </span>
          </h1>
          <p className="text-on-surface-variant text-lg md:text-xl max-w-2xl mx-auto mb-12 font-medium">
            Upload recordings, PDFs, or notes. Our cosmic intelligence generates active recall tools so you learn faster and remember longer.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-6">
            <Link href="/auth" className="w-full sm:w-auto synapse-gradient text-white font-bold py-4 px-10 rounded-lg text-lg shadow-[0px_12px_32px_rgba(123,47,255,0.3)] hover:-translate-y-1 transition-transform duration-300">
              Get Started Free
            </Link>
            <button className="w-full sm:w-auto glass-panel border border-outline-variant/15 text-white font-bold py-4 px-10 rounded-lg text-lg flex items-center justify-center gap-2 hover:bg-white/10 transition-colors">
              <span className="material-symbols-outlined">play_circle</span>
              Watch Demo
            </button>
          </div>
        </section>

        {/* Features grid */}
        <section className="max-w-7xl mx-auto mb-32">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { icon: "quiz", color: "primary-container", glow: "rgba(123,47,255,0.3)", title: "AI-Generated MCQs", desc: "Instant multiple-choice questions extracted directly from your course material context." },
              { icon: "auto_awesome", color: "secondary-container", glow: "rgba(0,210,253,0.3)", title: "Smart Summaries", desc: "Condense 2-hour lectures into 10-minute high-yield reading modules with key takeaways." },
              { icon: "style", color: "primary-container", glow: "rgba(123,47,255,0.3)", title: "Flashcard Decks", desc: "Automatic Anki-style decks synced across all your devices for spaced-repetition learning." },
              { icon: "insights", color: "secondary-container", glow: "rgba(0,210,253,0.3)", title: "Progress Analytics", desc: "Visual heatmaps and performance data to identify exactly where you need more focus." },
            ].map((f) => (
              <div key={f.title} className="glass-panel border border-outline-variant/15 p-5 sm:p-8 rounded-xl hover:-translate-y-1 transition-all duration-300 group">
                <div className={`w-12 h-12 rounded-lg bg-${f.color}/20 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform`} style={{ boxShadow: `0 0 20px ${f.glow}` }}>
                  <span className={`material-symbols-outlined text-${f.color === "primary-container" ? "primary" : "secondary"}`}>{f.icon}</span>
                </div>
                <h3 className="text-white font-bold text-xl mb-3">{f.title}</h3>
                <p className="text-on-surface-variant text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Social proof */}
        <section className="max-w-4xl mx-auto text-center mb-32">
          <p className="text-outline uppercase tracking-[0.3em] text-[10px] font-bold mb-10">Trusted by students at</p>
          <div className="flex flex-wrap justify-center items-center gap-12 opacity-40 grayscale">
            {["STANFORD", "MIT", "HARVARD", "OXFORD"].map((u) => (
              <span key={u} className="text-white font-black text-2xl tracking-tighter">{u}</span>
            ))}
          </div>
        </section>

        {/* CTA Banner */}
        <section className="max-w-4xl mx-auto text-center">
          <div className="glass-panel border border-outline-variant/15 rounded-3xl p-8 sm:p-16">
            <h2 className="text-4xl font-black text-white mb-4">Ready to learn smarter?</h2>
            <p className="text-on-surface-variant mb-8 max-w-lg mx-auto">Join thousands of students already using cortexQ to ace their exams.</p>
            <Link href="/auth" className="inline-block synapse-gradient text-white font-bold py-4 px-12 rounded-xl text-lg shadow-[0px_12px_32px_rgba(123,47,255,0.3)] hover:-translate-y-1 transition-transform duration-300">
              Start for Free
            </Link>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="mt-20 py-12 px-6 border-t border-outline-variant/10 text-center">
        <span className="text-2xl font-bold bg-gradient-to-r from-[#7B2FFF] to-[#00D2FD] bg-clip-text text-transparent mb-4 inline-block">cortexQ</span>
        <p className="text-outline text-xs font-medium tracking-wider mb-8">© 2024 CORTEXQ INTELLIGENCE. ALL RIGHTS RESERVED.</p>
        <div className="flex justify-center gap-6 text-slate-400 text-sm">
          <a className="hover:text-white transition-colors" href="#">Privacy</a>
          <a className="hover:text-white transition-colors" href="#">Terms</a>
          <a className="hover:text-white transition-colors" href="#">Twitter</a>
          <a className="hover:text-white transition-colors" href="#">Discord</a>
        </div>
      </footer>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 w-full z-50 flex justify-around items-center py-3 px-4 bg-slate-950/90 backdrop-blur-lg rounded-t-3xl border-t border-white/5">
        <Link href="/" className="flex flex-col items-center text-[#00D2FD]">
          <span className="material-symbols-outlined text-[24px]">home</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Home</span>
        </Link>
        <Link href="/auth" className="flex flex-col items-center text-slate-500">
          <span className="material-symbols-outlined text-[24px]">login</span>
          <span className="text-[10px] uppercase tracking-widest mt-1">Login</span>
        </Link>
      </nav>
    </div>
  );
}
