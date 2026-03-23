'use client';

import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { createClient } from '@/lib/supabase/client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function LoginPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    // Check for existing session
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setIsAuthenticated(true);
          // Get redirect URL from query params or default to /app
          const urlParams = new URLSearchParams(window.location.search);
          const next = urlParams.get('next') || '/app';
          router.push(next);
          return;
        }
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkSession();

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        setIsAuthenticated(true);
        const urlParams = new URLSearchParams(window.location.search);
        const next = urlParams.get('next') || '/app';
        router.push(next);
      } else {
        setIsAuthenticated(false);
        setIsLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [router, supabase]);

  // Show loading spinner while checking authentication
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  // Don't render login form if already authenticated
  if (isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-2 text-gray-600">Redirecting...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <HeaderOrgInfo />

        <Card>
          <CardHeader>
            <CardTitle>Welcome to ComplyFlow</CardTitle>
          </CardHeader>
          <CardContent>
            <Auth
              supabaseClient={supabase}
              appearance={{
                theme: ThemeSupa,
                variables: {
                  default: {
                    colors: {
                      brand: '#000000',
                      brandAccent: '#333333',
                    },
                  },
                },
              }}
              providers={[]}
              redirectTo={typeof window !== 'undefined' ? `${window.location.origin}/api/auth/callback` : '/api/auth/callback'}
              onlyThirdPartyProviders={false}
              magicLink={true}
              showLinks={true}
            />
          </CardContent>
        </Card>

        <div className="text-center text-sm text-gray-600">
          <p>
            By signing in, you agree to our terms of service and{' '}
            <Link href="/privacy" className="text-blue-600 hover:text-blue-800 underline">
              privacy policy
            </Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

function HeaderOrgInfo() {
  const supabase = createClient();
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('users')
        .select('team:teams(name)')
        .eq('id', user.id)
        .single();
      setTeamName((data as any)?.team?.name ?? null);
    };
    load();
  }, [supabase]);

  return (
    <div className="text-center">
      <h1 className="text-3xl font-bold text-gray-900">ComplyFlow</h1>
      <p className="mt-2 text-gray-600">Defense Requirements Workbench</p>
      {teamName && (
        <p className="mt-1 text-sm text-gray-500">Team: {teamName}</p>
      )}
    </div>
  );
}
