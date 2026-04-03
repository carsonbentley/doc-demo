'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { RequirementsStepProgress } from '@/components/app/requirements-step-progress';
import { RequirementsDocumentViewer } from '@/components/app/requirements-document-viewer';
import { RequirementsStatementsGroups } from '@/components/app/requirements-statements-groups';
import { SowUploadPrimary } from '@/components/app/sow-upload-primary';
import { SectionLinkCard, SectionLink } from '@/components/app/section-link-card';
import {
  clearPendingRequirementsPayload,
  getPendingRequirementsPayload,
} from '@/lib/workflow/pending-requirements';

type InputMode = 'text' | 'pdf';

type RequirementsStatus = {
  indexed: boolean;
  latest_requirements_document_id: string | null;
  latest_title: string | null;
  latest_source_type: string | null;
  latest_source_name: string | null;
  latest_raw_text: string | null;
  chunk_count: number;
};

type LinkedSection = {
  work_section_id: string;
  section_title: string;
  links: SectionLink[];
};

type RequirementStatement = {
  id: string;
  statement_order: number;
  section_title: string;
  modal_verb: string;
  category_label: string;
  statement_text: string;
  note_text?: string | null;
  source_page?: number | null;
};

type RequirementStatementGroup = {
  modal_verb: string;
  category_label: string;
  count: number;
  items: RequirementStatement[];
};

const API_BASE_URL =
  (process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || 'http://127.0.0.1:8002').replace(/\/$/, '');

