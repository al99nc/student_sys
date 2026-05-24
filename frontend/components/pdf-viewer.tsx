"use client";
import { useState, useEffect } from "react";
import { Loader2, AlertTriangle, Download, Maximize2, Minimize2 } from "lucide-react";
import { getToken } from "@/lib/auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

interface PdfViewerProps {
  lectureId: number;
  onLoadSuccess?: (pdf: { numPages: number }) => void;
  onSelect?: () => void;
  directUrl?: string;
}

export function PdfViewer({ lectureId, onLoadSuccess, onSelect, directUrl }: PdfViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let objectUrl = "";
    setLoading(true);
    setLoadError(false);
    setBlobUrl(null);
    const token = getToken();
    const url = directUrl || `${API_URL}/files/${lectureId}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
.then((res) => { if (!res.ok) throw new Error(); return res.arrayBuffer(); })
.then((buffer) => {
  // DEBUG: check first bytes
  const bytes = new Uint8Array(buffer.slice(0, 4));
  const header = String.fromCharCode(...bytes);
  console.log("PDF header:", header, "| size:", buffer.byteLength);
  
  const blob = new Blob([buffer], { type: "application/pdf" });
  objectUrl = URL.createObjectURL(blob);
  setBlobUrl(objectUrl);
  onLoadSuccess?.({ numPages: 0 });
})     .catch(() => setLoadError(true))
      .finally(() => setLoading(false));
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [lectureId, directUrl]);

  if (loadError) {
    return (
      <div className="flex flex-col items-center bg-muted/20 rounded-xl border border-destructive/30 p-6">
        <AlertTriangle className="w-10 h-10 text-destructive/60 mb-3" />
        <p className="font-semibold mb-1">Could not load the PDF</p>
        <p className="text-sm text-muted-foreground text-center max-w-xs">The file may have been moved or deleted.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-muted/20 rounded-xl border border-border/40 overflow-hidden" onMouseUp={onSelect}>
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/10">
        <span className="text-xs text-muted-foreground">PDF document</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setExpanded(!expanded)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          <a href={`${API_URL}/files/${lectureId}?download=1`} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors" download>
            <Download className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
      <div style={{ height: expanded ? "90vh" : "70vh" }} className="transition-all duration-300">
        {loading && (
          <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />Loading PDF…
          </div>
        )}
{blobUrl && (
  <iframe
    src={`${blobUrl}#toolbar=1&view=FitH`}
    className="w-full h-full border-0"
    title="PDF viewer"
    style={{ display: "block" }}
  />
)}      </div>
    </div>
  );
}
