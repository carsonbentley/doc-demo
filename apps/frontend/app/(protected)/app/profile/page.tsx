'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function ProfilePage() {
  const supabase = createClient();
  const [loading, setLoading] = useState(false);
  const [teamName, setTeamName] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [currentTeam, setCurrentTeam] = useState<string | null>(null);
  const [role, setRole] = useState<'member' | 'administrator' | null>(null);
  const [toastOpen, setToastOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [toastIsError, setToastIsError] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  const showToast = (message: string, isError = false) => {
    setToastMessage(message);
    setToastIsError(isError);
    setToastOpen(true);
  };

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('users')
        .select('team:teams(name), role')
        .eq('id', user.id)
        .single();
      setCurrentTeam((data as any)?.team?.name ?? null);
      setRole(((data as any)?.role as any) ?? null);

      // Fetch team members if user is in a team
      if ((data as any)?.team?.name) {
        const { data: members } = await supabase.rpc('get_team_members');
        setTeamMembers(members || []);
      } else {
        setTeamMembers([]);
      }
    };
    load();
  }, [supabase]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/orgs/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: teamName })
      });
      if (!res.ok) throw new Error('Failed to create team');
      setTeamName('');
      // Refresh current team name
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('users')
          .select('team:teams(name)')
          .eq('id', user.id)
          .single();
        setCurrentTeam((data as any)?.team?.name ?? null);
      }
      showToast('Team created and joined');
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 400);
    } catch (err) {
      console.error(err);
      showToast('Error creating team', true);
    } finally {
      setLoading(false);
    }
  };

  const handleLeaveOrg = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/orgs/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw new Error('Failed to leave team');
      
      setCurrentTeam(null);
      setRole(null);
      setTeamMembers([]);
      showToast('Left team');
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 400);
    } catch (err) {
      console.error(err);
      showToast('Error leaving team', true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Profile</h1>
          <p className="text-gray-600">Manage your team membership.</p>
        </div>
        <Link href="/app">
          <Button variant="outline">Back to App</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Current Team</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-700">{currentTeam ?? 'Not in a team'}</p>
              {role && (
                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-800 capitalize">{role}</span>
              )}
            </div>
            
            {teamMembers.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-gray-700">Members</h4>
                <div className="space-y-1">
                  {teamMembers.map((member) => (
                    <div key={member.user_id} className="flex items-center justify-between text-xs">
                      <span className="text-gray-600">{member.email}</span>
                      <span className="px-2 py-1 rounded-full bg-gray-100 text-gray-700 capitalize">
                        {member.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {currentTeam && (
              <div className="pt-2">
                <Button 
                  variant="destructive" 
                  size="sm" 
                  onClick={handleLeaveOrg}
                  disabled={loading}
                >
                  Leave Organization
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Create Team</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="teamName">Name</Label>
                <Input id="teamName" value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
              </div>
              <Button type="submit" disabled={loading}>Create</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invitations</CardTitle>
          </CardHeader>
          <CardContent>
            <InvitationsPanel onToast={showToast} />
          </CardContent>
        </Card>
      </div>

      <AdminInviteForm inviteEmail={inviteEmail} setInviteEmail={setInviteEmail} loading={loading} setLoading={setLoading} onToast={showToast} />

      <ToastDialog open={toastOpen} onOpenChange={setToastOpen} message={toastMessage} isError={toastIsError} />
    </div>
  );
}

function AdminInviteForm({ inviteEmail, setInviteEmail, loading, setLoading, onToast }: any) {
  const supabase = createClient();
  const [teamId, setTeamId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('users')
        .select('team_id, role')
        .eq('id', user.id)
        .single();
      setTeamId((data as any)?.team_id ?? null);
      setIsAdmin((data as any)?.role === 'administrator');
    };
    load();
  }, [supabase]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamId) return alert('Join or create a team first');
    setLoading(true);
    try {
      const res = await fetch('/api/orgs/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, email: inviteEmail })
      });
      if (!res.ok) throw new Error('Failed to send invite');
      setInviteEmail('');
      onToast('Invitation sent');
    } catch (err) {
      console.error(err);
      onToast('Error sending invitation', true);
    } finally {
      setLoading(false);
    }
  };

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite Member (Admins)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleInvite} className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="inviteEmail">Email</Label>
            <Input id="inviteEmail" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} required />
          </div>
          <Button type="submit" variant="outline" disabled={loading}>Send Invite</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function InvitationsPanel({ onToast }: any) {
  const supabase = createClient();
  const [invites, setInvites] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('team_invitations')
        .select('id, team_id, email, status, created_at, team:teams(name)');
      if (!error) setInvites((data || []).filter((i: any) => i.status === 'pending'));
    };
    load();
  }, [supabase]);

  const accept = async (id: string) => {
    const res = await fetch('/api/orgs/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteId: id }) });
    if (res.ok) {
      setInvites(invites.filter(i => i.id !== id));
      onToast('Joined team');
      setTimeout(() => {
        if (typeof window !== 'undefined') {
          window.location.reload();
        }
      }, 400);
    } else {
      onToast('Failed to accept invite', true);
    }
  };

  const decline = async (id: string) => {
    const res = await fetch('/api/orgs/invitations/decline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inviteId: id }) });
    if (res.ok) {
      setInvites(invites.filter(i => i.id !== id));
      onToast('Invitation declined');
    } else {
      onToast('Failed to decline invite', true);
    }
  };

  if (invites.length === 0) {
    return <p className="text-sm text-gray-600">No pending invitations.</p>;
  }

  return (
    <div className="space-y-3">
      {invites.map((inv) => (
        <div key={inv.id} className="flex items-center justify-between border rounded p-3">
          <div>
            <p className="text-sm">You are invited to join team {inv.team?.name ?? inv.team_id}</p>
            <p className="text-xs text-gray-500">Sent: {new Date(inv.created_at).toLocaleString()}</p>
          </div>
          <div className="space-x-2">
            <Button size="sm" onClick={() => accept(inv.id)}>Accept</Button>
            <Button size="sm" variant="outline" onClick={() => decline(inv.id)}>Decline</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Simple confirmation dialog used in this page
function ToastDialog({ open, onOpenChange, message, isError }: { open: boolean; onOpenChange: (v: boolean) => void; message: string; isError?: boolean; }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className={isError ? 'text-red-700' : 'text-green-700'}>{isError ? 'Action failed' : 'Success'}</DialogTitle>
          <DialogDescription className={isError ? 'text-red-600' : 'text-gray-600'}>
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


