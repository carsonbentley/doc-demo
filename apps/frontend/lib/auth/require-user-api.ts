import { createClient } from '@/lib/supabase/server';
import { User } from '@supabase/supabase-js';

/**
 * Server-side function to require authentication in API routes.
 * Returns null if user is not authenticated (instead of redirecting).
 * @returns The authenticated user or null
 */
export async function requireUserAPI(): Promise<User | null> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    return null;
  }
  
  return user;
}

/**
 * Server-side function to get user with their profile for API routes.
 * @returns Object containing user and their profile, or null if not authenticated
 */
export async function getUserWithTeamAPI() {
  const user = await requireUserAPI();
  if (!user) {
    return null;
  }

  const supabase = await createClient();

  let { data: userProfile, error } = await supabase
    .from('users')
    .select(`
      *,
      team:teams(*)
    `)
    .eq('id', user.id)
    .single();

  if (error || !userProfile) {
    // User exists in auth but not in our users table
    // For API routes, we'll just return the user without profile
    return {
      user,
      profile: null
    };
  }

  return {
    user,
    profile: userProfile
  };
}
