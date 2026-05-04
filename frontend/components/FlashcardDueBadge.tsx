"use client";
import { useEffect, useState } from "react";
import { getDueFlashcards } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";

interface Props {
  documentId?: number;
  className?: string;
}

export function FlashcardDueBadge({ documentId, className }: Props) {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    getDueFlashcards(documentId, 50)
      .then((res) => setCount(res.data.due_count))
      .catch(() => setCount(null));
  }, [documentId]);

  if (count === null || count === 0) return null;

  return (
    <Badge
      variant="secondary"
      className={`flex items-center gap-1 bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs ${className ?? ""}`}
    >
      <BookOpen className="w-3 h-3" />
      {count} card{count !== 1 ? "s" : ""} due
    </Badge>
  );
}
