'use client';

import { useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { createClient } from '@/lib/supabase/client';

export default function OrganizationHubPage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.id as string;
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    if (!organizationId) return;

    const run = async () => {
      const { count, error } = await supabase
        .from('requirements_documents')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', organizationId);

      if (error) {
        router.replace(`/app/organizations/${organizationId}/requirements`);
        return;
      }

      const hasRequirements = (count ?? 0) > 0;
      router.replace(
        hasRequirements
          ? `/app/organizations/${organizationId}/sow`
          : `/app/organizations/${organizationId}/requirements`
      );
    };

    void run();
  }, [organizationId, router, supabase]);

  return (
    <div className="flex min-h-[300px] items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}
