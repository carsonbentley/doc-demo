-- Add PDF caching support for Google Docs
-- This allows us to cache exported PDFs to avoid re-exporting unchanged documents

-- Add caching columns to google_documents table
ALTER TABLE IF EXISTS public.google_documents 
ADD COLUMN IF NOT EXISTS cached_pdf_url TEXT,
ADD COLUMN IF NOT EXISTS cached_pdf_size_bytes INTEGER,
ADD COLUMN IF NOT EXISTS cached_pdf_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS pdf_cache_valid BOOLEAN DEFAULT FALSE;

-- Add index for cache lookups
CREATE INDEX IF NOT EXISTS idx_google_documents_cache_valid 
ON public.google_documents(google_doc_id, pdf_cache_valid) 
WHERE pdf_cache_valid = TRUE;

-- Add comment explaining the caching strategy
COMMENT ON COLUMN public.google_documents.cached_pdf_url IS 
'URL to cached PDF in Supabase Storage. NULL if not cached.';

COMMENT ON COLUMN public.google_documents.cached_pdf_at IS 
'Timestamp when PDF was last cached. Compare with last_modified to determine if cache is stale.';

COMMENT ON COLUMN public.google_documents.pdf_cache_valid IS 
'Whether the cached PDF is still valid. Set to FALSE when document is modified.';

-- Function to invalidate cache when document is modified
CREATE OR REPLACE FUNCTION public.invalidate_google_doc_pdf_cache()
RETURNS TRIGGER AS $$
BEGIN
    -- If last_modified changed, invalidate the PDF cache
    IF NEW.last_modified IS DISTINCT FROM OLD.last_modified THEN
        NEW.pdf_cache_valid = FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically invalidate cache on document update
DROP TRIGGER IF EXISTS invalidate_pdf_cache_on_update ON public.google_documents;
CREATE TRIGGER invalidate_pdf_cache_on_update
    BEFORE UPDATE ON public.google_documents
    FOR EACH ROW
    EXECUTE FUNCTION public.invalidate_google_doc_pdf_cache();

