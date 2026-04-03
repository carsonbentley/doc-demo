'use client';

import { CheckCircle2, Circle } from 'lucide-react';

type RequirementsStepProgressProps = {
  indexed: boolean;
  currentStep: 1 | 2;
  indexing?: boolean;
};

export function RequirementsStepProgress({
  indexed,
  currentStep,
  indexing = false,
}: RequirementsStepProgressProps) {
  const stepOneComplete = indexed;
  const stepTwoActive = currentStep === 2;

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
      {indexing && !indexed ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-blue-700">Indexing requirements document...</p>
          <div className="h-2 w-full overflow-hidden rounded-full bg-blue-100">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-blue-500" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
