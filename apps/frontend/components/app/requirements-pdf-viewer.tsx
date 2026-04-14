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
  highlightAnchors?: Array<{ page?: number | null; snippet?: string | null; summary?: string | null; id: string }>;
  activeAnchorId?: string | null;
  ocrWordBoxes?: Array<{
    page_number: number;
    words: Array<{ text: string; x: number; y: number; width: number; height: number }>;
  }>;
};

type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
  isActive: boolean;
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
  ocrWordBoxes,
}: RequirementsPdfViewerProps) {
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const PAGE_RENDER_WIDTH = 760;
  const [pageNumber, setPageNumber] = useState<number>(1);
  const [numPages, setNumPages] = useState<number>(1);
  const [pageInput, setPageInput] = useState<string>('1');
  const [followFocus, setFollowFocus] = useState<boolean>(true);
  const [resolvedFocusPage, setResolvedFocusPage] = useState<number | null>(null);
  const [bestResolvedScore, setBestResolvedScore] = useState<number>(0);
  const [pdfDoc, setPdfDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [overlayRects, setOverlayRects] = useState<OverlayRect[]>([]);
  const [overlayHeight, setOverlayHeight] = useState<number>(900);
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
    // Always honor a fresh requirement focus click, even after manual page navigation.
    if (!activeAnchorId) return;
    setFollowFocus(true);
    if (focusPage) {
      setResolvedFocusPage(null);
      setPageNumber(focusPage);
      setPageInput(String(focusPage));
    } else if (resolvedFocusPage) {
      setPageNumber(resolvedFocusPage);
      setPageInput(String(resolvedFocusPage));
    }
  }, [activeAnchorId, focusPage, resolvedFocusPage]);

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
      summaryWords: normalizeSnippet(anchor.summary).slice(0, 8),
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

  useEffect(() => {
    let cancelled = false;
    const computeOverlayRects = async () => {
      if (!pdfDoc) return;
      try {
        const page = await pdfDoc.getPage(activePage);
        const viewport = page.getViewport({ scale: 1 });
        const scale = PAGE_RENDER_WIDTH / viewport.width;
        const scaledViewport = page.getViewport({ scale });
        const textContent = await page.getTextContent();
        const items = textContent.items || [];

        const nextRects: OverlayRect[] = [];
        for (const item of items) {
          if (!('str' in item)) continue;
          const str = String(item.str || '');
          const normalized = str.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
          if (!normalized.trim()) continue;

          let matchedAnchorId: string | null = null;
          for (const anchor of anchorTokens) {
            const matched = anchor.words.some((word) => normalized.includes(word));
            if (matched) {
              matchedAnchorId = anchor.id;
              break;
            }
          }
          if (!matchedAnchorId) continue;

          const rawTransform = item.transform || [1, 0, 0, 1, 0, 0];
          // Convert text item transform into viewport coordinates.
          const tx = pdfjs.Util.transform(scaledViewport.transform, rawTransform);
          const x = Number(tx[4] || 0);
          const y = Number(tx[5] || 0);
          const width = Math.max(8, Number(item.width || 0) * scale);
          const height = Math.max(8, Math.abs(Number(tx[3] || tx[0] || 10)));
          const top = y - height;
          const left = x;
          const inBounds =
            left + width >= 0 &&
            top + height >= 0 &&
            left <= scaledViewport.width &&
            top <= scaledViewport.height;
          if (!inBounds) continue;

          nextRects.push({
            left,
            top,
            width,
            height,
            isActive: Boolean(activeAnchorId && matchedAnchorId === activeAnchorId),
          });
        }

        if (nextRects.length === 0) {
          const wordsForPage =
            (ocrWordBoxes || []).find((entry) => entry.page_number === activePage)?.words || [];
          const wordRects: OverlayRect[] = [];
          for (const wordBox of wordsForPage) {
            const normalizedWord = String(wordBox.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!normalizedWord) continue;
            let matchedAnchorId: string | null = null;
            for (const anchor of anchorTokens) {
              const tokenSet = new Set([...anchor.words, ...anchor.summaryWords].map((w) => w.replace(/[^a-z0-9]/g, '')));
              if (tokenSet.has(normalizedWord)) {
                matchedAnchorId = anchor.id;
                break;
              }
            }
            if (!matchedAnchorId) continue;
            wordRects.push({
              left: Number(wordBox.x || 0) * PAGE_RENDER_WIDTH,
              top: Number(wordBox.y || 0) * scaledViewport.height,
              width: Math.max(4, Number(wordBox.width || 0) * PAGE_RENDER_WIDTH),
              height: Math.max(6, Number(wordBox.height || 0) * scaledViewport.height),
              isActive: Boolean(activeAnchorId && matchedAnchorId === activeAnchorId),
            });
          }
          nextRects.push(...wordRects);
          console.info('[PDF_DEBUG] ocr_word_overlay_used', {
            activePage,
            ocrWords: wordsForPage.length,
            rects: wordRects.length,
          });
        }

        if (!cancelled) {
          setOverlayRects(nextRects);
          setOverlayHeight(scaledViewport.height);
          console.info('[PDF_DEBUG] overlay_rects_computed', {
            activePage,
            textItems: items.length,
            rects: nextRects.length,
            activeRects: nextRects.filter((rect) => rect.isActive).length,
            viewport: { width: scaledViewport.width, height: scaledViewport.height },
            sampleRect: nextRects[0] || null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          setOverlayRects([]);
          console.warn('[PDF_DEBUG] overlay_rects_error', String((error as Error)?.message || error));
        }
      }
    };

    void computeOverlayRects();
    return () => {
      cancelled = true;
    };
  }, [pdfDoc, activePage, activeAnchorId, anchorTokens]);

  const applyTextLayerHighlights = () => {
    const root = viewerRef.current;
    if (!root) return;
    const spans = root.querySelectorAll('.react-pdf__Page__textContent span, .react-pdf__Page__textContent [role="presentation"]');
    let highlightCount = 0;
    let activeCount = 0;
    spans.forEach((span) => {
      span.classList.remove('pdf-auto-highlight', 'pdf-active-highlight');
      if (span instanceof HTMLElement) {
        span.style.backgroundColor = '';
        span.style.outline = '';
        span.style.borderRadius = '';
      }
    });
    const spanTexts = Array.from(spans).map((span) =>
      ((span.textContent || '') as string).toLowerCase().replace(/[^a-z0-9\s]/g, ' ')
    );

    // Active mode: highlight the most likely phrase neighborhood.
    if (activeAnchorId) {
      const activeAnchor = anchorTokens.find((a) => a.id === activeAnchorId);
      if (activeAnchor && activeAnchor.words.length > 0) {
        let bestIndex = -1;
        let bestScore = 0;
        for (let i = 0; i < spanTexts.length; i += 1) {
          const text = spanTexts[i];
          if (!text.trim()) continue;
          const sourceMatches = activeAnchor.words.filter((word) => text.includes(word)).length;
          const summaryMatches = activeAnchor.summaryWords.filter((word) => text.includes(word)).length;
          const score = sourceMatches * 3 + summaryMatches;
          if (score > bestScore) {
            bestScore = score;
            bestIndex = i;
          }
        }
        if (bestIndex >= 0 && bestScore > 0) {
          const windowStart = Math.max(0, bestIndex - 8);
          const windowEnd = Math.min(spanTexts.length - 1, bestIndex + 10);
          for (let i = windowStart; i <= windowEnd; i += 1) {
            const span = spans[i];
            if (!span) continue;
            span.classList.add('pdf-auto-highlight');
          }
          const focal = spans[bestIndex];
          if (focal) {
            focal.classList.remove('pdf-auto-highlight');
            focal.classList.add('pdf-active-highlight');
            highlightCount += Math.max(0, windowEnd - windowStart + 1);
            activeCount += 1;
          }
        }
      }
    }

    // Fallback broad mode for non-active states.
    spans.forEach((span, idx) => {
      const text = (span.textContent || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ');
      if (!text.trim()) return;
      if (activeAnchorId && span.classList.contains('pdf-auto-highlight')) return;
      if (activeAnchorId && span.classList.contains('pdf-active-highlight')) return;
      for (const anchor of anchorTokens) {
        if (!anchor.words.length) continue;
        const matched = anchor.words.some((word) => text.includes(word));
        if (!matched) continue;
        if (activeAnchorId && anchor.id === activeAnchorId) {
          span.classList.add('pdf-active-highlight');
          if (span instanceof HTMLElement) {
            span.style.backgroundColor = 'rgba(59, 130, 246, 0.65)';
            span.style.outline = '1px solid rgba(59, 130, 246, 0.9)';
            span.style.borderRadius = '2px';
          }
          highlightCount += 1;
          activeCount += 1;
        } else {
          // Keep non-active global highlighting subtle and sparse.
          span.classList.add('pdf-auto-highlight');
          if (span instanceof HTMLElement) {
            span.style.backgroundColor = 'rgba(250, 204, 21, 0.55)';
            span.style.borderRadius = '2px';
          }
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
                onLoadSuccess={(doc) => {
                  setPdfDoc(doc);
                  const loadedNumPages = doc.numPages;
                  setNumPages(loadedNumPages);
                  setPageNumber((prev) => Math.max(1, Math.min(prev, loadedNumPages)));
                }}
              >
                <div className="relative" style={{ width: PAGE_RENDER_WIDTH, minHeight: overlayHeight }}>
                  <Page
                    key={`page-${activePage}-${activeAnchorId || 'none'}`}
                    pageNumber={activePage}
                    width={PAGE_RENDER_WIDTH}
                    renderTextLayer
                    renderAnnotationLayer
                    onRenderTextLayerSuccess={applyTextLayerHighlights}
                    onRenderTextLayerError={(error) => {
                      const message = String((error as Error)?.message || '');
                      if (message.toLowerCase().includes('textlayer task cancelled')) return;
                      console.error(error);
                    }}
                  />
                  <div className="pointer-events-none absolute inset-0">
                    {overlayRects.map((rect, idx) => (
                      <div
                        // eslint-disable-next-line react/no-array-index-key
                        key={`overlay-${idx}`}
                        className={rect.isActive ? 'pdf-overlay-active' : 'pdf-overlay-auto'}
                        style={{
                          position: 'absolute',
                          left: `${rect.left}px`,
                          top: `${rect.top}px`,
                          width: `${rect.width}px`,
                          height: `${rect.height}px`,
                        }}
                      />
                    ))}
                  </div>
                </div>
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
          background: rgba(250, 204, 21, 0.55) !important;
          border-radius: 2px;
        }
        .pdf-active-highlight {
          background: rgba(59, 130, 246, 0.65) !important;
          border-radius: 2px;
          outline: 1px solid rgba(59, 130, 246, 0.9);
          color: #0f172a !important;
        }
        .pdf-overlay-auto {
          background: rgba(250, 204, 21, 0.35);
          border-radius: 2px;
        }
        .pdf-overlay-active {
          background: rgba(59, 130, 246, 0.45);
          outline: 1px solid rgba(59, 130, 246, 0.9);
          border-radius: 2px;
        }
      `}</style>
    </Card>
  );
}
