import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id: organizationId } = await params;

    // Verify the organization exists and user has permission to delete it
    const { data: organization, error: fetchError } = await supabase
      .from('organizations')
      .select('id, name, team_id')
      .eq('id', organizationId)
      .single();

    if (fetchError || !organization) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Verify user belongs to the same team as the organization
    const { data: userRecord } = await supabase
      .from('users')
      .select('team_id')
      .eq('id', user.id)
      .single();

    if (!userRecord || (userRecord as any).team_id !== (organization as any).team_id) {
      return NextResponse.json({ error: 'Unauthorized to delete this organization' }, { status: 403 });
    }

    // Delete the organization - related data will be cascade deleted due to foreign key constraints
    const { error: deleteError } = await supabase
      .from('organizations')
      .delete()
      .eq('id', organizationId);

    if (deleteError) {
      console.error('Error deleting organization:', deleteError);
      return NextResponse.json({ error: 'Failed to delete organization' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Organization deleted successfully' });

  } catch (error) {
    console.error('Unexpected error deleting organization:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
