"use client";
import { useState, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Loader2 } from "lucide-react";
import { getToken } from "@/lib/auth";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

interface PdfViewerProps {
  lectureId: number;
  onLoad?: (numPages: number) => void;
  onSelect?: () => void;
}

export function PdfViewer({ lectureId, onLoad, onSelect }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setNumPages(null);
    setPdfData(null);

    const token = getToken();
    fetch(`${API_URL}/files/${lectureId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => {
        if (!cancelled) setPdfData(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => { cancelled = true; };
  }, [lectureId]);

  const handleLoadSuccess = ({ numPages: np }: { numPages: number }) => {
    setNumPages(np);
    onLoad?.(np);
  };

  const handleLoadError = () => {
    setLoadError(true);
  };

  if (loadError) {
    return (
      <div
        className="flex flex-col items-center bg-muted/20 rounded-xl border border-border/40 p-4"
        onMouseUp={onSelect}
      >
        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
          <p>Failed to load PDF. It may have been moved or deleted.</p>
        </div>
      </div>
    );
  }

  if (!pdfData || pdfData.byteLength === 0) {
    return (
      <div
        className="flex flex-col items-center bg-muted/20 rounded-xl border border-border/40 p-4"
        onMouseUp={onSelect}
      >
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          {pdfData?.byteLength === 0 ? (
            <p>The PDF file appears to be empty. Please upload a valid PDF with content.</p>
          ) : (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Loading PDF…
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center bg-muted/20 rounded-xl border border-border/40 p-4"
      onMouseUp={onSelect}
    >
      <Document
        file={{ data: pdfData }}
        onLoadSuccess={handleLoadSuccess}
        onLoadError={handleLoadError}
        className="max-w-full"
        loading={
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading PDF…
          </div>
        }
      >
        {numPages &&
          Array.from(new Array(numPages), (_, i) => (
            <div key={i} className="mb-4 last:mb-0">
              <Page
                pageIndex={i}
                width={Math.min(800, typeof window !== "undefined" ? window.innerWidth - 80 : 800)}
                renderTextLayer
                renderAnnotationLayer={false}
              />
            </div>
          ))}
      </Document>
    </div>
  );
}
