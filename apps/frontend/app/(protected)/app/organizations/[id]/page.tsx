'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { LoadingSpinner } from '@/components/ui/loading-spinner';

export default function OrganizationLegacyPage() {
  const params = useParams();
  const router = useRouter();
  const organizationId = params.id as string;

  useEffect(() => {
    if (!organizationId) return;
    router.replace(`/app/organizations/${organizationId}/requirements`);
  }, [organizationId, router]);

  return (
    <div className="flex min-h-[300px] items-center justify-center">
      <LoadingSpinner size="lg" />
    </div>
  );
}
