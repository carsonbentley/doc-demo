'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SectionLinkCard, SectionLink } from '@/components/app/section-link-card';

type HistoryItem = {
  work_document_id: string;
  title: string;
  created_at: string;
  section_count: number;
  link_count: number;
};

type HistoryDetailSection = {
  work_section_id: string;
  section_title: string;
  section_order: number;
  content: string;
  links: SectionLink[];
};

type HistoryDetail = {
  work_document_id: string;
  title: string;
  created_at: string;
  sections: HistoryDetailSection[];
};

type SowRunHistoryListProps = {
  items: HistoryItem[];
  detailById: Record<string, HistoryDetail | undefined>;
  loadingId: string | null;
  onToggle: (workDocumentId: string, expanded: boolean) => void;
};

export function SowRunHistoryList({
  items,
  detailById,
  loadingId,
  onToggle,
}: SowRunHistoryListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-gray-600">
          No SOW uploads yet. Upload one to start building history.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => {
        const isExpanded = expandedId === item.work_document_id;
        const detail = detailById[item.work_document_id];
        return (
          <Card key={item.work_document_id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <Button
                  variant="outline"
                  onClick={() => {
                    const next = !isExpanded;
                    setExpandedId(next ? item.work_document_id : null);
                    onToggle(item.work_document_id, next);
                  }}
                >
                  {isExpanded ? (
                    <ChevronDown className="mr-2 h-4 w-4" />
                  ) : (
                    <ChevronRight className="mr-2 h-4 w-4" />
                  )}
                  {isExpanded ? 'Hide Details' : 'View Details'}
                </Button>
              </div>
              <p className="text-xs text-gray-600">
                {new Date(item.created_at).toLocaleString()} | Sections: {item.section_count} | Links:{' '}
                {item.link_count}
              </p>
            </CardHeader>
            {isExpanded ? (
              <CardContent className="space-y-4">
                {loadingId === item.work_document_id ? (
                  <p className="text-sm text-gray-600">Loading run details...</p>
                ) : detail ? (
                  detail.sections.map((section) => (
                    <SectionLinkCard
                      key={section.work_section_id}
                      sectionTitle={section.section_title}
                      sectionContent={section.content}
                      links={section.links}
                    />
                  ))
                ) : (
                  <p className="text-sm text-gray-600">No details available.</p>
                )}
              </CardContent>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
