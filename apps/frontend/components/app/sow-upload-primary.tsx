'use client';

import { UploadCloud } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

type SowUploadPrimaryProps = {
  hasSow: boolean;
};

export function SowUploadPrimary({ hasSow }: SowUploadPrimaryProps) {
  if (hasSow) return null;

  return (
    <Card className="border-blue-200 bg-blue-50">
      <CardContent className="py-8 text-center">
        <UploadCloud className="mx-auto mb-3 h-10 w-10 text-blue-600" />
        <h2 className="text-lg font-semibold text-blue-900">Upload Your SOW to Continue</h2>
        <p className="mt-1 text-sm text-blue-700">
          SOW upload is the primary step here. Once uploaded, we will generate saved section links.
        </p>
      </CardContent>
    </Card>
  );
}
