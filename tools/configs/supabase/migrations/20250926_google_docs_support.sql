-- Google Docs integration support
-- Add tables for Google OAuth tokens and document tracking

-- Google OAuth tokens table
CREATE TABLE IF NOT EXISTS public.google_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    token_data JSONB NOT NULL,
    scopes TEXT[] DEFAULT ARRAY[]::TEXT[],
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one token record per user
    UNIQUE(user_id)
);

-- Google documents table - tracks linked Google Docs
CREATE TABLE IF NOT EXISTS public.google_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    section_key TEXT, -- Which grant section this doc is for
    
    -- Google Doc details
    google_doc_id TEXT NOT NULL, -- The Google Doc file ID
    title TEXT NOT NULL,
    last_modified TIMESTAMP WITH TIME ZONE,
    last_synced TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Content cache
    text_content TEXT,
    word_count INTEGER DEFAULT 0,
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes for performance
    UNIQUE(user_id, google_doc_id), -- One record per user per doc
    INDEX(project_id, section_key), -- Fast lookup by project/section
    INDEX(user_id, project_id) -- Fast lookup by user/project
);

-- Comments tracking table - track comments posted to Google Docs
CREATE TABLE IF NOT EXISTS public.google_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    google_document_id UUID NOT NULL REFERENCES public.google_documents(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
    
    -- Comment details
    google_comment_id TEXT NOT NULL, -- The actual comment ID from Google
    content TEXT NOT NULL,
    anchor_text TEXT, -- Text the comment is anchored to (if any)
    
    -- AI generation context
    generated_by_ai BOOLEAN DEFAULT TRUE,
    ai_feedback_id UUID REFERENCES public.ai_feedback(id) ON DELETE SET NULL,
    requirement_result_id UUID REFERENCES public.requirement_results(id) ON DELETE SET NULL,
    
    -- Status tracking
    status TEXT DEFAULT 'posted' CHECK (status IN ('draft', 'posted', 'resolved', 'deleted')),
    posted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Metadata
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Indexes
    INDEX(google_document_id),
    INDEX(user_id, project_id),
    INDEX(status)
);

-- Update existing grant_sections table to support Google Docs
ALTER TABLE IF EXISTS public.grant_sections 
ADD COLUMN IF NOT EXISTS google_document_id UUID REFERENCES public.google_documents(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS document_source TEXT DEFAULT 'pdf' CHECK (document_source IN ('pdf', 'google_doc', 'text'));

-- Row Level Security policies

-- Google tokens - users can only access their own tokens
ALTER TABLE public.google_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_tokens_user_access" ON public.google_tokens;
CREATE POLICY "google_tokens_user_access" 
ON public.google_tokens FOR ALL 
TO authenticated 
USING (user_id = auth.uid()) 
WITH CHECK (user_id = auth.uid());

-- Google documents - users can only access their own documents
ALTER TABLE public.google_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_documents_user_access" ON public.google_documents;
CREATE POLICY "google_documents_user_access" 
ON public.google_documents FOR ALL 
TO authenticated 
USING (user_id = auth.uid()) 
WITH CHECK (user_id = auth.uid());

-- Google comments - users can only access their own comments
ALTER TABLE public.google_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "google_comments_user_access" ON public.google_comments;
CREATE POLICY "google_comments_user_access" 
ON public.google_comments FOR ALL 
TO authenticated 
USING (user_id = auth.uid()) 
WITH CHECK (user_id = auth.uid());

-- Triggers for updated_at timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_google_tokens_updated_at ON public.google_tokens;
CREATE TRIGGER update_google_tokens_updated_at 
    BEFORE UPDATE ON public.google_tokens 
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_google_documents_updated_at ON public.google_documents;
CREATE TRIGGER update_google_documents_updated_at 
    BEFORE UPDATE ON public.google_documents 
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_google_comments_updated_at ON public.google_comments;
CREATE TRIGGER update_google_comments_updated_at 
    BEFORE UPDATE ON public.google_comments 
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_google_tokens_user_id ON public.google_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_google_tokens_expires_at ON public.google_tokens(expires_at);

CREATE INDEX IF NOT EXISTS idx_google_documents_user_project ON public.google_documents(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_google_documents_google_doc_id ON public.google_documents(google_doc_id);
CREATE INDEX IF NOT EXISTS idx_google_documents_last_synced ON public.google_documents(last_synced);

CREATE INDEX IF NOT EXISTS idx_google_comments_document_id ON public.google_comments(google_document_id);
CREATE INDEX IF NOT EXISTS idx_google_comments_user_project ON public.google_comments(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_google_comments_status ON public.google_comments(status);

-- Grant sections index for new column
CREATE INDEX IF NOT EXISTS idx_grant_sections_google_document_id ON public.grant_sections(google_document_id);
CREATE INDEX IF NOT EXISTS idx_grant_sections_document_source ON public.grant_sections(document_source);
