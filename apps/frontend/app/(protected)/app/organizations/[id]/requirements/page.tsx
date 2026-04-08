'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { RequirementsStepProgress } from '@/components/app/requirements-step-progress';
import { clearPendingRequirementsPayload } from '@/lib/workflow/pending-requirements';

type Organization = {
  id: string;
  name: string;
  description: string | null;
};

type InputMode = 'text' | 'pdf';

type ExistingRequirementsSummary = {
  id: string;
  title: string;
  source_type: string | null;
  source_name: string | null;
};

const API_BASE_URL =
  (process.env.NEXT_PUBLIC_AGENT_API_URL?.trim() || 'http://127.0.0.1:8002').replace(/\/$/, '');

export default function RequirementsSetupPage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [requirementsTitle, setRequirementsTitle] = useState('Requirements Document');
  const [requirementsText, setRequirementsText] = useState('');
  const [requirementsInputMode, setRequirementsInputMode] = useState<InputMode>('text');
  const [requirementsPdfFile, setRequirementsPdfFile] = useState<File | null>(null);

  const [existingRequirements, setExistingRequirements] = useState<ExistingRequirementsSummary | null>(null);
  const [requirementsIndexed, setRequirementsIndexed] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [chunkTotal, setChunkTotal] = useState<number | undefined>(undefined);
  const [statementCount, setStatementCount] = useState(0);
  const [statementCandidatesTotal, setStatementCandidatesTotal] = useState<number | undefined>(undefined);

  const refreshExistingRequirements = useCallback(async () => {
    const latestDocResult = await supabase
      .from('requirements_documents')
      .select('id, title, source_type, source_name, metadata')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(1);

    const latest = latestDocResult.data?.[0];
    if (!latest) {
      setExistingRequirements(null);
      setRequirementsIndexed(false);
      setChunkCount(0);
      setChunkTotal(undefined);
      setStatementCount(0);
      setStatementCandidatesTotal(undefined);
      return;
    }

    const metadata =
      (latest.metadata as {
        processing_status?: string;
        chunk_total?: number;
        statement_count?: number;
        statement_candidates_total?: number;
      } | null) ?? null;

    const countResult = await supabase
      .from('requirements_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('requirements_document_id', latest.id);

    const chunks = countResult.count || 0;
    const proc = metadata?.processing_status ?? null;
    const indexed =
      proc === 'indexed' ? true : proc === 'indexing' || proc === 'distilling' ? false : chunks > 0;

    setExistingRequirements({
      id: latest.id,
      title: latest.title,
      source_type: latest.source_type,
      source_name: latest.source_name,
    });
    setRequirementsIndexed(indexed);
    setChunkCount(chunks);
    setChunkTotal(metadata?.chunk_total);
    setStatementCount(metadata?.statement_count ?? 0);
    setStatementCandidatesTotal(metadata?.statement_candidates_total);
  }, [organizationId, supabase]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: authData } = await supabase.auth.getUser();
        setUserId(authData.user?.id ?? null);
        if (!authData.user?.id) throw new Error('You must be logged in to access this page.');

        const { data, error: orgError } = await supabase
          .from('organizations')
          .select('id, name, description')
          .eq('id', organizationId)
          .single();
        if (orgError) throw orgError;
        setOrganization(data as Organization);

        await refreshExistingRequirements();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load requirement document.');
      } finally {
        setLoading(false);
      }
    };

    if (organizationId) void load();
  }, [organizationId, supabase, refreshExistingRequirements]);

  const parseApiError = async (response: Response) => {
    const payload = await response.json().catch(() => null);
    if (payload && typeof payload === 'object' && 'detail' in payload) {
      const d = (payload as { detail?: unknown }).detail;
      if (typeof d === 'string') return d;
      if (Array.isArray(d)) return d.map((x) => String(x)).join('; ');
    }
    return `Request failed (${response.status})`;
  };

  const ingestRequirementsDocument = async () => {
    if (!userId) throw new Error('You must be signed in.');
    if (requirementsInputMode === 'text' && !requirementsText.trim()) {
      throw new Error('Requirements text is empty.');
    }
    if (requirementsInputMode === 'pdf' && !requirementsPdfFile) {
      throw new Error('Please upload a requirements PDF.');
    }

    const title = requirementsTitle.trim() || 'Requirements Document';

    if (requirementsInputMode === 'pdf') {
      const formData = new FormData();
      formData.append('organization_id', organizationId);
      formData.append('uploaded_by', userId);
      formData.append('title', title);
      formData.append('file', requirementsPdfFile!);
      formData.append('source_name', requirementsPdfFile!.name);
      const res = await fetch(`${API_BASE_URL}/v1/workbench/requirements/ingest-pdf`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      return;
    }

    const res = await fetch(`${API_BASE_URL}/v1/workbench/requirements/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organization_id: organizationId,
        uploaded_by: userId,
        title,
        raw_text: requirementsText,
        source_type: 'text',
      }),
    });
    if (!res.ok) throw new Error(await parseApiError(res));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      clearPendingRequirementsPayload();
      await ingestRequirementsDocument();
      clearPendingRequirementsPayload();
      await refreshExistingRequirements();
      router.push(`/app/organizations/${organizationId}/sow`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save requirements document.');
    } finally {
      setSaving(false);
    }
  };

  const indexingInFlight = Boolean(existingRequirements && !requirementsIndexed);

  useEffect(() => {
    if (!existingRequirements || requirementsIndexed) return;
    const id = setInterval(() => {
      void refreshExistingRequirements();
    }, 2000);
    return () => clearInterval(id);
  }, [existingRequirements, requirementsIndexed, refreshExistingRequirements]);

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
          <Button variant="ghost" onClick={() => router.push('/app')} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Requirement Documents
          </Button>
          <h1 className="text-3xl font-bold">{organization?.name || 'Requirement Document'}</h1>
          <p className="text-sm text-gray-600">Step 1: Upload and index your requirements document.</p>
        </div>
      </div>

      <RequirementsStepProgress
        indexed={requirementsIndexed}
        currentStep={1}
        indexing={indexingInFlight}
        indexingLabel="Indexing requirements document..."
        chunkCount={chunkCount}
        chunkTotal={chunkTotal}
        statementCount={statementCount}
        statementCandidatesTotal={statementCandidatesTotal}
      />
      {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      {existingRequirements ? (
        <Card className="border-green-200 bg-green-50/60">
          <CardHeader>
            <CardTitle className="text-base">Requirements already uploaded</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              <span className="font-medium">{existingRequirements.title}</span>
              {existingRequirements.source_name ? (
                <span className="text-gray-600"> — {existingRequirements.source_name}</span>
              ) : null}
            </p>
            <Button type="button" onClick={() => router.push(`/app/organizations/${organizationId}/sow`)}>
              Continue
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{existingRequirements ? 'Upload a new requirements document' : 'Requirements Source'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
                rows={18}
                value={requirementsText}
                onChange={(e) => setRequirementsText(e.target.value)}
                placeholder="Paste your requirements content here..."
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

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving and Indexing...' : existingRequirements ? 'Save new document' : 'Save Document'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
