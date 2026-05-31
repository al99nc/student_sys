"use client";

import React, { useState, useEffect } from "react";

const MESSAGES = [
  "Almost there",
  "Reading pages",
  "Building questions",
  "Checking answers",
  "Adding options",
  "Nearly done",
  "Verifying",
  "Finalizing",
];

type Status = "generating" | "queued" | "timeout_soft" | "timeout_hard";

interface McqGeneratingLabelProps {
  status: Status;
}

export function McqGeneratingLabel({ status }: McqGeneratingLabelProps) {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * MESSAGES.length));
  const [opacity, setOpacity] = useState(1);

  useEffect(() => {
    if (status !== "generating") return;

    let timer: NodeJS.Timeout;
    
    const transition = () => {
      // Fade out
      setOpacity(0);
      
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % MESSAGES.length);
        setOpacity(1);
        
        // Schedule next transition with random duration
        const duration = Math.floor(Math.random() * (3200 - 1800 + 1)) + 1800;
        timer = setTimeout(transition, duration);
      }, 200); // duration of fade-out
    };

    const initialDuration = Math.floor(Math.random() * (3200 - 1800 + 1)) + 1800;
    timer = setTimeout(transition, initialDuration);

    return () => clearTimeout(timer);
  }, [status]);

  if (status === "queued") {
    return null; // Parent handles "In Queue" pill below title
  }

  let text = MESSAGES[index];
  let colorClass = "text-muted-foreground";

  if (status === "timeout_soft") {
    text = "Taking longer than usual...";
    colorClass = "text-amber-500/80";
  } else if (status === "timeout_hard") {
    text = "Still working... check back soon";
    colorClass = "text-amber-600/70";
  }

  return (
    <div className={`min-w-[120px] text-right text-[11px] font-normal italic transition-opacity duration-200 ${colorClass}`} style={{ opacity }}>
      {text}
    </div>
  );
}
