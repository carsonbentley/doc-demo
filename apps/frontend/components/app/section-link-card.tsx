'use client';

import { Link as LinkIcon } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export type SectionLink = {
  requirements_chunk_id: string;
  chunk_text: string;
  chunk_index?: number;
  requirements_document_id?: string;
  similarity: number;
  metadata?: { section_title?: string; source_document_name?: string; source_document_path?: string };
};

type SectionLinkCardProps = {
  sectionTitle: string;
  sectionSourceName?: string;
  sectionContent?: string;
  links: SectionLink[];
};

export function SectionLinkCard({ sectionTitle, sectionSourceName, sectionContent, links }: SectionLinkCardProps) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{sectionTitle}</CardTitle>
        {sectionSourceName ? <p className="text-xs text-gray-600">Source file: {sectionSourceName}</p> : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {sectionContent ? <p className="text-sm text-gray-700">{sectionContent}</p> : null}
        {links.length === 0 ? (
          <p className="text-sm text-gray-500">No linked requirements found for this section.</p>
        ) : (
          links.map((link) => (
            <div key={link.requirements_chunk_id} className="rounded-md border bg-gray-50 p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-1 text-blue-700">
                  <LinkIcon className="h-3 w-3" />
                  {(link.similarity * 100).toFixed(1)}% similarity
                </span>
                {link.metadata?.section_title ? (
                  <span className="rounded-full bg-gray-200 px-2 py-1 text-gray-700">
                    Source: {link.metadata.section_title}
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-gray-800">{link.chunk_text}</p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
