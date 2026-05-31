"use client";

import React, { useState, useEffect, useRef } from "react";
import { Check, Lock, ChevronDown } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";

const PAID_MODELS = [
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", provider: "google" },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", provider: "google" },
  { id: "deepseek/deepseek-r1", name: "DeepSeek R1", provider: "deepseek" },
  { id: "openai/o4-mini", name: "o4-mini", provider: "openai" },
  { id: "qwen/qwen3-235b-a22b", name: "Qwen3 235B", provider: "qwen" },
];

const PROVIDER_COLORS: Record<string, string> = {
  google: "#4285F4",
  deepseek: "#1A6B6B",
  openai: "#000000",
  qwen: "#FF6A00",
};

interface ModelSelectorProps {
  isPaid: boolean;
  selectedModelId: string;
  onModelChange: (id: string) => void;
  freeModelName?: string;
}

export function ModelSelector({
  isPaid,
  selectedModelId,
  onModelChange,
  freeModelName = "Gemini 1.5 Flash",
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedModel = PAID_MODELS.find((m) => m.id === selectedModelId) || PAID_MODELS[0];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  if (!isPaid) {
    return (
      <Tooltip.Provider>
        <Tooltip.Root delayDuration={0}>
          <Tooltip.Trigger asChild>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted/50 border border-border/40 text-[10px] font-bold text-muted-foreground cursor-default select-none">
              <span>{freeModelName}</span>
              <Lock className="w-3 h-3" />
            </div>
          </Tooltip.Trigger>
          <Tooltip.Portal>
            <Tooltip.Content
              className="z-[100] px-3 py-1.5 rounded-lg bg-popover border border-border shadow-xl text-xs text-popover-foreground animate-in fade-in zoom-in-95 duration-200"
              sideOffset={5}
            >
              Upgrade to Pro to choose your model
              <Tooltip.Arrow className="fill-popover" />
            </Tooltip.Content>
          </Tooltip.Portal>
        </Tooltip.Root>
      </Tooltip.Provider>
    );
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-border/60 hover:border-primary/50 transition-all cursor-pointer select-none"
      >
        <div
          className="w-2 h-2 rounded-[2px]"
          style={{ backgroundColor: PROVIDER_COLORS[selectedModel.provider] }}
        />
        <span className="text-[10px] font-bold text-foreground">
          {selectedModel.name}
        </span>
        <ChevronDown className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown with CSS transition */}
      <div
        className={`absolute top-full left-0 mt-2 w-48 bg-card border border-border/60 rounded-xl shadow-2xl z-50 overflow-hidden transition-all duration-[220ms] origin-top ${
          isOpen 
            ? "max-h-[300px] opacity-100 scale-100 pointer-events-auto ease-out" 
            : "max-h-0 opacity-0 scale-95 pointer-events-none ease-in duration-[180ms]"
        }`}
      >
        <div className="p-1.5 space-y-1">
          {PAID_MODELS.map((model, index) => {
            const isSelected = model.id === selectedModelId;
            return (
              <button
                key={model.id}
                onClick={() => {
                  onModelChange(model.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left hover:bg-muted transition-all group ${
                  isOpen ? "animate-in slide-in-from-top-2 fade-in" : ""
                }`}
                style={{ 
                  animationDelay: `${index * 30}ms`,
                  animationFillMode: 'both'
                }}
              >
                <div
                  className="w-2.5 h-2.5 rounded-[2px] shrink-0"
                  style={{ backgroundColor: PROVIDER_COLORS[model.provider] }}
                />
                <span className={`text-xs flex-1 transition-colors ${isSelected ? "font-bold text-foreground" : "text-muted-foreground group-hover:text-foreground"}`}>
                  {model.name}
                </span>
                {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
