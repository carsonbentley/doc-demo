'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Settings, Upload } from 'lucide-react';
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
import { type SectionLink } from '@/components/app/section-link-card';
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

type RequirementsDocRow = {
  id: string;
  title: string | null;
  source_type: string | null;
  source_name: string | null;
  raw_text: string | null;
  metadata?: {
    processing_status?: string;
    chunk_total?: number;
    statement_count?: number;
    statement_candidates_total?: number;
  } | null;
  created_at?: string;
};

function mapHistoryDetailToLinkedSections(payload: {
  sections?: Array<{
    work_section_id: string;
    section_title: string;
    metadata?: Record<string, unknown>;
    links?: Array<{
      requirements_chunk_id: string;
      chunk_index: number;
      chunk_text: string;
      requirements_document_id: string;
      metadata: Record<string, unknown>;
      similarity: number;
      rationale?: string | null;
    }>;
  }>;
}): LinkedSection[] {
  return (payload.sections || []).map((section) => ({
    work_section_id: section.work_section_id,
    section_title: section.section_title,
    work_section_metadata: section.metadata as LinkedSection['work_section_metadata'],
    links: (section.links || []).map((link) => ({
      requirements_chunk_id: link.requirements_chunk_id,
      chunk_text: link.chunk_text,
      chunk_index: link.chunk_index,
      requirements_document_id: link.requirements_document_id,
      similarity: link.similarity,
      metadata: link.metadata as SectionLink['metadata'],
    })),
  }));
}

