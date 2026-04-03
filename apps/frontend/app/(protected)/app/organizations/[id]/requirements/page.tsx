'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { setPendingRequirementsPayload } from '@/lib/workflow/pending-requirements';

type Organization = {
  id: string;
  name: string;
  description: string | null;
};

type InputMode = 'text' | 'pdf';

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
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load requirement document.');
      } finally {
        setLoading(false);
      }
    };

    if (organizationId) void load();
  }, [organizationId, supabase]);

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
      await queueRequirementsDocument();
      router.push(`/app/organizations/${organizationId}/sow?autoIndex=1`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save requirements document.');
    } finally {
      setSaving(false);
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
          <Button variant="ghost" onClick={() => router.push('/app')} className="mb-2">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Requirement Documents
          </Button>
          <h1 className="text-3xl font-bold">{organization?.name || 'Requirement Document'}</h1>
          <p className="text-sm text-gray-600">Step 1: Upload and index your requirements document.</p>
        </div>
      </div>

      <RequirementsStepProgress indexed={false} currentStep={1} indexing={false} />
      {error ? <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Requirements Source</CardTitle>
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
              {saving ? 'Saving and Indexing...' : 'Save Document'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
