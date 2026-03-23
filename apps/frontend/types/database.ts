export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      teams: {
        Row: { id: string; name: string; owner_id: string; username: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; owner_id: string; username?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; owner_id?: string; username?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      users: {
        Row: { id: string; email: string; team_id: string | null; role: string; created_at: string; updated_at: string };
        Insert: { id: string; email: string; team_id?: string | null; role?: string; created_at?: string; updated_at?: string };
        Update: { id?: string; email?: string; team_id?: string | null; role?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      organizations: {
        Row: { id: string; team_id: string; user_id: string; name: string; description: string | null; status: string; due_date: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; team_id: string; user_id: string; name: string; description?: string | null; status?: string; due_date?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; team_id?: string; user_id?: string; name?: string; description?: string | null; status?: string; due_date?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      projects: {
        Row: { id: string; organization_id: string; user_id: string; name: string; description: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; user_id: string; name: string; description?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; organization_id?: string; user_id?: string; name?: string; description?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      team_invitations: {
        Row: { id: string; team_id: string; email: string; status: string; created_at: string };
        Insert: { id?: string; team_id: string; email: string; status?: string; created_at?: string };
        Update: { id?: string; team_id?: string; email?: string; status?: string; created_at?: string };
        Relationships: [];
      };
      email_waitlist: {
        Row: { id: string; email: string; source: string | null; metadata: Json | null; created_at: string };
        Insert: { id?: string; email: string; source?: string | null; metadata?: Json | null; created_at?: string };
        Update: { id?: string; email?: string; source?: string | null; metadata?: Json | null; created_at?: string };
        Relationships: [];
      };
      requirements_documents: {
        Row: { id: string; organization_id: string; uploaded_by: string; title: string; source_type: string; source_name: string | null; raw_text: string; metadata: Json; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; uploaded_by: string; title: string; source_type?: string; source_name?: string | null; raw_text: string; metadata?: Json; created_at?: string; updated_at?: string };
        Update: { id?: string; organization_id?: string; uploaded_by?: string; title?: string; source_type?: string; source_name?: string | null; raw_text?: string; metadata?: Json; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      requirements_chunks: {
        Row: { id: string; organization_id: string; requirements_document_id: string; chunk_index: number; chunk_text: string; embedding: string | null; metadata: Json; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; requirements_document_id: string; chunk_index: number; chunk_text: string; embedding?: string | null; metadata?: Json; created_at?: string; updated_at?: string };
        Update: { id?: string; organization_id?: string; requirements_document_id?: string; chunk_index?: number; chunk_text?: string; embedding?: string | null; metadata?: Json; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      work_documents: {
        Row: { id: string; organization_id: string; uploaded_by: string; title: string; raw_text: string; metadata: Json; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; uploaded_by: string; title: string; raw_text: string; metadata?: Json; created_at?: string; updated_at?: string };
        Update: { id?: string; organization_id?: string; uploaded_by?: string; title?: string; raw_text?: string; metadata?: Json; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      work_sections: {
        Row: { id: string; organization_id: string; work_document_id: string; section_key: string; section_title: string; content: string; section_order: number; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id: string; work_document_id: string; section_key: string; section_title: string; content: string; section_order?: number; created_at?: string; updated_at?: string };
        Update: { id?: string; organization_id?: string; work_document_id?: string; section_key?: string; section_title?: string; content?: string; section_order?: number; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      section_requirement_links: {
        Row: { id: string; organization_id: string; work_section_id: string; requirements_chunk_id: string; similarity: number; rationale: string | null; created_at: string };
        Insert: { id?: string; organization_id: string; work_section_id: string; requirements_chunk_id: string; similarity: number; rationale?: string | null; created_at?: string };
        Update: { id?: string; organization_id?: string; work_section_id?: string; requirements_chunk_id?: string; similarity?: number; rationale?: string | null; created_at?: string };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      get_team_members: { Args: Record<string, never>; Returns: { user_id: string; email: string; role: string }[] };
      match_requirements_chunks: {
        Args: { query_embedding: string; query_organization_id: string; min_similarity?: number; match_count?: number };
        Returns: { id: string; requirements_document_id: string; chunk_index: number; chunk_text: string; metadata: Json; similarity: number }[];
      };
      team_create_no_password: { Args: { p_name: string }; Returns: Json };
      team_accept_invite: { Args: { p_invite_id: string }; Returns: Json };
      org_decline_invite: { Args: { p_invite_id: string }; Returns: Json };
      team_invite: { Args: { p_team: string; p_email: string }; Returns: Json };
      team_join: { Args: { p_username: string; p_password: string }; Returns: Json };
      team_leave: { Args: Record<string, never>; Returns: Json };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
