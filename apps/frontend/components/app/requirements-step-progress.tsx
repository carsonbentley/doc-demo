'use client';

import { useMemo } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';

type RequirementsStepProgressProps = {
  indexed: boolean;
  currentStep: 1 | 2;
  indexing?: boolean;
  chunkCount?: number;
  chunkTotal?: number;
  statementCount?: number;
  statementCandidatesTotal?: number;
};

function computeIngestPercent(params: {
  indexed: boolean;
  chunkCount: number;
  chunkTotal?: number;
  statementCount: number;
  statementCandidatesTotal?: number;
}): number {
  if (params.indexed) return 100;
  const ct = params.chunkTotal ?? 0;
  const stTotal = params.statementCandidatesTotal ?? 0;
  const chunkPct = ct > 0 ? Math.min(100, (params.chunkCount / ct) * 100) : 0;
  const stmtPct = stTotal > 0 ? Math.min(100, (params.statementCount / stTotal) * 100) : 0;
  if (ct > 0 && stTotal > 0) return Math.round((chunkPct + stmtPct) / 2);
  if (ct > 0) return Math.round(chunkPct);
  if (stTotal > 0) return Math.round(stmtPct);
  return 0;
}

export function RequirementsStepProgress({
  indexed,
  currentStep,
  indexing = false,
  chunkCount = 0,
  chunkTotal,
  statementCount = 0,
  statementCandidatesTotal,
}: RequirementsStepProgressProps) {
  const stepOneComplete = indexed;
  const stepTwoActive = currentStep === 2;

  const percent = useMemo(
    () =>
      computeIngestPercent({
        indexed,
        chunkCount,
        chunkTotal,
        statementCount,
        statementCandidatesTotal,
      }),
    [indexed, chunkCount, chunkTotal, statementCount, statementCandidatesTotal]
  );

  const hasTotals = (chunkTotal ?? 0) > 0 || (statementCandidatesTotal ?? 0) > 0;
  const showIndeterminate = indexing && !indexed && !hasTotals;
  const showBar = indexing && !indexed;

  const ariaLabel = useMemo(() => {
    if (!showBar) return undefined;
    const parts: string[] = [];
    if ((chunkTotal ?? 0) > 0) {
      parts.push(`${chunkCount} of ${chunkTotal} chunks stored`);
    } else if (chunkCount > 0) {
      parts.push(`${chunkCount} chunks stored`);
    }
    if ((statementCandidatesTotal ?? 0) > 0) {
      parts.push(`${statementCount} of ${statementCandidatesTotal} requirements distilled`);
    } else if (statementCount > 0) {
      parts.push(`${statementCount} requirements distilled`);
    }
    if (parts.length === 0) parts.push('Processing requirements');
    return `${parts.join(', ')}. ${percent}% complete.`;
  }, [
    showBar,
    chunkCount,
    chunkTotal,
    statementCount,
    statementCandidatesTotal,
    percent,
  ]);

  return (
    <div className="rounded-lg border bg-white p-4">
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          {stepOneComplete ? (
            <CheckCircle2 className="h-4 w-4 text-green-600" />
          ) : (
            <Circle className="h-4 w-4 text-gray-400" />
          )}
          <span className={stepOneComplete ? 'font-medium text-green-700' : 'text-gray-600'}>
            1. Requirements Indexed
          </span>
        </div>
        <div className="h-px flex-1 bg-gray-200" />
        <div className="flex items-center gap-2">
          {stepTwoActive ? (
            <CheckCircle2 className="h-4 w-4 text-blue-600" />
          ) : (
            <Circle className="h-4 w-4 text-gray-400" />
          )}
          <span className={stepTwoActive ? 'font-medium text-blue-700' : 'text-gray-600'}>
            2. SOW Upload and Linking
          </span>
        </div>
      </div>
      {showBar ? (
        <div className="mt-3 space-y-2">
          <div
            className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200"
            role="progressbar"
            {...(showIndeterminate
              ? {}
              : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': percent })}
            aria-busy={showIndeterminate}
            aria-label={ariaLabel}
          >
            {showIndeterminate ? (
              <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 motion-safe:animate-req-progress-shimmer" />
            ) : (
              <div
                className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-600 transition-[width] duration-500 ease-out"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
