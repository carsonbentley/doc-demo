# Google Docs Integration Setup Guide

This guide walks you through setting up and using the improved Google Docs integration.

## Prerequisites

- Supabase project with database access
- Google Cloud Console project with OAuth credentials
- Python 3.9+ for backend
- Node.js 18+ for frontend

## Step 1: Database Setup ✅ COMPLETE

The following database changes have been applied to your Supabase project:

### PDF Caching
- ✅ Added `cached_pdf_url`, `cached_pdf_size_bytes`, `cached_pdf_at`, `pdf_cache_valid` columns
- ✅ Created index for cache lookups
- ✅ Added trigger to invalidate cache on document updates

### Token Encryption
- ✅ Enabled `pgcrypto` extension
- ✅ Added `access_token_encrypted`, `refresh_token_encrypted` columns
- ✅ Created `encrypt_token()` and `decrypt_token()` functions
- ✅ Granted permissions to authenticated users

## Step 2: Environment Variables

Add these to your backend `.env` file:

```bash
# Existing Google OAuth credentials
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# NEW: Token encryption key (REQUIRED for security)
# Generate a strong random key: openssl rand -base64 32
GOOGLE_TOKEN_ENCRYPTION_KEY=your_32_character_or_longer_encryption_key_here
```

### Generating a Secure Encryption Key

```bash
# On macOS/Linux
openssl rand -base64 32

# Or use Python
python3 -c "import secrets; print(secrets.token_urlsafe(32))"
```

**IMPORTANT:** 
- Store this key securely (use a secrets manager in production)
- Never commit it to version control
- If you lose this key, all encrypted tokens become unrecoverable
- Rotate this key periodically (requires re-encrypting all tokens)

## Step 3: Backend Code Changes ✅ COMPLETE

The following improvements have been implemented:

### Security Improvements
1. ✅ Removed client credentials from token storage
2. ✅ Implemented automatic token refresh
3. ✅ Added token encryption infrastructure
4. ✅ Improved error handling for expired/revoked tokens

### PDF Export
1. ✅ Added `export_as_pdf()` method to GoogleDocsService
2. ✅ Created `/document/{id}/export-pdf` endpoint
3. ✅ Created `/document/{id}/run-checks` endpoint

### Helper Functions
1. ✅ Added `ensure_valid_token()` for automatic refresh
2. ✅ Added `get_valid_credentials()` helper for all endpoints

## Step 4: Testing the Integration

### Test 1: Token Refresh

```bash
# Make an API call with an expired token
curl -X GET "http://localhost:8000/v1/google/document/YOUR_DOC_ID?user_id=YOUR_USER_ID"

# Should automatically refresh and succeed
```

### Test 2: PDF Export

```bash
# Export a Google Doc as PDF
curl -X GET "http://localhost:8000/v1/google/document/YOUR_DOC_ID/export-pdf?user_id=YOUR_USER_ID" \
  -o exported.pdf

# Verify the PDF was created
open exported.pdf
```

### Test 3: Run Checks on Google Doc

```bash
# Run compliance checks on a Google Doc
curl -X POST "http://localhost:8000/v1/google/document/YOUR_DOC_ID/run-checks?user_id=YOUR_USER_ID&project_id=YOUR_PROJECT_ID&section_key=project_summary"

# Should return check results
```

## Step 5: Frontend Integration

### Update API Calls

```typescript
// Example: Run checks on Google Doc
const runChecksOnGoogleDoc = async (
  documentId: string,
  userId: string,
  projectId: string,
  sectionKey: string
) => {
  const response = await fetch(
    `${API_URL}/v1/google/document/${documentId}/run-checks?` +
    `user_id=${userId}&project_id=${projectId}&section_key=${sectionKey}`,
    { method: 'POST' }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Failed to run checks');
  }
  
  return await response.json();
};

// Example: Export Google Doc as PDF
const exportGoogleDocAsPDF = async (
  documentId: string,
  userId: string
) => {
  const response = await fetch(
    `${API_URL}/v1/google/document/${documentId}/export-pdf?user_id=${userId}`
  );
  
  if (!response.ok) {
    throw new Error('Failed to export PDF');
  }
  
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  
  // Download the PDF
  const a = document.createElement('a');
  a.href = url;
  a.download = `document_${documentId}.pdf`;
  a.click();
};
```

### Handle Token Expiration

```typescript
// The backend now automatically refreshes tokens
// But you should handle 401 errors by prompting re-authorization

const handleAPIError = (error: any) => {
  if (error.status === 401) {
    // Token expired or revoked
    alert('Your Google authorization has expired. Please re-authorize.');
    // Redirect to authorization flow
    window.location.href = '/auth/google';
  }
};
```

## Step 6: Monitoring & Maintenance

### Check Token Health

```sql
-- View token expiry status
SELECT 
  user_id,
  expires_at,
  CASE 
    WHEN expires_at < NOW() THEN 'Expired'
    WHEN expires_at < NOW() + INTERVAL '5 minutes' THEN 'Expiring Soon'
    ELSE 'Valid'
  END as status
FROM google_tokens
ORDER BY expires_at;
```

### Check PDF Cache Status

```sql
-- View PDF cache statistics
SELECT 
  COUNT(*) as total_docs,
  COUNT(cached_pdf_url) as cached_docs,
  COUNT(CASE WHEN pdf_cache_valid THEN 1 END) as valid_cache,
  ROUND(100.0 * COUNT(cached_pdf_url) / COUNT(*), 2) as cache_percentage
FROM google_documents;
```

