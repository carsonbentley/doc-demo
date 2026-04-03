'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { createClient } from '@/lib/supabase/client';
import { CreateOrganizationModal } from '@/components/app/create-organization-modal';
import { DeleteOrganizationModal } from '@/components/app/delete-organization-modal';
import {
  FileText,
  Target,
  ArrowRight,
  Plus,
  CheckCircle,
  Trash2
} from 'lucide-react';



interface RequirementDocument {
  id: string;
  name: string;
  description: string | null;
  status: string;
  due_date: string | null;
  created_at: string;
}

export default function AppDashboard() {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<RequirementDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [organizationToDelete, setOrganizationToDelete] = useState<RequirementDocument | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
          throw new Error('User not authenticated');
        }

        // Load user's organizations
        const { data: organizationsData, error } = await supabase
          .from('organizations')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        // If no organizations exist, create a default one
        if (!organizationsData || organizationsData.length === 0) {
          await createDefaultOrganization(user);
          // Reload organizations after creating default
          const { data: newOrganizationsData, error: reloadError } = await supabase
            .from('organizations')
            .select('*')
            .order('created_at', { ascending: false });

          if (!reloadError && newOrganizationsData) {
            setOrganizations(newOrganizationsData as unknown as RequirementDocument[]);
          }
        } else {
          setOrganizations(organizationsData as unknown as RequirementDocument[]);
        }
        
        // If we created a default organization, refresh the page to ensure all data is synced
        if (!organizationsData || organizationsData.length === 0) {
          // Small delay to ensure database operations are complete, then refresh
          setTimeout(() => {
            if (typeof window !== 'undefined') {
              window.location.reload();
            }
          }, 1500);
        }
      } catch (error) {
        console.error('Error loading dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  const createDefaultOrganization = async (user: { id: string; email?: string | null }) => {
    const supabase = createClient();

    try {
      // Get user's team - if user record doesn't exist, create it
      const { data: existingUserRecord, error: userRecordError } = await supabase
        .from('users')
        .select('team_id')
        .eq('id', user.id)
        .single();
      let userRecord = existingUserRecord;

      if (userRecordError && userRecordError.code !== 'PGRST116') {
        console.error('Error fetching user record:', userRecordError);
        throw new Error(`Failed to fetch user record: ${userRecordError.message}`);
      }

      if (!userRecord) {
        // User profile doesn't exist, create it with a team using client-side approach
        console.log('User profile not found, creating user profile and team...');
        
        // Create team first
        const { data: team, error: teamError } = await supabase
          .from('teams')
          .insert({
            name: user.email!,
            owner_id: user.id,
            username: user.email!.split('@')[0],
          })
          .select('id')
          .single();

        if (teamError) {
          console.error('Team creation error:', teamError);
          throw new Error(`Failed to create team: ${teamError.message}`);
        }

        // Create user profile
        const { data: userProfile, error: userError } = await supabase
          .from('users')
          .insert({
            id: user.id,
            email: user.email!,
            team_id: team.id,
          })
          .select('team_id')
          .single();

        if (userError) {
          console.error('User profile creation error:', userError);
          throw new Error(`Failed to create user profile: ${userError.message}`);
        }

        userRecord = userProfile;
      }

      if (!userRecord?.team_id) {
        throw new Error('User team not found');
      }

      // Create default organization
      const { data: newOrganization, error: orgError } = await supabase
        .from('organizations')
        .insert({
          name: 'My Requirements Workspace',
          description: 'Initial requirements workbench',
          team_id: userRecord.team_id,
          user_id: user.id,
          status: 'draft',
          due_date: null,
        })
        .select('id')
        .single();

      if (orgError) {
        console.error('Organization creation error:', orgError);
        throw new Error(`Failed to create default organization: ${orgError.message}`);
      }

      if (newOrganization) {
        console.log('Default organization created:', newOrganization.id);
      }
    } catch (error) {
      console.error('Error in createDefaultOrganization:', error);
      throw error;
    }
  };

  const handleOrganizationCreated = async (organizationId: string) => {
    // Reload requirement documents list to include the new item
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (user) {
        const { data: organizationsData } = await supabase
          .from('organizations')
          .select('*')
          .order('created_at', { ascending: false });

        setOrganizations((organizationsData as unknown as RequirementDocument[]) || []);
      }
    } catch (error) {
      console.error('Error reloading organizations:', error);
    }
    router.push(`/app/organizations/${organizationId}/requirements`);
  };

  const handleViewGuidelines = () => {
    window.open('https://www.rtca.org/content/do-160', '_blank');
  };

  const handleDeleteOrganization = (organization: RequirementDocument) => {
    setOrganizationToDelete(organization);
    setShowDeleteModal(true);
  };

  const confirmDeleteOrganization = async () => {
    if (!organizationToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/organizations/${organizationToDelete.id}/delete`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete organization');
      }

      // Remove the organization from the local state
      setOrganizations(organizations.filter(o => o.id !== organizationToDelete.id));
      setShowDeleteModal(false);
      setOrganizationToDelete(null);
    } catch (error) {
      console.error('Error deleting organization:', error);
      throw error; // Re-throw to be handled by the modal
    } finally {
      setIsDeleting(false);
    }
  };

  const handleRunComplianceCheck = async () => {
    try {
      // This would trigger a full compliance check across all sections
      alert('Open a requirement document to run the guided SOW linking flow.');
    } catch (error) {
      console.error('Error running compliance check:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Defense Requirements Workbench
        </h1>
        <p className="text-lg text-gray-600 max-w-4xl mx-auto mb-6">
          Upload standards documents and link requirement evidence directly into your draft SOW.
          Build a traceable first-pass response in minutes with chunking, embeddings, and section-level citations.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 max-w-4xl mx-auto">
          <h2 className="text-xl font-semibold text-blue-900 mb-3">How It Works</h2>
          <div className="text-left text-gray-700 space-y-2">
            <p><strong>1. Requirements Ingestion:</strong> Upload standards docs and chunk them into searchable requirement units.</p>
            <p><strong>2. Template Parsing:</strong> Upload or paste a draft SOW/template and split it into editable sections.</p>
            <p><strong>3. Semantic Linking:</strong> Match each section to relevant requirement chunks with confidence scores.</p>
            <p><strong>4. Traceable Editing:</strong> Review citations beside each section while iterating on your final text.</p>
          </div>
        </div>
      </div>

      {/* Requirement Documents Overview */}
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-semibold">Your Requirement Documents</h2>
          <Button onClick={() => setShowCreateModal(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Requirement Document
          </Button>
        </div>

        {organizations.length === 0 ? (
          <Card>
            <CardContent className="text-center py-12">
              <Target className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Requirement Documents Yet</h3>
              <p className="text-gray-600 mb-6">
                Create your first requirement document to start the guided upload and linking flow.
              </p>
              <Button onClick={() => setShowCreateModal(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create First Requirement Document
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {organizations.map((organization) => {
              const status = organization.status ?? 'draft';
              const statusLabel = status.replace(/_/g, ' ');
              return (
              <Card key={organization.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-3">
                      <FileText className="h-6 w-6 text-blue-600" />
                      <div>
                        <CardTitle className="text-lg">{organization.name}</CardTitle>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`px-2 py-1 rounded-full text-xs font-medium ${
                        status === 'completed' ? 'bg-green-100 text-green-800' :
                        status === 'in_progress' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {statusLabel}
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          handleDeleteOrganization(organization);
                        }}
                        className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <p className="text-sm text-gray-600 mb-4">
                    {organization.description || 'Requirements workbench'}
                  </p>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs text-gray-500">
                      <span>Status: {statusLabel}</span>
                      {organization.due_date && (
                        <span>Due: {new Date(organization.due_date).toLocaleDateString()}</span>
                      )}
                    </div>
                    <Link href={`/app/organizations/${organization.id}/requirements`}>
                      <Button className="w-full" variant="outline">
                        <span>Open Workflow</span>
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                    <Link href={`/app/organizations/${organization.id}/history`}>
                      <Button className="w-full" variant="outline">
                        <span>View SOW History</span>
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <Button variant="outline" onClick={() => setShowCreateModal(true)}>
              <Plus className="mr-2 h-4 w-4" />
              New Requirement Document
            </Button>
            <Button variant="outline" onClick={handleViewGuidelines}>
              <FileText className="mr-2 h-4 w-4" />
              View DO-160 Overview
            </Button>
            <Button
              variant="outline"
              onClick={handleRunComplianceCheck}
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              Run Guided SOW Linking
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Create Organization Modal */}
      <CreateOrganizationModal
        open={showCreateModal}
        onOpenChange={setShowCreateModal}
        onOrganizationCreated={handleOrganizationCreated}
      />

      {/* Delete Organization Modal */}
      {organizationToDelete && (
        <DeleteOrganizationModal
          isOpen={showDeleteModal}
          onClose={() => {
            setShowDeleteModal(false);
            setOrganizationToDelete(null);
          }}
          onConfirm={confirmDeleteOrganization}
          organizationName={organizationToDelete.name}
          isDeleting={isDeleting}
        />
      )}
    </div>
  );
}
