"use client";
import { useEffect } from "react";

export function MaterialSymbolsFont() {
  useEffect(() => {
    const existing = document.querySelector(
      'link[href*="Material+Symbols+Outlined"]'
    );
    if (existing) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap";
    document.head.appendChild(link);
  }, []);
  return null;
}
