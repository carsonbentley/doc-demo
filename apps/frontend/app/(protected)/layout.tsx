'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { User } from '@supabase/supabase-js';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { AppNavigation } from '@/components/app/app-navigation';

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setUser(user);
      setLoading(false);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'SIGNED_OUT' || !session) {
          router.push('/login');
        } else if (session?.user) {
          setUser(session.user);
          setLoading(false);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [router, supabase.auth]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <AppNavigation user={user} />
      <main className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8">
        {children}
      </main>
    </div>
  );
}
