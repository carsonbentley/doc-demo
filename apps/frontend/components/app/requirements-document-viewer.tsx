'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';

type RequirementsDocumentViewerProps = {
  title?: string | null;
  sourceType?: string | null;
  sourceName?: string | null;
  rawText?: string | null;
};

export function RequirementsDocumentViewer({
  title,
  sourceType,
  sourceName,
  rawText,
}: RequirementsDocumentViewerProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Indexed Requirements Document</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
        <Textarea
          readOnly
          value={rawText || 'No indexed content yet.'}
          rows={16}
          className="font-mono text-xs"
        />
      </CardContent>
    </Card>
  );
}
