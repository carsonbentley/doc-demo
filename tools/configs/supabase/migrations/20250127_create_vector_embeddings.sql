-- Create vector embeddings table for RAG functionality
-- This table stores document chunks with vector embeddings for semantic search

-- Enable the pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the document_embeddings table
CREATE TABLE IF NOT EXISTS public.document_embeddings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL, -- Google Drive document ID or file identifier
    document_title TEXT NOT NULL,
    document_type TEXT NOT NULL, -- 'google_doc', 'pdf', 'text', etc.
    chunk_index INTEGER NOT NULL, -- Order of chunk within document
    chunk_text TEXT NOT NULL, -- The actual text content of the chunk
    chunk_metadata JSONB DEFAULT '{}', -- Additional metadata (page numbers, sections, etc.)
    embedding VECTOR(1536), -- OpenAI ada-002 embeddings (1536 dimensions)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_document_embeddings_organization_id ON public.document_embeddings(organization_id);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_team_id ON public.document_embeddings(team_id);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_id ON public.document_embeddings(document_id);
CREATE INDEX IF NOT EXISTS idx_document_embeddings_document_type ON public.document_embeddings(document_type);

-- Create vector similarity search index using ivfflat
-- This enables fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_document_embeddings_vector_cosine 
ON public.document_embeddings 
USING ivfflat (embedding vector_cosine_ops) 
WITH (lists = 100);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_document_embeddings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_document_embeddings_updated_at
    BEFORE UPDATE ON public.document_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION update_document_embeddings_updated_at();

-- Create RLS policies for multi-tenancy
ALTER TABLE public.document_embeddings ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access embeddings from organizations they belong to
CREATE POLICY "Users can access embeddings from their organizations" ON public.document_embeddings
    FOR ALL USING (
        team_id IN (
            SELECT u.team_id 
            FROM public.users u
            WHERE u.id = auth.uid()
        )
    );

-- Create a function for semantic search
CREATE OR REPLACE FUNCTION search_document_embeddings(
    query_embedding VECTOR(1536),
    organization_id_param UUID,
    similarity_threshold FLOAT DEFAULT 0.7,
    max_results INTEGER DEFAULT 10
)
RETURNS TABLE (
    id UUID,
    organization_id UUID,
    document_id TEXT,
    document_title TEXT,
    document_type TEXT,
    chunk_index INTEGER,
    chunk_text TEXT,
    chunk_metadata JSONB,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        de.id,
        de.organization_id,
        de.document_id,
        de.document_title,
        de.document_type,
        de.chunk_index,
        de.chunk_text,
        de.chunk_metadata,
        1 - (de.embedding <=> query_embedding) AS similarity
    FROM public.document_embeddings de
    WHERE de.organization_id = organization_id_param
        AND 1 - (de.embedding <=> query_embedding) > similarity_threshold
    ORDER BY de.embedding <=> query_embedding
    LIMIT max_results;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create a function to get document statistics
CREATE OR REPLACE FUNCTION get_organization_document_stats(org_id UUID)
RETURNS TABLE (
    total_documents BIGINT,
    total_chunks BIGINT,
    document_types JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT de.document_id) as total_documents,
        COUNT(de.id) as total_chunks,
        jsonb_object_agg(de.document_type, type_count) as document_types
    FROM (
        SELECT 
            de.document_type,
            COUNT(*) as type_count
        FROM public.document_embeddings de
        WHERE de.organization_id = org_id
        GROUP BY de.document_type
    ) type_counts
    CROSS JOIN public.document_embeddings de
    WHERE de.organization_id = org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant necessary permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION search_document_embeddings TO authenticated;
GRANT EXECUTE ON FUNCTION get_organization_document_stats TO authenticated;