export default function SowUploadPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const organizationId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<RequirementsStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexingStarted, setIndexingStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workInputMode, setWorkInputMode] = useState<InputMode>('text');
  const [workTitle, setWorkTitle] = useState('SOW Document');
  const [workText, setWorkText] = useState('');
  const [workPdfFile, setWorkPdfFile] = useState<File | null>(null);
  const [linkedSections, setLinkedSections] = useState<LinkedSection[]>([]);
  const [statementGroups, setStatementGroups] = useState<RequirementStatementGroup[]>([]);

  useEffect(() => {
    const loadUser = async () => {
      setLoading(true);
      try {
        const { data: authData } = await supabase.auth.getUser();
        setUserId(authData.user?.id ?? null);
        if (!authData.user?.id) throw new Error('You must be logged in to access this page.');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load SOW page.');
      } finally {
        setLoading(false);
      }
    };

    if (organizationId) void loadUser();
  }, [organizationId, supabase]);

  const pollRequirementsStatus = async () => {
    try {
      const latestDocResult = await supabase
        .from('requirements_documents')
        .select('id, title, source_type, source_name, raw_text, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(1);

      const latest = latestDocResult.data?.[0];
      if (!latest) {
        setStatus({
          indexed: false,
          latest_requirements_document_id: null,
          latest_title: null,
          latest_source_type: null,
          latest_source_name: null,
          latest_raw_text: null,
          chunk_count: 0,
        });
        return false;
      }

      const countResult = await supabase
        .from('requirements_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('requirements_document_id', latest.id);

      const chunkCount = countResult.count || 0;
      const indexed = chunkCount > 0;
      setStatus({
        indexed,
        latest_requirements_document_id: latest.id,
        latest_title: latest.title,
        latest_source_type: latest.source_type,
        latest_source_name: latest.source_name,
        latest_raw_text: latest.raw_text,
        chunk_count: chunkCount,
      });
      return indexed;
    } catch {
      // Silent polling failures keep UX non-blocking.
      return false;
    }
  };

  useEffect(() => {
    if (!organizationId || !userId) return;

    let cancelled = false;
    const tick = async () => {
      const indexed = await pollRequirementsStatus();
      if (cancelled) return;
      if (indexed) setIndexing(false);
    };

    void tick();
    const intervalId = setInterval(() => {
      void tick();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [organizationId, userId]);

  useEffect(() => {
    const shouldAutoIndex = searchParams.get('autoIndex') === '1';
    if (!shouldAutoIndex || !userId || indexingStarted) return;

    const pending = getPendingRequirementsPayload(organizationId);
    if (!pending || pending.uploadedBy !== userId) return;

    setIndexingStarted(true);
    setIndexing(true);
    setError(null);

    const runBackgroundIndexing = async () => {
      try {
        let ok = false;
        if (pending.mode === 'pdf') {
          if (!pending.file) {
            // PDF file cannot survive full refresh. Keep UX non-blocking and ask for re-upload.
            setIndexing(false);
            return;
          }
          const formData = new FormData();
          formData.append('organization_id', organizationId);
          formData.append('uploaded_by', userId);
          formData.append('title', pending.title);
          formData.append('file', pending.file);
          formData.append('source_name', pending.file.name);
          const res = await fetch(`${API_BASE_URL}/v1/workbench/requirements/ingest-pdf`, {
            method: 'POST',
            body: formData,
          });
          ok = res.ok;
        } else {
          const res = await fetch(`${API_BASE_URL}/v1/workbench/requirements/ingest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              organization_id: organizationId,
              uploaded_by: userId,
              title: pending.title,
              raw_text: pending.rawText || '',
              source_type: 'text',
            }),
          });
          ok = res.ok;
        }

        if (ok) {
          clearPendingRequirementsPayload();
        } else {
          setTimeout(() => {
            setIndexingStarted(false);
          }, 3000);
        }
      } catch {
        setTimeout(() => {
          setIndexingStarted(false);
        }, 3000);
      }
    };

    void runBackgroundIndexing();
  }, [searchParams, userId, indexingStarted, organizationId]);

  useEffect(() => {
    const loadStatements = async () => {
      if (!status?.latest_requirements_document_id || !status.indexed) {
        setStatementGroups([]);
        return;
      }
      try {
        const response = await fetch(
          `${API_BASE_URL}/v1/workbench/requirements/${status.latest_requirements_document_id}/statements?organization_id=${organizationId}`
        );
        if (!response.ok) return;
        const payload = await response.json();
        setStatementGroups(payload.groups || []);
      } catch {
        // Keep UI usable even if statements endpoint fails.
      }
    };
    void loadStatements();
  }, [status?.latest_requirements_document_id, status?.indexed, organizationId]);

  const ingestWorkDocument = async (): Promise<string> => {
    if (!userId) throw new Error('You must be signed in.');
    if (workInputMode === 'text' && !workText.trim()) throw new Error('SOW text is empty.');
    if (workInputMode === 'pdf' && !workPdfFile) throw new Error('Please upload a SOW PDF.');

    let response: Response;
    if (workInputMode === 'pdf') {
      const formData = new FormData();
      formData.append('organization_id', organizationId);
      formData.append('uploaded_by', userId);
      formData.append('title', workTitle);
      if (workPdfFile) formData.append('file', workPdfFile);
      response = await fetch(`${API_BASE_URL}/v1/workbench/work/ingest-pdf`, { method: 'POST', body: formData });
    } else {
      response = await fetch(`${API_BASE_URL}/v1/workbench/work/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organization_id: organizationId,
          uploaded_by: userId,
          title: workTitle,
          raw_text: workText,
        }),
      });
    }

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail =
        payload && typeof payload === 'object' && 'detail' in payload
          ? String((payload as { detail?: unknown }).detail)
          : null;
      throw new Error(detail || `Failed to ingest SOW (${response.status})`);
    }
    const payload = await response.json();
    return payload.work_document_id as string;
  };

  const linkSections = async (workDocumentId: string) => {
    if (!status?.latest_requirements_document_id) {
      throw new Error('Requirements document has not been indexed yet.');
    }
    const response = await fetch(`${API_BASE_URL}/v1/workbench/work/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: organizationId,
        work_document_id: workDocumentId,
        requirements_document_id: status.latest_requirements_document_id,
        max_links_per_section: 5,
        min_similarity: 0.6,
      }),
    });
    if (!response.ok) throw new Error(`Failed to link sections (${response.status})`);
    const payload = await response.json();
    setLinkedSections(payload.linked_sections || []);
  };

  const handleUploadAndLink = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const workDocumentId = await ingestWorkDocument();
      await linkSections(workDocumentId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload SOW and link sections.');
    } finally {
      setSubmitting(false);
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
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={() => router.push(`/app/organizations/${organizationId}/requirements`)} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Requirements Setup
          </Button>
          <h1 className="text-3xl font-bold">SOW Upload and Linking</h1>
          <p className="text-sm text-gray-600">Step 2: Upload SOW and generate saved section links.</p>
        </div>
        <Button variant="outline" onClick={() => router.push(`/app/organizations/${organizationId}/history`)}>
          View History
        </Button>
      </div>

      <RequirementsStepProgress indexed={Boolean(status?.indexed)} currentStep={2} indexing={indexing} />
      {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <RequirementsDocumentViewer
            title={status?.latest_title}
            sourceType={status?.latest_source_type}
            sourceName={status?.latest_source_name}
            rawText={status?.latest_raw_text}
          />
          {status?.indexed ? (
            <RequirementsStatementsGroups groups={statementGroups} />
          ) : (
            <Card>
              <CardContent className="py-6 text-sm text-gray-600">
                Requirements statements will appear here after indexing completes.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <SowUploadPrimary hasSow={linkedSections.length > 0} />
          <Card>
            <CardHeader>
              <CardTitle>SOW Source</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={workInputMode === 'text' ? 'default' : 'outline'}
                  onClick={() => setWorkInputMode('text')}
                >
                  Text
                </Button>
                <Button
                  type="button"
                  variant={workInputMode === 'pdf' ? 'default' : 'outline'}
                  onClick={() => setWorkInputMode('pdf')}
                >
                  PDF
                </Button>
              </div>
              <div className="space-y-1">
                <Label htmlFor="workTitle">SOW Title</Label>
                <Input id="workTitle" value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} />
              </div>
              {workInputMode === 'text' ? (
                <div className="space-y-1">
                  <Label htmlFor="workText">SOW Text</Label>
                  <Textarea
                    id="workText"
                    rows={14}
                    value={workText}
                    onChange={(e) => setWorkText(e.target.value)}
                    placeholder="Paste your SOW content here..."
                  />
                </div>
              ) : (
                <div className="space-y-1">
                  <Label htmlFor="workPdf">SOW PDF</Label>
                  <Input
                    id="workPdf"
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setWorkPdfFile(e.target.files?.[0] ?? null)}
                  />
                </div>
              )}
              <Button
                className="w-full"
                onClick={handleUploadAndLink}
                disabled={submitting || !status?.indexed || indexing}
              >
                {submitting ? 'Uploading and Linking...' : 'Upload SOW and Generate Links'}
              </Button>
              {indexing ? (
                <p className="text-xs text-blue-700">
                  Requirements are still indexing in the background. You can prepare your SOW now.
                </p>
              ) : !status?.indexed ? (
                <p className="text-xs text-amber-700">Requirements indexing has not completed yet.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {linkedSections.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Linked Requirement Citations</h2>
          {linkedSections.map((section) => (
            <SectionLinkCard key={section.work_section_id} sectionTitle={section.section_title} links={section.links} />
          ))}
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            SOW upload and linking saved. You can review this run in History.
          </div>
        </div>
      ) : null}
    </div>
  );
}
