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

type TextRange = { start: number; end: number };

function normalizeSnippet(snippet?: string | null): string[] {
  if (!snippet) return [];
  return snippet
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2)
    .slice(0, 14);
}

function normalizePhrase(text?: string | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildRanges(parts: string[]): { joined: string; ranges: TextRange[] } {
  const ranges: TextRange[] = [];
  let cursor = 0;
  const joinedParts: string[] = [];
  for (const part of parts) {
    const value = normalizePhrase(part);
    joinedParts.push(value);
    const start = cursor;
    const end = start + value.length;
    ranges.push({ start, end });
    cursor = end + 1;
  }
  return { joined: joinedParts.join(' '), ranges };
}

/**
 * Map the full source quote onto `joined` (normalized per-part text with single spaces).
 * Prefer exact substring, then whitespace-tolerant scan, then prefix probe + extend to full phrase.
 * No artificial length cap — highlights should cover the same text as the Source quote field.
 */
function findMatchingRange(joined: string, phrase: string): TextRange | null {
  if (!joined || !phrase) return null;
  const p = normalizePhrase(phrase);
  if (!p) return null;

  const directIdx = joined.indexOf(p);
  if (directIdx >= 0) return { start: directIdx, end: directIdx + p.length };

  const lenJ = joined.length;
  const lenP = p.length;
  let best: TextRange | null = null;
  let bestPi = 0;

  for (let s = 0; s < lenJ; s += 1) {
    if (p[0] !== joined[s]) continue;
    let pi = 0;
    let ji = s;
    while (pi < lenP && ji < lenJ) {
      const cpc = p[pi];
      const cjc = joined[ji];
      if (cpc === cjc) {
        pi += 1;
        ji += 1;
      } else if (cjc === ' ' && cpc !== ' ') {
        ji += 1;
      } else if (cpc === ' ' && cjc !== ' ') {
        pi += 1;
      } else {
        break;
      }
    }
    if (pi > bestPi) {
      bestPi = pi;
      best = { start: s, end: ji };
    }
  }

  const threshold = Math.max(12, Math.floor(lenP * 0.45));
  if (best && bestPi >= threshold) return best;

  const words = p.split(' ').filter(Boolean);
  if (words.length >= 4) {
    const probeN = Math.min(10, words.length);
    const probe = words.slice(0, probeN).join(' ');
    const probeIdx = joined.indexOf(probe);
    if (probeIdx >= 0) {
      let pi = 0;
      let ji = probeIdx;
      while (pi < lenP && ji < lenJ) {
        const cpc = p[pi];
        const cjc = joined[ji];
        if (cpc === cjc) {
          pi += 1;
          ji += 1;
        } else if (cjc === ' ' && cpc !== ' ') {
          ji += 1;
        } else if (cpc === ' ' && cjc !== ' ') {
          pi += 1;
        } else {
          break;
        }
      }
      if (pi >= threshold) return { start: probeIdx, end: ji };
    }
  }

  return best && bestPi >= 8 ? best : null;
}

export function RequirementsPdfViewer({
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
  const widthMeasureRef = useRef<HTMLDivElement | null>(null);
  const [renderWidth, setRenderWidth] = useState(720);
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
    const el = widthMeasureRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w >= 200) setRenderWidth(Math.floor(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pdfUrl]);

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

  const activePageAnchors = useMemo(() => {
    if (!activeAnchorId) return [];
    return pageAnchors.filter((anchor) => anchor.id === activeAnchorId);
  }, [pageAnchors, activeAnchorId]);

  const anchorTokens = useMemo(() => {
    return activePageAnchors.map((anchor) => ({
      id: anchor.id,
      words: normalizeSnippet(anchor.snippet),
      summaryWords: normalizeSnippet(anchor.summary).slice(0, 8),
    }));
  }, [activePageAnchors]);

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
        const scale = renderWidth / viewport.width;
        const scaledViewport = page.getViewport({ scale });
        const textContent = await page.getTextContent();
        const items = textContent.items || [];

        const nextRects: OverlayRect[] = [];
        const textItems = (items as Array<Record<string, unknown>>).filter(
          (item) => typeof item.str === 'string' && Array.isArray(item.transform) && typeof item.width === 'number'
        );
        const itemStrings = textItems.map((item) => String(item.str || ''));
        const { joined: pageJoined, ranges: pageRanges } = buildRanges(itemStrings);
        const activePhrase = normalizePhrase(activePageAnchors[0]?.snippet || focusSnippet || '');
        const phraseWindow = findMatchingRange(pageJoined, activePhrase);

        if (activeAnchorId && phraseWindow) {
          for (let i = 0; i < textItems.length; i += 1) {
            const item = textItems[i];
            const charRange = pageRanges[i];
            const intersects =
              charRange.end >= phraseWindow.start &&
              charRange.start <= phraseWindow.end;
            if (!intersects) continue;
            const rawTransform = (item.transform as number[]) || [1, 0, 0, 1, 0, 0];
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
              isActive: true,
            });
          }
        }

        if (activeAnchorId && nextRects.length === 0) {
          const wordsForPage =
            (ocrWordBoxes || []).find((entry) => entry.page_number === activePage)?.words || [];
          const { joined: ocrJoined, ranges: ocrRanges } = buildRanges(wordsForPage.map((w) => String(w.text || '')));
          const ocrPhraseWindow = findMatchingRange(ocrJoined, activePhrase);
          const wordRects: OverlayRect[] = [];
          for (let i = 0; i < wordsForPage.length; i += 1) {
            const wordBox = wordsForPage[i];
            const charRange = ocrRanges[i];
            const intersects = Boolean(
              ocrPhraseWindow &&
                charRange.end >= ocrPhraseWindow.start &&
                charRange.start <= ocrPhraseWindow.end
            );
            if (!intersects) continue;
            wordRects.push({
              left: Number(wordBox.x || 0) * renderWidth,
              top: Number(wordBox.y || 0) * scaledViewport.height,
              width: Math.max(4, Number(wordBox.width || 0) * renderWidth),
              height: Math.max(6, Number(wordBox.height || 0) * scaledViewport.height),
              isActive: true,
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
  }, [pdfDoc, activePage, activeAnchorId, activePageAnchors, focusSnippet, ocrWordBoxes, renderWidth]);

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
        span.style.textDecoration = '';
        span.style.textDecorationLine = '';
        span.style.textDecorationColor = '';
        span.style.textDecorationThickness = '';
      }
    });
    const spanTexts = Array.from(spans).map((span) => ((span.textContent || '') as string));
    const { joined: spansJoined, ranges: spanRanges } = buildRanges(spanTexts);

    // Active mode: highlight only the contiguous phrase region for selected requirement.
    if (activeAnchorId) {
      const phrase = normalizePhrase(activePageAnchors[0]?.snippet || focusSnippet || '');
      const phraseWindow = findMatchingRange(spansJoined, phrase);
      if (phraseWindow) {
        for (let i = 0; i < spans.length; i += 1) {
          const charRange = spanRanges[i];
          const intersects = charRange.end >= phraseWindow.start && charRange.start <= phraseWindow.end;
          if (!intersects) continue;
          const span = spans[i];
          span.classList.add('pdf-active-highlight');
          highlightCount += 1;
          activeCount += 1;
        }
      }
    }

    // No broad fallback highlighting: only selected requirement should be highlighted.
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
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader className="shrink-0 space-y-0 py-3">
        <CardTitle className="text-sm font-semibold text-gray-900">Document</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3 pt-0 sm:px-4 sm:pb-4">
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

            <div ref={viewerRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto rounded-md border bg-white p-2">
              <Document
                file={pdfUrl}
                onLoadSuccess={(doc) => {
                  setPdfDoc(doc);
                  const loadedNumPages = doc.numPages;
                  setNumPages(loadedNumPages);
                  setPageNumber((prev) => Math.max(1, Math.min(prev, loadedNumPages)));
                }}
              >
                <div ref={widthMeasureRef} className="relative w-full min-w-0" style={{ minHeight: overlayHeight }}>
                  <Page
                    key={`page-${activePage}-${activeAnchorId || 'none'}-${renderWidth}`}
                    pageNumber={activePage}
                    width={renderWidth}
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
                        key={`overlay-${idx}`}
                        className={rect.isActive ? 'pdf-overlay-highlight-active' : 'pdf-overlay-highlight'}
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
            <p className="text-xs text-gray-500">
              {activeAnchorId ? 'Showing highlight for selected requirement.' : 'Select "View in document" to highlight only that requirement.'}
            </p>
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
        /* Light translucent yellow — reads like a physical highlighter, full span/word height */
        .pdf-auto-highlight,
        .pdf-active-highlight {
          background: rgba(254, 240, 138, 0.52) !important;
          outline: none !important;
          box-shadow: none !important;
          color: inherit !important;
          border-radius: 2px !important;
          box-decoration-break: clone !important;
          -webkit-box-decoration-break: clone !important;
        }
        .pdf-overlay-highlight,
        .pdf-overlay-highlight-active {
          background: rgba(254, 240, 138, 0.48);
          border-radius: 2px;
          mix-blend-mode: multiply;
        }
        .pdf-overlay-highlight {
          opacity: 0.92;
        }
        .pdf-overlay-highlight-active {
          opacity: 1;
        }
      `}</style>
    </Card>
  );
}
