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
import { clearPendingRequirementsPayload, setPendingRequirementsPayload } from '@/lib/workflow/pending-requirements';

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

type RequirementsDocRow = {
  id: string;
  title: string;
  source_type: string | null;
  source_name: string | null;
  metadata?: {
    processing_status?: string;
    chunk_total?: number;
    statement_count?: number;
    statement_candidates_total?: number;
  } | null;
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
    const docsResult = await supabase
      .from('requirements_documents')
      .select('id, title, source_type, source_name, metadata')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(20);
    const docs = (docsResult.data || []) as RequirementsDocRow[];
    if (docs.length === 0) {
      setExistingRequirements(null);
      setRequirementsIndexed(false);
      setChunkCount(0);
      setChunkTotal(undefined);
      setStatementCount(0);
      setStatementCandidatesTotal(undefined);
      return;
    }

    const countsByDocId = new Map<string, number>();
    for (const doc of docs) {
      const countResult = await supabase
        .from('requirements_chunks')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId)
        .eq('requirements_document_id', doc.id);
      countsByDocId.set(doc.id, countResult.count || 0);
    }

    const preferredDoc =
      docs.find((doc) => {
        const procCandidate = doc.metadata?.processing_status ?? null;
        const chunksCandidate = countsByDocId.get(doc.id) || 0;
        return (
          procCandidate === 'indexing' ||
          procCandidate === 'distilling' ||
          procCandidate === 'indexed' ||
          chunksCandidate > 0
        );
      }) || docs[0];

    const metadata = preferredDoc.metadata ?? null;
    const chunks = countsByDocId.get(preferredDoc.id) || 0;
    const proc = metadata?.processing_status ?? null;
    const indexed =
      proc === 'indexed' ? true : proc === 'indexing' || proc === 'distilling' ? false : chunks > 0;

    setExistingRequirements({
      id: preferredDoc.id,
      title: preferredDoc.title,
      source_type: preferredDoc.source_type,
      source_name: preferredDoc.source_name,
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

  const queueRequirementsDocument = async () => {
    if (!userId) throw new Error('You must be signed in.');
    if (requirementsInputMode === 'text' && !requirementsText.trim()) {
      throw new Error('Requirements text is empty.');
    }
    if (requirementsInputMode === 'pdf' && !requirementsPdfFile) {
      throw new Error('Please upload a requirements PDF.');
    }

    const title = requirementsTitle.trim() || 'Requirements Document';
    setPendingRequirementsPayload({
      organizationId,
      uploadedBy: userId,
      title,
      mode: requirementsInputMode,
      rawText: requirementsInputMode === 'text' ? requirementsText : undefined,
      file: requirementsInputMode === 'pdf' ? requirementsPdfFile : null,
    });
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      clearPendingRequirementsPayload();
      await queueRequirementsDocument();
      router.push(`/app/organizations/${organizationId}/sow?autoIndex=1`);
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
              Continue to SOW upload
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