### Monitor API Usage

```sql
-- Track document access patterns
SELECT 
  google_doc_id,
  title,
  last_synced,
  cached_pdf_at,
  pdf_cache_valid
FROM google_documents
ORDER BY last_synced DESC
LIMIT 20;
```

## Common Issues & Solutions

### Issue: "No Google authorization found"

**Cause:** User hasn't authorized Google Docs access or tokens were deleted.

**Solution:**
```typescript
// Redirect user to authorization flow
const authUrl = await fetch(
  `${API_URL}/v1/google/auth/url?user_id=${userId}`
).then(r => r.json());

window.location.href = authUrl.authorization_url;
```

### Issue: "Failed to export document as PDF"

**Causes:**
1. Document doesn't exist or user doesn't have access
2. API quota exceeded
3. Network timeout for large documents

**Solutions:**
```typescript
try {
  const pdf = await exportGoogleDocAsPDF(docId, userId);
} catch (error) {
  if (error.message.includes('quota exceeded')) {
    // Wait and retry
    await new Promise(r => setTimeout(r, 60000));
    return exportGoogleDocAsPDF(docId, userId);
  } else if (error.message.includes('not found')) {
    // Document doesn't exist
    alert('Document not found. Please check the link.');
  } else {
    // Other error
    console.error('Export failed:', error);
  }
}
```

### Issue: Token refresh fails

**Cause:** Refresh token is invalid or revoked.

**Solution:**
```sql
-- Clean up invalid tokens
DELETE FROM google_tokens 
WHERE user_id = 'USER_ID';
```

Then prompt user to re-authorize.

## Security Best Practices

### 1. Encryption Key Management

```bash
# Production: Use a secrets manager
# AWS Secrets Manager
aws secretsmanager get-secret-value --secret-id google-token-encryption-key

# Google Secret Manager
gcloud secrets versions access latest --secret="google-token-encryption-key"

# Azure Key Vault
az keyvault secret show --name google-token-encryption-key --vault-name your-vault
```

### 2. Key Rotation

When rotating the encryption key:

1. Generate new key
2. Decrypt all tokens with old key
3. Re-encrypt with new key
4. Update environment variable
5. Restart application

```python
# Example key rotation script
def rotate_encryption_key(old_key: str, new_key: str):
    tokens = supabase.table('google_tokens').select('*').execute()
    
    for token in tokens.data:
        # Decrypt with old key
        access_token = decrypt_token(token['access_token_encrypted'], old_key)
        refresh_token = decrypt_token(token['refresh_token_encrypted'], old_key)
        
        # Re-encrypt with new key
        new_access = encrypt_token(access_token, new_key)
        new_refresh = encrypt_token(refresh_token, new_key)
        
        # Update database
        supabase.table('google_tokens').update({
            'access_token_encrypted': new_access,
            'refresh_token_encrypted': new_refresh
        }).eq('id', token['id']).execute()
```

### 3. Audit Logging

```sql
-- Create audit log table
CREATE TABLE IF NOT EXISTS google_token_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    action TEXT NOT NULL, -- 'created', 'refreshed', 'revoked'
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT
);

-- Enable RLS
ALTER TABLE google_token_audit ENABLE ROW LEVEL SECURITY;

-- Create policy
CREATE POLICY "Users can view their own audit logs"
ON google_token_audit FOR SELECT
TO authenticated
USING (user_id = auth.uid());
```

## Performance Optimization

### Enable PDF Caching

The caching infrastructure is in place. To use it:

1. Store exported PDFs in Supabase Storage
2. Update `cached_pdf_url` with storage URL
3. Set `pdf_cache_valid = TRUE`
4. Cache is automatically invalidated when document changes

```python
# Example caching implementation
def get_or_export_pdf(document_id: str, user_id: str) -> bytes:
    # Check cache
    doc = supabase.table('google_documents').select('*').eq(
        'google_doc_id', document_id
    ).single().execute()
    
    if doc.data and doc.data['pdf_cache_valid']:
        # Return cached PDF
        pdf_url = doc.data['cached_pdf_url']
        return download_from_storage(pdf_url)
    
    # Export new PDF
    pdf_content = docs_service.export_as_pdf(document_id)
    
    # Store in cache
    pdf_url = upload_to_storage(pdf_content, f"{document_id}.pdf")
    
    supabase.table('google_documents').update({
        'cached_pdf_url': pdf_url,
        'cached_pdf_at': 'NOW()',
        'cached_pdf_size_bytes': len(pdf_content),
        'pdf_cache_valid': True
    }).eq('google_doc_id', document_id).execute()
    
    return pdf_content
```

## Next Steps

1. ✅ Database migrations applied
2. ✅ Backend code updated
3. ⏳ Set `GOOGLE_TOKEN_ENCRYPTION_KEY` environment variable
4. ⏳ Test token refresh flow
5. ⏳ Test PDF export
6. ⏳ Test running checks on Google Docs
7. ⏳ Update frontend to use new endpoints
8. ⏳ Implement PDF caching logic
9. ⏳ Set up monitoring and alerts
10. ⏳ Document for team

## Support

For issues or questions:
1. Check error logs in application
2. Review Supabase logs for database errors
3. Check Google API Console for quota/errors
4. Refer to `docs/GOOGLE_DOCS_IMPROVEMENTS.md` for detailed documentation

