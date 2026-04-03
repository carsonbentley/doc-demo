'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { SowRunHistoryList } from '@/components/app/sow-run-history-list';

type HistoryItem = {
  work_document_id: string;
  title: string;
  created_at: string;
  section_count: number;
  link_count: number;
};

type HistoryDetail = {
  work_document_id: string;
  title: string;
  created_at: string;
  sections: Array<{
    work_section_id: string;
    section_title: string;
    section_order: number;
    content: string;
    links: Array<{
      requirements_chunk_id: string;
      chunk_text: string;
      similarity: number;
      metadata?: { section_title?: string };
    }>;
  }>;
};

export default function RequirementDocumentHistoryPage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [detailsById, setDetailsById] = useState<Record<string, HistoryDetail | undefined>>({});

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: authData } = await supabase.auth.getUser();
        if (!authData.user?.id) throw new Error('You must be logged in to access this page.');
        const docsResult = await supabase
          .from('work_documents')
          .select('id, title, created_at')
          .eq('organization_id', organizationId)
          .order('created_at', { ascending: false });
        if (docsResult.error) throw docsResult.error;

        const docs = docsResult.data || [];
        const nextItems: HistoryItem[] = [];
        for (const doc of docs) {
          const sectionsResult = await supabase
            .from('work_sections')
            .select('id')
            .eq('organization_id', organizationId)
            .eq('work_document_id', doc.id);
          if (sectionsResult.error) throw sectionsResult.error;
          const sectionIds = (sectionsResult.data || []).map((section) => section.id);

          let linkCount = 0;
          for (const sectionId of sectionIds) {
            const linksResult = await supabase
              .from('section_requirement_links')
              .select('id', { count: 'exact', head: true })
              .eq('organization_id', organizationId)
              .eq('work_section_id', sectionId);
            if (linksResult.error) throw linksResult.error;
            linkCount += linksResult.count || 0;
          }

          nextItems.push({
            work_document_id: doc.id,
            title: doc.title,
            created_at: doc.created_at,
            section_count: sectionIds.length,
            link_count: linkCount,
          });
        }

        setItems(nextItems);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load history.');
      } finally {
        setLoading(false);
      }
    };
    if (organizationId) void load();
  }, [organizationId, supabase]);

  const handleToggle = async (workDocumentId: string, expanded: boolean) => {
    if (!expanded || detailsById[workDocumentId]) return;
    setLoadingId(workDocumentId);
    try {
      const workDocResult = await supabase
        .from('work_documents')
        .select('id, title, created_at')
        .eq('organization_id', organizationId)
        .eq('id', workDocumentId)
        .single();
      if (workDocResult.error) throw workDocResult.error;

      const sectionsResult = await supabase
        .from('work_sections')
        .select('id, section_title, section_order, content')
        .eq('organization_id', organizationId)
        .eq('work_document_id', workDocumentId)
        .order('section_order', { ascending: true });
      if (sectionsResult.error) throw sectionsResult.error;

      const sections = sectionsResult.data || [];
      const detailSections: HistoryDetail['sections'] = [];
      for (const section of sections) {
        const linksResult = await supabase
          .from('section_requirement_links')
          .select('requirements_chunk_id, similarity')
          .eq('organization_id', organizationId)
          .eq('work_section_id', section.id);
        if (linksResult.error) throw linksResult.error;

        const links = linksResult.data || [];
        const mappedLinks: HistoryDetail['sections'][number]['links'] = [];
        for (const link of links) {
          const chunkResult = await supabase
            .from('requirements_chunks')
            .select('id, chunk_text, metadata')
            .eq('organization_id', organizationId)
            .eq('id', link.requirements_chunk_id)
            .single();
          if (!chunkResult.error && chunkResult.data) {
            mappedLinks.push({
              requirements_chunk_id: chunkResult.data.id,
              chunk_text: chunkResult.data.chunk_text,
              similarity: link.similarity,
              metadata: (chunkResult.data.metadata as { section_title?: string } | undefined) || undefined,
            });
          }
        }

        detailSections.push({
          work_section_id: section.id,
          section_title: section.section_title,
          section_order: section.section_order,
          content: section.content,
          links: mappedLinks.sort((a, b) => b.similarity - a.similarity),
        });
      }

      const payload: HistoryDetail = {
        work_document_id: workDocResult.data.id,
        title: workDocResult.data.title,
        created_at: workDocResult.data.created_at,
        sections: detailSections,
      };
      setDetailsById((prev) => ({ ...prev, [workDocumentId]: payload }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load run detail.');
    } finally {
      setLoadingId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Button variant="ghost" onClick={() => router.push(`/app/organizations/${organizationId}/sow`)} className="mb-2">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to SOW Upload
        </Button>
        <h1 className="text-3xl font-bold">SOW History</h1>
        <p className="text-sm text-gray-600">
          Each item is a saved SOW upload run with expandable linked requirement sections.
        </p>
      </div>

      {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <SowRunHistoryList
        items={items}
        detailById={detailsById}
        loadingId={loadingId}
        onToggle={handleToggle}
      />
    </div>
  );
}
