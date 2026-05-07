export const STEPS = [
  { icon: "⚡", text: "recognizing your vibe..." },
  { icon: "📚", text: "syncing your lectures..." },
  { icon: "🧠", text: "warming up the AI..." },
  { icon: "🎯", text: "ur dashboard is ready no cap" },
];

export function WelcomeStyles() {
  return (
    <style>{`
      @keyframes wfloat1 {
        0%,100% { transform:translate(0,0) scale(1); }
        50%      { transform:translate(5%,8%) scale(1.06); }
      }
      @keyframes wfloat2 {
        0%,100% { transform:translate(0,0) scale(1); }
        50%      { transform:translate(-6%,-5%) scale(1.09); }
      }
      @keyframes wfloat3 {
        0%,100% { transform:translate(0,0) scale(1); }
        50%      { transform:translate(4%,6%) scale(0.94); }
      }
      @keyframes wfadeInUp {
        from { opacity:0; transform:translateY(22px); }
        to   { opacity:1; transform:translateY(0); }
      }
      @keyframes wfadeIn {
        from { opacity:0; }
        to   { opacity:1; }
      }
      @keyframes wpopIn {
        0%   { opacity:0; transform:scale(0.78) translateY(10px); }
        60%  { transform:scale(1.06) translateY(-3px); }
        100% { opacity:1; transform:scale(1) translateY(0); }
      }
      @keyframes wshimmer {
        0%   { background-position:-200% center; }
        100% { background-position:200% center; }
      }
      @keyframes wspinStep {
        from { transform:rotate(0deg); }
        to   { transform:rotate(360deg); }
      }
      @keyframes wbounceDot {
        0%,80%,100% { transform:scale(0); opacity:0.3; }
        40%         { transform:scale(1); opacity:1; }
      }
      @keyframes wstepSlide {
        from { opacity:0; transform:translateX(-14px); }
        to   { opacity:1; transform:translateX(0); }
      }
      @keyframes wring {
        0%,100% { transform:scale(1);    opacity:0.5; }
        50%     { transform:scale(1.12); opacity:0.15; }
      }
    `}</style>
  );
}

export function BackgroundOrbs() {
  return (
    <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      <div style={{
        position: "absolute", top: "-25%", left: "-15%",
        width: "65vw", height: "65vw", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.20) 0%, transparent 68%)",
        animation: "wfloat1 9s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", bottom: "-25%", right: "-15%",
        width: "55vw", height: "55vw", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(34,211,238,0.14) 0%, transparent 68%)",
        animation: "wfloat2 11s ease-in-out infinite",
      }} />
      <div style={{
        position: "absolute", top: "35%", right: "15%",
        width: "35vw", height: "35vw", borderRadius: "50%",
        background: "radial-gradient(circle, rgba(244,114,182,0.10) 0%, transparent 68%)",
        animation: "wfloat3 13s ease-in-out infinite",
      }} />
    </div>
  );
}

export function GreetingPhase({ greeting, subLine, hypeLine, phase }: {
  greeting: string;
  subLine: string;
  hypeLine: string;
  phase: number;
}) {
  return (
    <div style={{ animation: "wfadeInUp 0.7s ease forwards" }}>
      <div style={{
        fontSize: "clamp(2rem, 9vw, 3.25rem)",
        fontWeight: 900, lineHeight: 1.1, marginBottom: "1.1rem",
        letterSpacing: "-0.025em", color: "var(--foreground)",
      }}>
        {greeting}
      </div>

      {phase >= 1 && (
        <div style={{ animation: "wfadeInUp 0.55s ease forwards" }}>
          <p style={{
            fontSize: "clamp(0.95rem, 3.5vw, 1.15rem)",
            color: "var(--muted-foreground)",
            lineHeight: 1.65, marginBottom: "0.6rem",
          }}>
            {subLine}
          </p>
          <p style={{
            fontSize: "clamp(1rem, 3.8vw, 1.2rem)",
            fontWeight: 700,
            background: "linear-gradient(90deg, #a78bfa, #38bdf8, #f472b6, #a78bfa)",
            backgroundSize: "200% auto",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            animation: "wshimmer 2.4s linear infinite",
          }}>
            {hypeLine}
          </p>
        </div>
      )}
    </div>
  );
}

