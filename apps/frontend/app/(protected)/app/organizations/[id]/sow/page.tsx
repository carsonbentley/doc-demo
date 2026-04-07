'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Settings } from 'lucide-react';
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
import {
  DEFAULT_SOW_LINK_SETTINGS,
  loadSowLinkSettings,
  saveSowLinkSettings,
  type SowLinkSettings,
} from '@/lib/workflow/sow-link-settings';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type InputMode = 'text' | 'pdf';

type RequirementsStatus = {
  indexed: boolean;
  processing_status?: string | null;
  latest_requirements_document_id: string | null;
  latest_title: string | null;
  latest_source_type: string | null;
  latest_source_name: string | null;
  latest_raw_text: string | null;
  chunk_count: number;
  chunk_total?: number;
  statement_count?: number;
  statement_candidates_total?: number;
};

type LinkedSection = {
  work_section_id: string;
  section_title: string;
  work_section_metadata?: { source_document_name?: string; source_document_path?: string };
  links: SectionLink[];
};

type RequirementStatement = {
  id: string;
  statement_order: number;
  section_title: string;
  modal_verb: string;
  category_label: string;
  requirement_summary?: string | null;
  section_reference?: string | null;
  statement_text: string;
  distilled_text?: string | null;
  source_quote?: string | null;
  note_text?: string | null;
  source_page?: number | null;
};

type RequirementStatementGroup = {
  modal_verb: string;
  category_label: string;
  count: number;
  items: RequirementStatement[];
};

