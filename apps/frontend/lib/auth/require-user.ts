import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { User } from '@supabase/supabase-js';

/**
 * Server-side function to require authentication.
 * Redirects to login if user is not authenticated.
 * @returns The authenticated user
 */
export async function requireUser(): Promise<User> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  
  if (error || !user) {
    redirect('/login');
  }
  
  return user;
}

/**
 * Server-side function to get user with their profile.
 * Creates profile automatically if it doesn't exist.
 * @returns Object containing user and their profile
 */
export async function getUserWithTeam() {
  const user = await requireUser();
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
    // Create profile automatically for MVP
    try {
      const profileData = await createUserProfile(user);
      userProfile = profileData.user as any;
    } catch (createError) {
      console.error('Failed to create user profile:', createError);
      // For MVP, we can continue without team data
      return {
        user,
        profile: null
      };
    }
  }

  return {
    user,
    profile: userProfile
  };
}

/**
 * Server-side function to create a user profile.
 * Called automatically after successful authentication.
 * @param user - The authenticated user from Supabase Auth
 */
export async function createUserProfile(user: User) {
  const supabase = await createClient();

  try {
    // Create a team with the user's email as the name
    const { data: team, error: teamError } = await supabase
      .from('teams')
      .insert({
        name: user.email!,
        owner_id: user.id,
        username: user.email!.split('@')[0], // Use email prefix as username
      })
      .select('id')
      .single();

    if (teamError) {
      throw new Error(`Failed to create team: ${teamError.message}`);
    }

    // Create user profile with the team
    const { data: userProfile, error: userError } = await supabase
      .from('users')
      .insert({
        id: user.id,
        email: user.email!,
        team_id: team.id,
      })
      .select()
      .single();

    if (userError) {
      throw new Error(`Failed to create user profile: ${userError.message}`);
    }

    return {
      user: userProfile,
      team: team
    };
  } catch (error) {
    console.error('Error creating user profile and team:', error);
    throw new Error('Failed to create user profile and team');
  }
}