export function TransitionPhase() {
  return (
    <div style={{ animation: "wfadeInUp 0.55s ease forwards" }}>
      <div style={{
        fontSize: "clamp(1.5rem, 6vw, 2.2rem)",
        fontWeight: 800, marginBottom: "0.75rem",
        color: "var(--foreground)",
      }}>
        give me a sec... 🫡
      </div>
      <p style={{
        color: "var(--muted-foreground)", fontSize: "0.95rem",
        fontWeight: 500, marginBottom: "1.75rem",
        animation: "wfadeIn 0.6s ease 0.25s both",
      }}>
        loading your data rn bestie
      </p>
      <div style={{ display: "flex", justifyContent: "center", gap: "0.55rem" }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 10, height: 10, borderRadius: "50%",
            background: "var(--primary)",
            animation: `wbounceDot 1.3s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

export function LoadingPhase({ visibleSteps }: { visibleSteps: number }) {
  return (
    <div style={{ width: "100%", animation: "wfadeInUp 0.55s ease forwards" }}>
      <p style={{
        fontSize: "0.8rem", fontWeight: 600,
        color: "var(--muted-foreground)",
        textTransform: "uppercase", letterSpacing: "0.1em",
        marginBottom: "1.25rem",
      }}>
        setting things up for you
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
        {STEPS.slice(0, visibleSteps).map((step, i) => {
          const isLast = i === visibleSteps - 1;
          const isDone = i < visibleSteps - 1;
          return (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: "0.875rem",
                padding: "0.9rem 1.125rem",
                borderRadius: "1rem",
                background: isLast ? "rgba(139,92,246,0.07)" : "var(--card)",
                border: isLast
                  ? "1px solid rgba(139,92,246,0.28)"
                  : "1px solid var(--border)",
                textAlign: "left",
                animation: "wstepSlide 0.4s cubic-bezier(0.34,1.56,0.64,1) forwards",
              }}
            >
              <span style={{ fontSize: "1.2rem", lineHeight: 1, flexShrink: 0 }}>
                {step.icon}
              </span>
              <span style={{
                fontSize: "0.875rem", fontWeight: 600, flex: 1,
                color: isLast ? "var(--foreground)" : "var(--muted-foreground)",
              }}>
                {step.text}
              </span>
              {isDone && (
                <span style={{
                  width: 20, height: 20, borderRadius: "50%",
                  background: "rgba(34,197,94,0.15)",
                  border: "1.5px solid rgba(34,197,94,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, fontSize: "0.65rem",
                  color: "#22c55e", fontWeight: 800,
                  animation: "wpopIn 0.35s ease forwards",
                }}>
                  ✓
                </span>
              )}
              {isLast && (
                <div style={{
                  width: 18, height: 18, borderRadius: "50%",
                  border: "2px solid rgba(139,92,246,0.7)",
                  borderTopColor: "transparent",
                  animation: "wspinStep 0.65s linear infinite",
                  flexShrink: 0,
                }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DonePhase() {
  return (
    <div style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", gap: "0.875rem",
      animation: "wpopIn 0.55s cubic-bezier(0.34,1.56,0.64,1) forwards",
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "2.8rem", position: "relative",
      }}>
        <div style={{
          position: "absolute", inset: -4, borderRadius: "50%",
          border: "1.5px solid rgba(139,92,246,0.4)",
          animation: "wring 1.8s ease-in-out infinite",
        }} />
        🚀
      </div>
      <div style={{
        fontSize: "clamp(1.5rem, 6vw, 2rem)",
        fontWeight: 900, letterSpacing: "-0.025em",
        color: "var(--foreground)",
      }}>
        let&apos;s get it fr fr
      </div>
      <p style={{
        color: "var(--muted-foreground)", fontSize: "0.875rem", fontWeight: 500,
      }}>
        ur dashboard is coming up...
      </p>
    </div>
  );
}