type StatementSowCitation = {
  work_section_id: string;
  section_title: string;
  work_document_title?: string | null;
  source_document_name?: string | null;
  quote: string;
  similarity: number;
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
  const [pendingIndexMode, setPendingIndexMode] = useState<InputMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workInputMode, setWorkInputMode] = useState<InputMode>('text');
  const [workTitle, setWorkTitle] = useState('SOW Document');
  const [workText, setWorkText] = useState('');
  const [workPdfFiles, setWorkPdfFiles] = useState<File[]>([]);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const [linkedSections, setLinkedSections] = useState<LinkedSection[]>([]);
  const [linkedWorkDocumentId, setLinkedWorkDocumentId] = useState<string | null>(null);
  const [statementGroups, setStatementGroups] = useState<RequirementStatementGroup[]>([]);
  const [statementSowCitations, setStatementSowCitations] = useState<Record<string, StatementSowCitation[]>>({});
  const [sowCitationsLoading, setSowCitationsLoading] = useState(false);
  const [sowLinkSettings, setSowLinkSettings] = useState<SowLinkSettings>(DEFAULT_SOW_LINK_SETTINGS);
  const [sowSettingsOpen, setSowSettingsOpen] = useState(false);
  const [sowSettingsDraftOverlapPct, setSowSettingsDraftOverlapPct] = useState(38);
  const [sowSettingsDraftMaxCitations, setSowSettingsDraftMaxCitations] = useState(10);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    setSowLinkSettings(loadSowLinkSettings(organizationId));
  }, [organizationId]);

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
        .select('id, title, source_type, source_name, raw_text, metadata, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(1);

      const latest = latestDocResult.data?.[0];
      const hasPendingAutoIndex =
        searchParams.get('autoIndex') === '1' &&
        !!userId &&
        !!getPendingRequirementsPayload(organizationId) &&
        !indexingStarted;

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
      const metadata =
        (latest.metadata as {
          processing_status?: string;
          chunk_total?: number;
          statement_count?: number;
          statement_candidates_total?: number;
        } | null) ?? null;
      const chunkTotal = metadata?.chunk_total;
      const statementCount = metadata?.statement_count ?? 0;
      const statementCandidatesTotal = metadata?.statement_candidates_total;
      const processingStatus = metadata?.processing_status ?? null;
      const indexed =
        processingStatus === 'indexed'
          ? true
          : processingStatus === 'indexing' || processingStatus === 'distilling'
            ? false
            : chunkCount > 0;

      const effectiveIndexed = hasPendingAutoIndex ? false : indexed;

      setIndexing(!effectiveIndexed);
      setStatus({
        indexed: effectiveIndexed,
        processing_status: processingStatus,
        latest_requirements_document_id: latest.id,
        latest_title: latest.title,
        latest_source_type: latest.source_type,
        latest_source_name: latest.source_name,
        latest_raw_text: latest.raw_text,
        chunk_count: chunkCount,
        chunk_total: chunkTotal,
        statement_count: statementCount,
        statement_candidates_total: statementCandidatesTotal,
      });
      return effectiveIndexed;
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
      setIndexing(!indexed);
    };

    void tick();
    const intervalId = setInterval(() => {
      void tick();
    }, 1500);

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

    setPendingIndexMode(pending.mode);
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
      if (!status?.latest_requirements_document_id) {
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
    const pollId = setInterval(() => {
      void loadStatements();
    }, 1500);
    return () => clearInterval(pollId);
  }, [status?.latest_requirements_document_id, organizationId]);

  useEffect(() => {
    const pickLatestLinkedWork = async () => {
      if (linkedWorkDocumentId || !organizationId) return;
      try {
        const response = await fetch(`${API_BASE_URL}/v1/workbench/work/history?organization_id=${organizationId}`);
        if (!response.ok) return;
        const payload = await response.json();
        const items = (payload.items || []) as { work_document_id: string; link_count: number }[];
        const withLinks = items.find((item) => item.link_count > 0);
        if (withLinks?.work_document_id) {
          setLinkedWorkDocumentId(withLinks.work_document_id);
        }
      } catch {
        // Non-blocking restore of last linked SOW.
      }
    };
    void pickLatestLinkedWork();
  }, [organizationId, linkedWorkDocumentId]);

  const statementRowTotal = useMemo(
    () => statementGroups.reduce((acc, g) => acc + g.count, 0),
    [statementGroups]
  );

  useEffect(() => {
    const loadStatementSowCitations = async () => {
      if (!status?.latest_requirements_document_id || !linkedWorkDocumentId) {
        setStatementSowCitations({});
        return;
      }
      setSowCitationsLoading(true);
      try {
        const params = new URLSearchParams({
          organization_id: organizationId,
          work_document_id: linkedWorkDocumentId,
          overlap_threshold: String(sowLinkSettings.overlapThreshold),
          max_citations_per_statement: String(sowLinkSettings.maxCitationsPerStatement),
        });
        const response = await fetch(
          `${API_BASE_URL}/v1/workbench/requirements/${status.latest_requirements_document_id}/statement-sow-links?${params.toString()}`
        );
        if (!response.ok) {
          setStatementSowCitations({});
          return;
        }
        const payload = await response.json();
        const rows = (payload.statements || []) as {
          requirement_statement_id: string;
          citations: StatementSowCitation[];
        }[];
        const next: Record<string, StatementSowCitation[]> = {};
        for (const row of rows) {
          next[row.requirement_statement_id] = row.citations || [];
        }
        setStatementSowCitations(next);
      } catch {
        setStatementSowCitations({});
      } finally {
        setSowCitationsLoading(false);
      }
    };
    void loadStatementSowCitations();
  }, [
    status?.latest_requirements_document_id,
    linkedWorkDocumentId,
    organizationId,
    statementRowTotal,
    sowLinkSettings.overlapThreshold,
    sowLinkSettings.maxCitationsPerStatement,
  ]);

  const ingestWorkDocument = async (): Promise<string> => {
    if (!userId) throw new Error('You must be signed in.');
    if (workInputMode === 'text' && !workText.trim()) throw new Error('SOW text is empty.');
    if (workInputMode === 'pdf' && workPdfFiles.length === 0) throw new Error('Please upload SOW file(s).');

    let response: Response;
    if (workInputMode === 'pdf') {
      const formData = new FormData();
      formData.append('organization_id', organizationId);
      formData.append('uploaded_by', userId);
      formData.append('title', workTitle);
      formData.append('batch_name', workTitle);
      for (const file of workPdfFiles) {
        formData.append('files', file, file.webkitRelativePath || file.name);
      }
      response = await fetch(`${API_BASE_URL}/v1/workbench/work/ingest-batch`, { method: 'POST', body: formData });
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
    const nextSections = payload.linked_sections || [];
    setLinkedSections(nextSections);
    return nextSections.length;
  };

  const handleUploadAndLink = async () => {
    setSubmitting(true);
    setError(null);
    setUploadInfo(null);
    try {
      const workDocumentId = await ingestWorkDocument();
      const linkedSectionCount = await linkSections(workDocumentId);
      setLinkedWorkDocumentId(workDocumentId);
      if (workInputMode === 'pdf') {
        setUploadInfo(
          linkedSectionCount === 0
            ? 'Upload finished. No links matched the selected threshold.'
            : 'Upload and linking completed.'
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload SOW and link sections.');
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (workInputMode !== 'pdf') return;
    const folderInput = folderInputRef.current;
    if (!folderInput) return;
    folderInput.setAttribute('webkitdirectory', '');
    folderInput.setAttribute('directory', '');
  }, [workInputMode]);

  const addFiles = (incoming: File[]) => {
    const allowed = new Set(['pdf', 'txt', 'md']);
    const valid = incoming.filter((f) => {
      const ext = f.name.toLowerCase().split('.').pop() || '';
      return allowed.has(ext);
    });
    const skipped = incoming.length - valid.length;
    setWorkPdfFiles((prev) => {
      const next = [...prev];
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`));
      for (const file of valid) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!seen.has(key)) {
          next.push(file);
          seen.add(key);
        }
      }
      return next;
    });
    if (skipped > 0) {
      setError(`Skipped ${skipped} unsupported file(s). Supported: PDF, TXT, MD.`);
    } else {
      setError(null);
    }
  };

  const removeWorkFile = (target: File) => {
    setWorkPdfFiles((prev) =>
      prev.filter((f) => !(f.name === target.name && f.size === target.size && f.lastModified === target.lastModified))
    );
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

      <RequirementsStepProgress
        indexed={Boolean(status?.indexed)}
        currentStep={2}
        indexing={indexing}
        indexingLabel={
          indexing && pendingIndexMode === 'pdf' && (status?.chunk_count ?? 0) === 0
            ? 'Scanning PDF...'
            : 'Indexing requirements document...'
        }
        chunkCount={status?.chunk_count ?? 0}
        chunkTotal={status?.chunk_total}
        statementCount={status?.statement_count ?? 0}
        statementCandidatesTotal={status?.statement_candidates_total}
      />
      {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <RequirementsDocumentViewer
            title={status?.latest_title}
            sourceType={status?.latest_source_type}
            sourceName={status?.latest_source_name}
            rawText={status?.latest_raw_text}
          />
          {status?.latest_requirements_document_id ? (
            <RequirementsStatementsGroups
              groups={statementGroups}
              statementSowCitations={linkedWorkDocumentId ? statementSowCitations : undefined}
              sowCitationsLoading={Boolean(linkedWorkDocumentId) && sowCitationsLoading}
            />
          ) : (
            <Card>
              <CardContent className="py-6 text-sm text-gray-600">
                Requirements statements will appear here as distillation progresses.
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <SowUploadPrimary hasSow={linkedSections.length > 0} />
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <CardTitle className="text-base font-semibold">SOW Source</CardTitle>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-gray-600"
                aria-label="SOW link settings"
                title="SOW link settings"
                onClick={() => {
                  setSowSettingsDraftOverlapPct(Math.round(sowLinkSettings.overlapThreshold * 100));
                  setSowSettingsDraftMaxCitations(sowLinkSettings.maxCitationsPerStatement);
                  setSowSettingsOpen(true);
                }}
              >
                <Settings className="h-4 w-4" />
              </Button>
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
                  <Label>SOW Files</Label>
                  <div
                    className={`rounded-md border-2 border-dashed p-4 transition ${
                      isDropActive ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50'
                    }`}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      setIsDropActive(true);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setIsDropActive(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      setIsDropActive(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDropActive(false);
                      addFiles(Array.from(e.dataTransfer.files || []));
                    }}
                  >
                    <p className="text-sm text-gray-700">Drag and drop files/folders here, or use buttons below.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => filesInputRef.current?.click()}
                      >
                        Add Files
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => folderInputRef.current?.click()}
                      >
                        Add Folder
                      </Button>
                      {workPdfFiles.length > 0 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setWorkPdfFiles([])}
                        >
                          Clear
                        </Button>
                      ) : null}
                    </div>
                    <input
                      ref={filesInputRef}
                      className="hidden"
                      type="file"
                      accept=".pdf,.txt,.md"
                      multiple
                      onChange={(e) => {
                        addFiles(Array.from(e.target.files || []));
                        e.currentTarget.value = '';
                      }}
                    />
                    <input
                      ref={folderInputRef}
                      className="hidden"
                      type="file"
                      multiple
                      onChange={(e) => {
                        addFiles(Array.from(e.target.files || []));
                        e.currentTarget.value = '';
                      }}
                    />
                  </div>
                  {workPdfFiles.length > 0 ? (
                    <div className="max-h-40 space-y-1 overflow-auto rounded-md border bg-white p-2">
                      {workPdfFiles.map((file) => (
                        <div
                          key={`${file.name}:${file.size}:${file.lastModified}`}
                          className="flex items-center justify-between text-xs text-gray-700"
                        >
                          <span className="truncate pr-2">{file.webkitRelativePath || file.name}</span>
                          <Button type="button" variant="ghost" className="h-6 px-2" onClick={() => removeWorkFile(file)}>
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-xs text-gray-500">
                    {workPdfFiles.length > 0
                      ? `${workPdfFiles.length} file(s) queued. You can keep adding more before upload.`
                      : 'Supports PDF/TXT/MD. You can upload individual files or an entire folder.'}
                  </p>
                </div>
              )}
              <Button
                className="w-full"
                onClick={handleUploadAndLink}
                disabled={submitting || !status?.indexed || indexing}
              >
                {submitting ? 'Uploading and Linking...' : 'Upload SOW and Generate Links'}
              </Button>
              {!indexing && !status?.indexed ? (
                <p className="text-xs text-amber-700">Requirements indexing has not completed yet.</p>
              ) : null}
              {uploadInfo ? <p className="text-xs text-green-700">{uploadInfo}</p> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {linkedSections.length > 0 ? (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold">Linked Requirement Citations</h2>
          {linkedSections.map((section) => (
            <SectionLinkCard
              key={section.work_section_id}
              sectionTitle={section.section_title}
              sectionSourceName={section.work_section_metadata?.source_document_name}
              links={section.links}
            />
          ))}
          <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
            SOW upload and linking saved. You can review this run in History.
          </div>
        </div>
      ) : null}

      <Dialog open={sowSettingsOpen} onOpenChange={setSowSettingsOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>SOW link settings</DialogTitle>
            <DialogDescription>
              Adjust matching strictness and how many SOW excerpts appear under each requirement. Preferences are saved
              for this organization in this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="sowOverlap">Overlap threshold</Label>
                <span className="text-sm tabular-nums text-gray-600">{sowSettingsDraftOverlapPct}%</span>
              </div>
              <input
                id="sowOverlap"
                type="range"
                min={5}
                max={95}
                step={1}
                value={sowSettingsDraftOverlapPct}
                onChange={(e) => setSowSettingsDraftOverlapPct(Number(e.target.value))}
                className="h-2 w-full cursor-pointer accent-gray-900"
              />
              <p className="text-xs text-gray-500">
                Higher values require stronger overlap between the requirement text and the indexed chunk before a linked
                SOW citation appears.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sowMaxCitations">Citations per requirement</Label>
              <Input
                id="sowMaxCitations"
                type="number"
                min={1}
                max={50}
                value={sowSettingsDraftMaxCitations}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isFinite(v)) return;
                  setSowSettingsDraftMaxCitations(v);
                }}
              />
              <p className="text-xs text-gray-500">Show at most this many SOW excerpts for each expanded requirement (1–50).</p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setSowSettingsOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                const overlapRaw = sowSettingsDraftOverlapPct / 100;
                const overlapThreshold = Math.min(0.95, Math.max(0.05, overlapRaw));
                const maxCitationsPerStatement = Math.min(
                  50,
                  Math.max(1, Math.round(Number.isFinite(sowSettingsDraftMaxCitations) ? sowSettingsDraftMaxCitations : 10))
                );
                const next: SowLinkSettings = { overlapThreshold, maxCitationsPerStatement };
                setSowLinkSettings(next);
                saveSowLinkSettings(organizationId, next);
                setSowSettingsOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
