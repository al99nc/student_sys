"use client";

import { useEffect, useState } from "react";

const MESSAGES = [
  "Please wait...",
  "Almost there...",
  "AI is reading your material...",
  "Crafting your questions...",
  "Adding tricky distractors...",
  "Double-checking answers...",
  "Nearly ready...",
  "Polishing the last question...",
];

type AnimationState = "entering" | "visible" | "exiting";

export function McqLoadingWaiter() {
  const [index, setIndex] = useState(0);
  const [animState, setAnimState] = useState<AnimationState>("entering");

  useEffect(() => {
    let timer: NodeJS.Timeout;

    if (animState === "entering") {
      timer = setTimeout(() => {
        setAnimState("visible");
      }, 320); // Duration of enter animation
    } else if (animState === "visible") {
      timer = setTimeout(() => {
        setAnimState("exiting");
      }, 2200); // Stay visible duration
    } else if (animState === "exiting") {
      timer = setTimeout(() => {
        setIndex((prev) => (prev + 1) % MESSAGES.length);
        setAnimState("entering");
      }, 220); // Duration of exit animation
    }

    return () => clearTimeout(timer);
  }, [animState]);

  return (
    <div className="flex flex-col w-full">
      <style jsx>{`
        @keyframes pulse-dot {
          0%, 100% { transform: scale(1); opacity: 0.4; }
          50% { transform: scale(1.3); opacity: 1; }
        }
        @keyframes progress-fill {
          0% { width: 0%; }
          100% { width: 100%; }
        }
        .animate-pulse-dot {
          animation: pulse-dot 800ms infinite ease-in-out;
        }
        .animate-progress-fill {
          animation: progress-fill 2200ms linear infinite;
        }
        .message-enter {
          animation: message-in 320ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }
        .message-exit {
          animation: message-out 220ms ease-in forwards;
        }
        @keyframes message-in {
          from { transform: translateY(-12px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes message-out {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(12px); opacity: 0; }
        }
      `}</style>

      {/* Dots + Message Container */}
      <div className="flex items-center gap-2 h-5 overflow-hidden relative">
        {/* Pulsing Dots Inline Left */}
        <div className="flex gap-1.5 shrink-0">
          <div className="w-[5px] h-[5px] rounded-full bg-amber-500 animate-pulse-dot" style={{ animationDelay: '0ms' }} />
          <div className="w-[5px] h-[5px] rounded-full bg-amber-500 animate-pulse-dot" style={{ animationDelay: '160ms' }} />
          <div className="w-[5px] h-[5px] rounded-full bg-amber-500 animate-pulse-dot" style={{ animationDelay: '320ms' }} />
        </div>

        {/* Message Text */}
        <div className="flex-1 relative h-full flex items-center">
          <span
            key={index + animState}
            className={`text-[12px] font-medium text-muted-foreground absolute left-0 whitespace-nowrap
              ${animState === 'entering' ? 'message-enter' : ''}
              ${animState === 'exiting' ? 'message-exit' : ''}
              ${animState === 'visible' ? 'opacity-1 transform-none' : ''}
            `}
          >
            {MESSAGES[index]}
          </span>
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="w-full mt-[6px] h-[2px] bg-amber-500/10 rounded-full overflow-hidden">
        {/* Progress Bar Fill */}
        {animState === "visible" && (
          <div 
            className="h-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.35)] animate-progress-fill"
          />
        )}
      </div>
    </div>
  );
}