function inferRequirementsDocumentIdFromSections(sections: LinkedSection[]): string | null {
  const counts = new Map<string, number>();
  for (const section of sections) {
    for (const link of section.links) {
      const docId = link.requirements_document_id;
      if (!docId) continue;
      counts.set(docId, (counts.get(docId) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  let bestId: string | null = null;
  let bestCount = -1;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestId = id;
    }
  }
  return bestId;
}

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
  const [linkedRequirementsDocumentId, setLinkedRequirementsDocumentId] = useState<string | null>(null);
  const [statementGroups, setStatementGroups] = useState<RequirementStatementGroup[]>([]);
  const [statementSowCitations, setStatementSowCitations] = useState<Record<string, StatementSowCitation[]>>({});
  const [sowCitationsLoading, setSowCitationsLoading] = useState(false);
  const [citationsContext, setCitationsContext] = useState<{
    requirementsDocumentId: string;
    workDocumentId: string;
    overlapThreshold: number;
    maxCitationsPerStatement: number;
  } | null>(null);
  const [sowLinkSettings, setSowLinkSettings] = useState<SowLinkSettings>(DEFAULT_SOW_LINK_SETTINGS);
  const [sowSettingsOpen, setSowSettingsOpen] = useState(false);
  const [uploadMoreOpen, setUploadMoreOpen] = useState(false);
  const [sowSettingsDraftOverlapPct, setSowSettingsDraftOverlapPct] = useState(75);
  const [sowSettingsDraftMaxCitations, setSowSettingsDraftMaxCitations] = useState(3);
  const filesInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!organizationId) return;
    setSowLinkSettings(loadSowLinkSettings(organizationId));
  }, [organizationId]);

  useEffect(() => {
    setLinkedWorkDocumentId(null);
    setLinkedSections([]);
    setLinkedRequirementsDocumentId(null);
    setCitationsContext(null);
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
      const docsResult = await supabase
        .from('requirements_documents')
        .select('id, title, source_type, source_name, raw_text, metadata, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(20);
      const docs = (docsResult.data || []) as RequirementsDocRow[];
      const hasPendingAutoIndex =
        searchParams.get('autoIndex') === '1' &&
        !!userId &&
        !!getPendingRequirementsPayload(organizationId) &&
        !indexingStarted;

      if (docs.length === 0) {
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

      const chunkCount = countsByDocId.get(preferredDoc.id) || 0;
      const metadata = preferredDoc.metadata ?? null;
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
        latest_requirements_document_id: preferredDoc.id,
        latest_title: preferredDoc.title,
        latest_source_type: preferredDoc.source_type,
        latest_source_name: preferredDoc.source_name,
        latest_raw_text: preferredDoc.raw_text,
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
  }, [organizationId, userId, searchParams]);

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
            router.replace(`/app/organizations/${organizationId}/sow`);
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
          router.replace(`/app/organizations/${organizationId}/sow`);
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
  }, [searchParams, userId, indexingStarted, organizationId, router]);

  const activeRequirementsDocumentId = linkedRequirementsDocumentId ?? status?.latest_requirements_document_id ?? null;

  useEffect(() => {
    const loadStatements = async () => {
      if (!activeRequirementsDocumentId) {
        setStatementGroups([]);
        return;
      }
      try {
        const response = await fetch(
          `${API_BASE_URL}/v1/workbench/requirements/${activeRequirementsDocumentId}/statements?organization_id=${organizationId}`
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
  }, [activeRequirementsDocumentId, organizationId]);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    const run = async () => {
      try {
        const response = await fetch(
          `${API_BASE_URL}/v1/workbench/work/last-linked?organization_id=${encodeURIComponent(organizationId)}`
        );
        if (!response.ok || cancelled) return;
        const payload = await response.json();
        const id = payload.work_document_id as string | null | undefined;
        if (!cancelled) {
          setLinkedWorkDocumentId((prev) => (prev === null ? id ?? null : prev));
        }
      } catch {
        // Non-blocking restore of last linked SOW.
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    if (!organizationId || !linkedWorkDocumentId) {
      setLinkedSections([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const params = new URLSearchParams({ organization_id: organizationId });
        const response = await fetch(
          `${API_BASE_URL}/v1/workbench/work/history/${linkedWorkDocumentId}?${params.toString()}`
        );
        if (!response.ok || cancelled) return;
        const payload = await response.json();
        if (!cancelled) {
          const sections = mapHistoryDetailToLinkedSections(payload);
          setLinkedSections(sections);
          const inferredReqDocId = inferRequirementsDocumentIdFromSections(sections);
          setLinkedRequirementsDocumentId((prev) => prev ?? inferredReqDocId);
        }
      } catch {
        if (!cancelled) setLinkedSections([]);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [organizationId, linkedWorkDocumentId]);

  const statementRowTotal = useMemo(
    () => statementGroups.reduce((acc, g) => acc + g.count, 0),
    [statementGroups]
  );
  const linkedRequirementCount = useMemo(() => {
    if (!linkedWorkDocumentId) return 0;
    return Object.values(statementSowCitations).filter((rows) => rows.length > 0).length;
  }, [linkedWorkDocumentId, statementSowCitations]);
  const missedRequirementCount = Math.max(statementRowTotal - linkedRequirementCount, 0);
  const coveragePct = statementRowTotal > 0 ? Math.round((linkedRequirementCount / statementRowTotal) * 100) : 0;

  const fetchStatementSowCitations = async (
    requirementsDocumentId: string,
    workDocumentId: string
  ): Promise<Record<string, StatementSowCitation[]>> => {
    const params = new URLSearchParams({
      organization_id: organizationId,
      work_document_id: workDocumentId,
      overlap_threshold: String(sowLinkSettings.overlapThreshold),
      max_citations_per_statement: String(sowLinkSettings.maxCitationsPerStatement),
    });
    const response = await fetch(
      `${API_BASE_URL}/v1/workbench/requirements/${requirementsDocumentId}/statement-sow-links?${params.toString()}`
    );
    if (!response.ok) return {};
    const payload = await response.json();
    const rows = (payload.statements || []) as {
      requirement_statement_id: string;
      citations: StatementSowCitation[];
    }[];
    const next: Record<string, StatementSowCitation[]> = {};
    for (const row of rows) {
      next[row.requirement_statement_id] = row.citations || [];
    }
    return next;
  };

  useEffect(() => {
    const loadStatementSowCitations = async () => {
      if (!activeRequirementsDocumentId || !linkedWorkDocumentId) {
        setStatementSowCitations({});
        setCitationsContext(null);
        return;
      }
      if (
        citationsContext &&
        citationsContext.requirementsDocumentId === activeRequirementsDocumentId &&
        citationsContext.workDocumentId === linkedWorkDocumentId &&
        citationsContext.overlapThreshold === sowLinkSettings.overlapThreshold &&
        citationsContext.maxCitationsPerStatement === sowLinkSettings.maxCitationsPerStatement
      ) {
        return;
      }
      setSowCitationsLoading(true);
      try {
        const next = await fetchStatementSowCitations(activeRequirementsDocumentId, linkedWorkDocumentId);
        setStatementSowCitations(next);
        setCitationsContext({
          requirementsDocumentId: activeRequirementsDocumentId,
          workDocumentId: linkedWorkDocumentId,
          overlapThreshold: sowLinkSettings.overlapThreshold,
          maxCitationsPerStatement: sowLinkSettings.maxCitationsPerStatement,
        });
      } catch {
        setStatementSowCitations({});
      } finally {
        setSowCitationsLoading(false);
      }
    };
    void loadStatementSowCitations();
  }, [
    activeRequirementsDocumentId,
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
        max_links_per_section: sowLinkSettings.maxCitationsPerStatement,
        min_similarity: sowLinkSettings.overlapThreshold,
      }),
    });
    if (!response.ok) throw new Error(`Failed to link sections (${response.status})`);
    const payload = await response.json();
    const nextSections = payload.linked_sections || [];
    return nextSections as LinkedSection[];
  };

  const handleUploadAndLink = async () => {
    setSubmitting(true);
    setError(null);
    setUploadInfo(null);
    setSowCitationsLoading(true);
    try {
      const workDocumentId = await ingestWorkDocument();
      const nextSections = await linkSections(workDocumentId);
      const inferredReqDocId = inferRequirementsDocumentIdFromSections(nextSections);
      const requirementsDocumentId = inferredReqDocId ?? status?.latest_requirements_document_id;
      if (!requirementsDocumentId) {
        throw new Error('Requirements document has not been indexed yet.');
      }
      const nextCitations = await fetchStatementSowCitations(requirementsDocumentId, workDocumentId);
      setStatementSowCitations(nextCitations);
      setCitationsContext({
        requirementsDocumentId,
        workDocumentId,
        overlapThreshold: sowLinkSettings.overlapThreshold,
        maxCitationsPerStatement: sowLinkSettings.maxCitationsPerStatement,
      });
      setLinkedRequirementsDocumentId(requirementsDocumentId);
      setLinkedWorkDocumentId(workDocumentId);
      setLinkedSections(nextSections);
      const linkedSectionCount = nextSections.length;
      if (workInputMode === 'pdf') {
        setUploadInfo(
          linkedSectionCount === 0
            ? 'Upload finished. No links matched the selected threshold.'
            : 'Upload and linking completed.'
        );
      }
      setUploadMoreOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to upload SOW and link sections.');
    } finally {
      setSowCitationsLoading(false);
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

  const hasLinkedSections = linkedSections.length > 0;

  const requirementsColumn = (
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
          statementSowCitations={hasLinkedSections ? statementSowCitations : undefined}
          sowCitationsLoading={hasLinkedSections && sowCitationsLoading}
        />
      ) : (
        <Card>
          <CardContent className="py-6 text-sm text-gray-600">
            Requirements statements will appear here as distillation progresses.
          </CardContent>
        </Card>
      )}
    </div>
  );

  const openSowSettings = () => {
    setSowSettingsDraftOverlapPct(Math.round(sowLinkSettings.overlapThreshold * 100));
    setSowSettingsDraftMaxCitations(sowLinkSettings.maxCitationsPerStatement);
    setSowSettingsOpen(true);
  };

  const sowSourceUploadCard = (
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
          onClick={openSowSettings}
        >
          <Settings className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button type="button" variant={workInputMode === 'text' ? 'default' : 'outline'} onClick={() => setWorkInputMode('text')}>
            Text
          </Button>
          <Button type="button" variant={workInputMode === 'pdf' ? 'default' : 'outline'} onClick={() => setWorkInputMode('pdf')}>
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
                <Button type="button" variant="outline" onClick={() => filesInputRef.current?.click()}>
                  Add Files
                </Button>
                <Button type="button" variant="outline" onClick={() => folderInputRef.current?.click()}>
                  Add Folder
                </Button>
                {workPdfFiles.length > 0 ? (
                  <Button type="button" variant="ghost" onClick={() => setWorkPdfFiles([])}>
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
        <Button className="w-full" onClick={handleUploadAndLink} disabled={submitting || !status?.indexed || indexing}>
          {submitting ? 'Uploading and Linking...' : 'Upload SOW and Generate Links'}
        </Button>
        {!indexing && !status?.indexed ? (
          <p className="text-xs text-amber-700">Requirements indexing has not completed yet.</p>
        ) : null}
        {uploadInfo ? <p className="text-xs text-green-700">{uploadInfo}</p> : null}
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const stepProgress = (
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
  );

  return (
    <>
      <Dialog open={uploadMoreOpen} onOpenChange={setUploadMoreOpen}>
        <DialogContent className="max-h-[min(90dvh,880px)] gap-0 overflow-y-auto sm:max-w-lg">
          <DialogHeader className="pb-4">
            <DialogTitle>Upload and link more documents</DialogTitle>
            <DialogDescription>
              Add another SOW or template. Section links are saved to this workspace when processing completes.
            </DialogDescription>
          </DialogHeader>
          {sowSourceUploadCard}
        </DialogContent>
      </Dialog>

      {hasLinkedSections ? (
        <div className="relative left-1/2 w-screen max-w-none -translate-x-1/2 min-h-[calc(100dvh-5.5rem)] bg-gray-50/90 pb-16">
          <div className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-6 lg:px-8">
            <div className="mx-auto flex max-w-[1600px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 mb-1 h-8 px-2 text-gray-600"
                  onClick={() => router.push(`/app/organizations/${organizationId}/requirements`)}
                >
                  <ArrowLeft className="mr-1 h-4 w-4" />
                  Requirements setup
                </Button>
                <h1 className="truncate text-2xl font-bold tracking-tight text-gray-900">Linked documents</h1>
                <p className="text-sm text-gray-600">Requirements source, extracted statements, and SOW section links.</p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                <Button type="button" onClick={() => setUploadMoreOpen(true)}>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload and link more documents
                </Button>
                <Button type="button" variant="outline" size="icon" aria-label="SOW link settings" title="SOW link settings" onClick={openSowSettings}>
                  <Settings className="h-4 w-4" />
                </Button>
                <Button variant="outline" onClick={() => router.push(`/app/organizations/${organizationId}/history`)}>
                  View History
                </Button>
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-[1600px] space-y-6 px-4 pt-6 sm:px-6 lg:px-8">
            {indexing || !status?.indexed ? stepProgress : null}
            {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
            {statementRowTotal > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Coverage overview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Test coverage</p>
                      <p className="text-2xl font-semibold text-gray-900">{coveragePct}%</p>
                    </div>
                    <div className="rounded-md border bg-white p-3">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Total requirements</p>
                      <p className="text-2xl font-semibold text-gray-900">{statementRowTotal}</p>
                    </div>
                    <div className="rounded-md border bg-emerald-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-emerald-700">Linked requirements</p>
                      <p className="text-2xl font-semibold text-emerald-900">{linkedRequirementCount}</p>
                    </div>
                    <div className="rounded-md border bg-red-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-red-700">Missed requirements</p>
                      <p className="text-2xl font-semibold text-red-800">{missedRequirementCount}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : null}
            {requirementsColumn}
            <p className="border-t border-gray-200 pt-6 text-sm text-gray-500">
              Links are saved automatically. Open <span className="font-medium">View History</span> to browse past SOW uploads.
            </p>
          </div>
        </div>
      ) : (
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

          {stepProgress}
          {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

          <div className="grid gap-6 lg:grid-cols-2">
            {requirementsColumn}
            <div className="space-y-4">
              <SowUploadPrimary hasSow={false} />
              {sowSourceUploadCard}
            </div>
          </div>
        </div>
      )}

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
                  Math.max(1, Math.round(Number.isFinite(sowSettingsDraftMaxCitations) ? sowSettingsDraftMaxCitations : 3))
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
    </>
  );
}
