"use client";
import { useState, useEffect, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/TextLayer.css";
import "react-pdf/dist/Page/AnnotationLayer.css";
import { Loader2, Maximize2, Minimize2, AlertTriangle, Download } from "lucide-react";
import { getToken } from "@/lib/auth";
import { Button } from "@/components/ui/button";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

interface PdfViewerProps {
  lectureId: number;
  onLoadSuccess?: (pdf: { numPages: number }) => void;
  onSelect?: () => void;
  /** Optionally fetch via the lecture's stored file_path (if already known) */
  directUrl?: string;
}

export function PdfViewer({ lectureId, onLoadSuccess, onSelect, directUrl }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pdfData, setPdfData] = useState<ArrayBuffer | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [fetchRetrying, setFetchRetrying] = useState(false);
  const [containerWidth, setContainerWidth] = useState(800);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const updateWidth = () => {
        // Subtract more for side padding/margins to prevent horizontal scroll
        setContainerWidth(Math.min(1000, window.innerWidth - (window.innerWidth < 640 ? 48 : 120)));
      };
      updateWidth();
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setNumPages(null);
    setPdfData(null);

    const token = getToken();
    const url = directUrl || `${API_URL}/files/${lectureId}`;
    fetch(url, {
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
  }, [lectureId, directUrl]);

  const handleLoadSuccess = useCallback((pdf: { numPages: number }) => {
    setNumPages(pdf.numPages);
    onLoadSuccess?.(pdf);
  }, [onLoadSuccess]);

  const handleLoadError = useCallback(() => {
    setLoadError(true);
  }, []);

  const handleRetry = useCallback(() => {
    setFetchRetrying(true);
    setLoadError(false);
    setPdfData(null);
    const token = getToken();
    fetch(`${API_URL}/files/${lectureId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.arrayBuffer();
      })
      .then((data) => setPdfData(data))
      .catch(() => setLoadError(true))
      .finally(() => setFetchRetrying(false));
  }, [lectureId]);

  if (loadError) {
    return (
      <div
        className="flex flex-col items-center bg-muted/20 rounded-xl border border-destructive/30 p-6"
        onMouseUp={onSelect}
      >
        <AlertTriangle className="w-10 h-10 text-destructive/60 mb-3" />
        <p className="text-foreground font-semibold mb-1">Couldn&apos;t load the PDF</p>
        <p className="text-sm text-muted-foreground text-center max-w-xs mb-4">
          The file may have been moved, deleted, or is still being uploaded.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleRetry} disabled={fetchRetrying}>
            {fetchRetrying ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const showPages = expanded || !loadError;

  return (
    <div
      className="flex flex-col bg-muted/20 rounded-xl border border-border/40 overflow-hidden"
      onMouseUp={onSelect}
    >
      {/* PDF action bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/30 bg-muted/10">
        <span className="text-xs text-muted-foreground">
          {numPages ? `${numPages} page${numPages !== 1 ? "s" : ""}` : "PDF document"}
        </span>
        <div className="flex items-center gap-1">
          {pdfData && (
            <>
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title={expanded ? "Collapse" : "Expand all"}
              >
                {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
              <a
                href={`${API_URL}/files/${lectureId}?download=1`}
                target="_blank"
                rel="noopener noreferrer"
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                title="Download PDF"
                onClick={(e) => e.stopPropagation()}
                download
              >
                <Download className="w-3.5 h-3.5" />
              </a>
            </>
          )}
        </div>
      </div>

      {/* PDF content */}
      <div className={`p-4 bg-muted/5 ${expanded ? "" : "max-h-[800px] overflow-y-auto custom-scrollbar"}`}>
        {!pdfData ? (
          <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            Loading PDF&hellip;
          </div>
        ) : pdfData.byteLength === 0 ? (
          <div className="flex flex-col items-center py-12 text-muted-foreground">
            <p>The PDF file appears to be empty.</p>
          </div>
        ) : (
          <Document
            file={{ data: pdfData }}
            onLoadSuccess={handleLoadSuccess}
            onLoadError={handleLoadError}
            className="max-w-full"
            loading={
              <div className="flex items-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin" />
                Rendering pages&hellip;
              </div>
            }
          >
            {numPages
              ? Array.from(new Array(numPages), (_, i) => (
                  <div key={i} className="mb-4 last:mb-0 shadow-sm border border-border/20 rounded-sm overflow-hidden bg-white">
                    <Page
                      pageNumber={i + 1}
                      width={containerWidth}
                      renderTextLayer={true}
                      renderAnnotationLayer={false}
                      className="max-w-full"
                    />
                  </div>
                ))
              : null}
          </Document>
        )}
      </div>
    </div>
  );
}
