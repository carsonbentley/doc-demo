'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Link as LinkIcon, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

type Organization = {
  id: string;
  name: string;
  description: string | null;
  user_id: string;
};

type WorkSectionLink = {
  requirements_chunk_id: string;
  chunk_text: string;
  chunk_index: number;
  requirements_document_id: string;
  metadata?: { section_title?: string };
  similarity: number;
};

type LinkedSection = {
  work_section_id: string;
  section_title: string;
  links: WorkSectionLink[];
};

type InputMode = 'text' | 'pdf';

const API_BASE_URL =
  (process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || 'http://127.0.0.1:8002').replace(/\/$/, '');

export default function OrganizationWorkbenchPage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [requirementsDocId, setRequirementsDocId] = useState<string | null>(null);
  const [workDocumentId, setWorkDocumentId] = useState<string | null>(null);
  const [linkedSections, setLinkedSections] = useState<LinkedSection[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [requirementsTitle, setRequirementsTitle] = useState('DO-160 Requirements');
  const [requirementsText, setRequirementsText] = useState('');
  const [requirementsInputMode, setRequirementsInputMode] = useState<InputMode>('text');
  const [requirementsPdfFile, setRequirementsPdfFile] = useState<File | null>(null);
  const [workTitle, setWorkTitle] = useState('SOW Draft');
  const [workText, setWorkText] = useState('');
  const [workInputMode, setWorkInputMode] = useState<InputMode>('text');
  const [workPdfFile, setWorkPdfFile] = useState<File | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: authData } = await supabase.auth.getUser();
        setUserId(authData.user?.id ?? null);

        if (!authData.user?.id) {
          throw new Error('You must be logged in to access this page.');
        }

        const { data, error: orgError } = await supabase
          .from('organizations')
          .select('id, name, description, user_id')
          .eq('id', organizationId)
          .single();
        if (orgError) throw orgError;
        const org = data as Organization;
        setOrganization(org);
      } catch (e) {
        const errorMessage =
          e instanceof Error
            ? e.message
            : typeof e === 'object'
              ? JSON.stringify(e)
              : 'Failed to load organization.';
        console.error('Organization load failed:', e);
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };
    if (organizationId) void load();
  }, [organizationId, supabase]);

  const ingestRequirements = async (): Promise<string> => {
    if (!userId) throw new Error('You must be signed in.');

    if (requirementsInputMode === 'text' && !requirementsText.trim()) {
      throw new Error('Requirements text is empty.');
    }
    if (requirementsInputMode === 'pdf' && !requirementsPdfFile) {
      throw new Error('Please upload a requirements PDF.');
    }

    let response: Response;
    try {
      if (requirementsInputMode === 'pdf') {
        const formData = new FormData();
        formData.append('organization_id', organizationId);
        formData.append('uploaded_by', userId);
        formData.append('title', requirementsTitle);
        if (requirementsPdfFile) {
          formData.append('file', requirementsPdfFile);
          formData.append('source_name', requirementsPdfFile.name);
        }
        response = await fetch(`${API_BASE_URL}/v1/workbench/requirements/ingest-pdf`, {
          method: 'POST',
          body: formData,
        });
      } else {
        response = await fetch(`${API_BASE_URL}/v1/workbench/requirements/ingest`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organization_id: organizationId,
            uploaded_by: userId,
            title: requirementsTitle,
            raw_text: requirementsText,
            source_type: 'text',
          }),
        });
      }
    } catch {
      throw new Error(
        `Failed to reach backend at ${API_BASE_URL}. Ensure backend is running and NEXT_PUBLIC_AGENT_API_URL is correct.`
      );
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail = payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as { detail?: unknown }).detail)
        : null;
      throw new Error(detail || `Failed to ingest requirements (${response.status})`);
    }
    const payload = await response.json();
    setRequirementsDocId(payload.requirements_document_id);
    return payload.requirements_document_id as string;
  };

  const ingestWorkDocument = async (): Promise<string> => {
    if (!userId) throw new Error('You must be signed in.');
    if (workInputMode === 'text' && !workText.trim()) throw new Error('SOW/template text is empty.');
    if (workInputMode === 'pdf' && !workPdfFile) throw new Error('Please upload a SOW/template PDF.');

    let response: Response;
    if (workInputMode === 'pdf') {
      const formData = new FormData();
      formData.append('organization_id', organizationId);
      formData.append('uploaded_by', userId);
      formData.append('title', workTitle);
      if (workPdfFile) {
        formData.append('file', workPdfFile);
      }
      response = await fetch(`${API_BASE_URL}/v1/workbench/work/ingest-pdf`, {
        method: 'POST',
        body: formData,
      });
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
      const detail = payload && typeof payload === 'object' && 'detail' in payload
        ? String((payload as { detail?: unknown }).detail)
        : null;
      throw new Error(detail || `Failed to ingest work document (${response.status})`);
    }
    const payload = await response.json();
    setWorkDocumentId(payload.work_document_id);
    return payload.work_document_id as string;
  };

  const linkSections = async (workDocIdParam?: string, requirementsDocIdParam?: string) => {
    const activeWorkDocumentId = workDocIdParam ?? workDocumentId;
    const activeRequirementsDocId = requirementsDocIdParam ?? requirementsDocId;
    if (!activeWorkDocumentId) throw new Error('Ingest the SOW/template first.');
    if (!activeRequirementsDocId) throw new Error('Ingest the requirements document first.');
    const response = await fetch(`${API_BASE_URL}/v1/workbench/work/link`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: organizationId,
        work_document_id: activeWorkDocumentId,
        requirements_document_id: activeRequirementsDocId,
        max_links_per_section: 5,
        min_similarity: 0.6,
      }),
    });
    if (!response.ok) {
      throw new Error(`Failed to link sections (${response.status})`);
    }
    const payload = await response.json();
    setLinkedSections(payload.linked_sections || []);
  };

  const runDemoFlow = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const newRequirementsDocId = await ingestRequirements();
      const newWorkDocumentId = await ingestWorkDocument();
      await linkSections(newWorkDocumentId, newRequirementsDocId);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : 'Failed to run demo flow.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="text-center py-10">
        <p className="mb-4">Organization not found.</p>
        <Button onClick={() => router.push('/app')}>Back to dashboard</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" onClick={() => router.push('/app')} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Dashboard
          </Button>
          <h1 className="text-3xl font-bold">{organization.name}</h1>
          <p className="text-gray-600">{organization.description || 'Requirements workbench'}</p>
        </div>
        <Button onClick={runDemoFlow} disabled={submitting}>
          <Upload className="mr-2 h-4 w-4" />
          {submitting ? 'Running Demo...' : 'Run Linking Demo'}
        </Button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>1) Requirements Upload</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={requirementsInputMode === 'text' ? 'default' : 'outline'}
                onClick={() => setRequirementsInputMode('text')}
              >
                Text
              </Button>
              <Button
                type="button"
                variant={requirementsInputMode === 'pdf' ? 'default' : 'outline'}
                onClick={() => setRequirementsInputMode('pdf')}
              >
                PDF
              </Button>
            </div>
            <div className="space-y-1">
              <Label htmlFor="requirementsTitle">Document Title</Label>
              <Input
                id="requirementsTitle"
                value={requirementsTitle}
                onChange={(e) => setRequirementsTitle(e.target.value)}
              />
            </div>
            {requirementsInputMode === 'text' ? (
              <div className="space-y-1">
                <Label htmlFor="requirementsText">Requirements Text</Label>
                <Textarea
                  id="requirementsText"
                  rows={14}
                  value={requirementsText}
                  onChange={(e) => setRequirementsText(e.target.value)}
                  placeholder="Paste requirements corpus content here..."
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="requirementsPdf">Requirements PDF</Label>
                <Input
                  id="requirementsPdf"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setRequirementsPdfFile(e.target.files?.[0] ?? null)}
                />
              </div>
            )}
            {requirementsDocId && (
              <p className="text-xs text-green-700">Requirements ingested: {requirementsDocId}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2) SOW / Template Editor</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
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
              <Label htmlFor="workTitle">Work Document Title</Label>
              <Input id="workTitle" value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} />
            </div>
            {workInputMode === 'text' ? (
              <div className="space-y-1">
                <Label htmlFor="workText">SOW / Template Text</Label>
                <Textarea
                  id="workText"
                  rows={14}
                  value={workText}
                  onChange={(e) => setWorkText(e.target.value)}
                  placeholder="Paste your draft SOW/template here..."
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label htmlFor="workPdf">SOW / Template PDF</Label>
                <Input
                  id="workPdf"
                  type="file"
                  accept="application/pdf"
                  onChange={(e) => setWorkPdfFile(e.target.files?.[0] ?? null)}
                />
              </div>
            )}
            {workDocumentId && <p className="text-xs text-green-700">Work doc ingested: {workDocumentId}</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>3) Linked Requirement Citations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {linkedSections.length === 0 ? (
            <p className="text-sm text-gray-600">
              Run the demo flow to generate section-level citations from your uploaded requirements.
            </p>
          ) : (
            linkedSections.map((section) => (
              <div key={section.work_section_id} className="rounded-md border p-3">
                <h3 className="font-medium">{section.section_title}</h3>
                <div className="mt-2 space-y-2">
                  {section.links.map((link) => (
                    <div key={link.requirements_chunk_id} className="rounded bg-gray-50 p-2 text-xs">
                      <div className="mb-1 flex items-center gap-2">
                        <LinkIcon className="h-3 w-3" />
                        <span>Similarity: {(link.similarity * 100).toFixed(1)}%</span>
                        {link.metadata?.section_title && (
                          <span className="text-gray-500">Source: {link.metadata.section_title}</span>
                        )}
                      </div>
                      <p>{link.chunk_text}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
