'use client';

import { User } from '@supabase/supabase-js';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { cn } from '@/lib/utils';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { 
  FileText,
} from 'lucide-react';

interface AppNavigationProps {
  user: User;
}

const appSections = [
  { name: 'Workbench', href: '/app', icon: FileText },
];

export function AppNavigation({ user }: AppNavigationProps) {
  const pathname = usePathname();
  const supabase = createClient();
  const [teamName, setTeamName] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('users')
        .select('team:teams(name)')
        .eq('id', user.id)
        .single();
      setTeamName((data as any)?.team?.name ?? null);
    };
    load();
  }, [supabase, user.id]);

  return (
    <nav className="bg-white shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex items-center">
            <Link href="/app" className="text-xl font-bold text-gray-900">
              ComplyFlow
            </Link>
            <span className="ml-2 text-sm text-gray-500">Requirements Traceability</span>
          </div>
          
          <div className="flex items-center space-x-4">
            <Button variant="outline" disabled>
              {teamName ? teamName : 'Team'}
            </Button>
            <span className="text-sm text-gray-600">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </div>
      
      {/* App Sections Navigation */}
      {pathname.startsWith('/app') && (
        <div className="bg-gray-50 border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex space-x-8 overflow-x-auto py-4">
              {appSections.map((section) => {
                const Icon = section.icon;
                const isActive = pathname === section.href;
                return (
                  <Link
                    key={section.href}
                    href={section.href}
                    className={cn(
                      'flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span>{section.name}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
