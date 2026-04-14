'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ChevronLeft, ChevronRight, FileSearch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type CitationContext = {
  sectionTitle: string;
  quote: string;
  sourceDocumentName?: string | null;
};

type RequirementsPdfViewerProps = {
  title?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  rawText?: string | null;
  pdfUrl?: string | null;
  focusPage?: number | null;
  focusSnippet?: string | null;
  focusLabel?: string | null;
  linkedCitations?: CitationContext[];
  highlightAnchors?: Array<{ page?: number | null; snippet?: string | null; id: string }>;
  activeAnchorId?: string | null;
};

function normalizeSnippet(snippet?: string | null): string[] {
  if (!snippet) return [];
  return snippet
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 14);
}

export function RequirementsPdfViewer({
  title,
  sourceType,
  sourceName,
  rawText,
  pdfUrl,
  focusPage,
  focusSnippet,
  focusLabel,
  linkedCitations,
  highlightAnchors,
  activeAnchorId,
}: RequirementsPdfViewerProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [numPages, setNumPages] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [followFocus, setFollowFocus] = useState<boolean>(true);
  const [resolvedFocusPage, setResolvedFocusPage] = useState<number | null>(null);
  const [bestResolvedScore, setBestResolvedScore] = useState<number>(0);
  const activePage = Math.max(
    1,
    Math.min(followFocus ? (focusPage || resolvedFocusPage || pageNumber) : pageNumber, numPages)
  );

  useEffect(() => {
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      const message = String(args[0] ?? '');
      if (message.includes('AbortException: TextLayer task cancelled')) return;
      originalError(...args);
    };
    return () => {
      console.error = originalError;
    };
  }, []);

  useEffect(() => {
    if (focusPage) {
      setFollowFocus(true);
      setResolvedFocusPage(null);
      setPageNumber(focusPage);
      setPageInput(String(focusPage));
    }
  }, [focusPage]);

  useEffect(() => {
    if (!focusSnippet) return;
    setFollowFocus(true);
  }, [focusSnippet, activeAnchorId]);

  useEffect(() => {
    let cancelled = false;
    const locateSnippetPage = async () => {
      if (!pdfUrl || !focusSnippet || focusPage) return;
      const words = normalizeSnippet(focusSnippet).slice(0, 6);
      if (!words.length) return;
      try {
        const task = pdfjs.getDocument(pdfUrl);
        const doc = await task.promise;
        let bestPage: number | null = null;
        let bestScore = 0;
        for (let page = 1; page <= doc.numPages; page += 1) {
          const pageObj = await doc.getPage(page);
          const textContent = await pageObj.getTextContent();
          const flattened = textContent.items
            .map((item) => ('str' in item ? String(item.str) : ''))
            .join(' ')
            .toLowerCase();
          const score = words.filter((word) => flattened.includes(word)).length;
          if (score > bestScore) {
            bestScore = score;
            bestPage = page;
          }
        }
        if (!cancelled && bestPage && bestScore > 0) {
          setBestResolvedScore(bestScore);
          setResolvedFocusPage(bestPage);
          setFollowFocus(true);
          setPageNumber(bestPage);
          console.info('[PDF_DEBUG] resolved_focus_page', {
            bestPage,
            bestScore,
            tokenCount: words.length,
          });
        } else if (!cancelled) {
          setBestResolvedScore(bestScore);
          console.info('[PDF_DEBUG] unresolved_focus_page', {
            bestScore,
            tokenCount: words.length,
          });
        }
      } catch (error) {
        // non-blocking; fallback remains snippet panel only
        if (!cancelled) {
          console.warn('[PDF_DEBUG] focus_page_resolution_error', String((error as Error)?.message || error));
        }
      }
    };
    void locateSnippetPage();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, focusSnippet, focusPage]);

  useEffect(() => {
    setPageInput(String(activePage));
  }, [activePage]);

  const pageAnchors = useMemo(() => {
    return (highlightAnchors || []).filter((anchor) => !anchor.page || anchor.page === activePage);
  }, [highlightAnchors, activePage]);

  const anchorTokens = useMemo(() => {
    return pageAnchors.map((anchor) => ({
      id: anchor.id,
      words: normalizeSnippet(anchor.snippet),
    }));
  }, [pageAnchors]);

  useEffect(() => {
    applyTextLayerHighlights();
    // Re-run when anchors/page focus changes, even if PDF page did not remount.
  }, [anchorTokens, activeAnchorId, activePage]);

  const hasActiveMatchOnPage = useMemo(() => {
    if (!activeAnchorId) return true;
    return pageAnchors.some((anchor) => anchor.id === activeAnchorId);
  }, [activeAnchorId, pageAnchors]);

  const goToPage = (value: number) => {
    const next = Math.max(1, Math.min(value, numPages || 1));
    setFollowFocus(false);
    setPageNumber(next);
  };

  const applyTextLayerHighlights = () => {
    const root = viewerRef.current;
    if (!root) return;
    const spans = root.querySelectorAll('.react-pdf__Page__textContent span, .react-pdf__Page__textContent [role="presentation"]');
    let highlightCount = 0;
    let activeCount = 0;
    spans.forEach((span) => {
      span.classList.remove('pdf-auto-highlight', 'pdf-active-highlight');
    });
    spans.forEach((span) => {
      const text = (span.textContent || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ');
      if (!text.trim()) return;
      for (const anchor of anchorTokens) {
        if (!anchor.words.length) continue;
        const matched = anchor.words.some((word) => text.includes(word));
        if (!matched) continue;
        if (activeAnchorId && anchor.id === activeAnchorId) {
          span.classList.add('pdf-active-highlight');
          highlightCount += 1;
          activeCount += 1;
        } else {
          span.classList.add('pdf-auto-highlight');
          highlightCount += 1;
        }
        break;
      }
    });
    console.info('[PDF_DEBUG] highlights_applied', {
      activePage,
      spans: spans.length,
      anchorsOnPage: pageAnchors.length,
      tokenGroups: anchorTokens.length,
      highlightCount,
      activeCount,
      activeAnchorId,
      focusPage,
      resolvedFocusPage,
      bestResolvedScore,
      followFocus,
    });

    const active = root.querySelector('.pdf-active-highlight');
    if (active && active instanceof HTMLElement) {
      active.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">Requirements Document Viewer</CardTitle>
      </CardHeader>
      <CardContent className="flex h-[calc(100dvh-14rem)] flex-col gap-3">
        <div className="text-sm text-gray-600">
          <p>
            <span className="font-medium text-gray-800">Title:</span> {title || 'Untitled'}
          </p>
          <p>
            <span className="font-medium text-gray-800">Source Type:</span> {sourceType || 'unknown'}
          </p>
          {sourceName ? (
            <p>
              <span className="font-medium text-gray-800">Source:</span> {sourceName}
            </p>
          ) : null}
        </div>

        {focusSnippet ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
            <p className="font-semibold">{focusLabel || 'Focused requirement'}</p>
            <p className="line-clamp-3">{focusSnippet}</p>
          </div>
        ) : null}

        {linkedCitations && linkedCitations.length > 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-xs text-emerald-900">
            <p className="font-semibold">Linked evidence in uploaded docs</p>
            <ul className="mt-1 space-y-1">
              {linkedCitations.slice(0, 3).map((citation, index) => (
                <li key={`${citation.sectionTitle}-${index}`}>
                  {citation.sourceDocumentName ? `${citation.sourceDocumentName}: ` : ''}
                  {citation.sectionTitle}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {pdfUrl ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex items-center justify-between rounded-md border bg-gray-50 p-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => goToPage(activePage - 1)}
                disabled={activePage <= 1}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Prev
              </Button>
              <div className="flex items-center gap-2 text-xs text-gray-700">
                <span>Page</span>
                <Input
                  className="h-8 w-16 text-center text-xs"
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={() => goToPage(Number(pageInput))}
                />
                <span>of {numPages}</span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => goToPage(activePage + 1)}
                disabled={activePage >= numPages}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>

            <div ref={viewerRef} className="min-h-0 flex-1 overflow-auto rounded-md border bg-white p-2">
              <Document
                file={pdfUrl}
                onLoadSuccess={({ numPages: loadedNumPages }) => {
                  setNumPages(loadedNumPages);
                  setPageNumber((prev) => Math.max(1, Math.min(prev, loadedNumPages)));
                }}
              >
                <Page
                  key={`page-${activePage}-${activeAnchorId || 'none'}`}
                  pageNumber={activePage}
                  width={760}
                  renderTextLayer
                  renderAnnotationLayer
                  onRenderTextLayerSuccess={applyTextLayerHighlights}
                  onRenderTextLayerError={(error) => {
                    const message = String((error as Error)?.message || '');
                    if (message.toLowerCase().includes('textlayer task cancelled')) return;
                    console.error(error);
                  }}
                />
              </Document>
            </div>
            {!hasActiveMatchOnPage && focusSnippet ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                Could not match the active snippet in this page text layer. Showing page jump + snippet context fallback.
              </div>
            ) : null}
            <p className="text-xs text-gray-500">All mapped requirements for this page are highlighted automatically.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              <div className="flex items-start gap-2">
                <FileSearch className="mt-0.5 h-4 w-4" />
                <p>PDF source is not available for this document yet. Showing indexed text fallback.</p>
              </div>
            </div>
            <Textarea readOnly value={rawText || 'No indexed content yet.'} rows={14} className="font-mono text-xs" />
          </div>
        )}
      </CardContent>
      <style jsx global>{`
        .pdf-auto-highlight {
          background: rgba(250, 204, 21, 0.35);
          border-radius: 2px;
        }
        .pdf-active-highlight {
          background: rgba(59, 130, 246, 0.35);
          border-radius: 2px;
          outline: 1px solid rgba(59, 130, 246, 0.5);
        }
      `}</style>
    </Card>
  );
}
