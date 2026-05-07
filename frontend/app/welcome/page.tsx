"use client";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { getDashboard, getLectures, getMySharedSessions, getNextBestAction, getDailyMission } from "@/lib/api";
import { prefetch } from "@/lib/prefetch-cache";
import {
  WelcomeStyles, BackgroundOrbs,
  GreetingPhase, TransitionPhase, LoadingPhase, DonePhase,
} from "./_phases";

function WelcomeInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [phase, setPhase] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [userName, setUserName] = useState("");
  const [exiting, setExiting] = useState(false);
  const fromTelegram = params.get("from") === "telegram";

  useEffect(() => {
    if (!isAuthenticated()) { router.replace("/auth"); return; }

    const nameParam = params.get("name");
    if (nameParam) {
      setUserName(nameParam);
    } else {
      try {
        const profile = JSON.parse(localStorage.getItem("cortexq_profile") || "{}");
        if (profile.name) setUserName(profile.name);
      } catch {}
    }

    prefetch.dashboard      = getDashboard().catch(() => null);
    prefetch.lectures       = getLectures().catch(() => null);
    prefetch.sharedSessions = getMySharedSessions().catch(() => null);
    prefetch.nextAction     = getNextBestAction().catch(() => null);
    prefetch.dailyMission   = getDailyMission().catch(() => null);

    const timers = [
      setTimeout(() => setPhase(1), 1400),
      setTimeout(() => setPhase(2), 3900),
      setTimeout(() => setPhase(3), 5100),
      setTimeout(() => setVisibleSteps(1), 5500),
      setTimeout(() => setVisibleSteps(2), 6500),
      setTimeout(() => setVisibleSteps(3), 7500),
      setTimeout(() => setVisibleSteps(4), 8500),
      setTimeout(() => setPhase(4), 9100),
      setTimeout(() => setExiting(true), 10100),
      setTimeout(() => router.replace("/dashboard"), 10700),
    ];
    return () => timers.forEach(clearTimeout);
  }, [router, params]);

  const greeting = userName ? `heyyy ${userName} 👋` : "heyyy you 👋";
  const subLine  = fromTelegram ? "you actually used our bot??" : "omg you actually checked us out??";
  const hypeLine = fromTelegram ? "ngl that's kinda iconic 🔥"  : "fr that's so cool, glad you're here 🔥";

  return (
    <>
      <WelcomeStyles />
      <div style={{
        minHeight: "100vh", background: "var(--background)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        position: "relative", overflow: "hidden",
        opacity: exiting ? 0 : 1, transition: "opacity 0.6s ease",
      }}>
        <BackgroundOrbs />

        <div style={{
          position: "relative", zIndex: 10,
          display: "flex", flexDirection: "column", alignItems: "center",
          textAlign: "center", padding: "2rem 1.5rem",
          maxWidth: "460px", width: "100%",
        }}>
          {/* Logo */}
          <div style={{
            fontSize: "1.1rem", fontWeight: 900, letterSpacing: "-0.02em",
            marginBottom: "2.5rem", color: "var(--foreground)",
            animation: "wfadeIn 0.5s ease forwards",
          }}>
            cortex<span style={{ color: "var(--primary)" }}>Q</span>
          </div>

          {phase <= 1 && <GreetingPhase greeting={greeting} subLine={subLine} hypeLine={hypeLine} phase={phase} />}
          {phase === 2 && <TransitionPhase />}
          {phase >= 3 && phase < 4 && <LoadingPhase visibleSteps={visibleSteps} />}
          {phase >= 4 && <DonePhase />}
        </div>
      </div>
    </>
  );
}

export default function WelcomePage() {
  return (
    <Suspense>
      <WelcomeInner />
    </Suspense>
  );
}
