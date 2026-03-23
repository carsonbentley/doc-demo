# Google Docs Integration - Quick Start Guide

## TL;DR - What Changed?

✅ **Security:** Tokens auto-refresh, encryption ready, client credentials secured  
✅ **Functionality:** Google Docs export as PDF, run same checks as PDF uploads  
✅ **Performance:** Caching infrastructure ready  
✅ **Documentation:** Comprehensive guides created  

## What You Need to Do Now

### 1. Backend Developers (5 minutes)

```bash
# 1. Generate encryption key
openssl rand -base64 32

# 2. Add to .env file
echo "GOOGLE_TOKEN_ENCRYPTION_KEY=<your_generated_key>" >> ai-api/.env

# 3. Restart backend
cd ai-api
python -m uvicorn agent_api.main:app --reload
```

### 2. Frontend Developers (10 minutes)

```typescript
// New endpoint: Run checks on Google Doc
const results = await fetch(
  `${API_URL}/v1/google/document/${docId}/run-checks?` +
  `user_id=${userId}&project_id=${projectId}&section_key=${sectionKey}`,
  { method: 'POST' }
).then(r => r.json());

// New endpoint: Export as PDF
const response = await fetch(
  `${API_URL}/v1/google/document/${docId}/export-pdf?user_id=${userId}`
);
const blob = await response.blob();
```

### 3. DevOps (2 minutes)

```bash
# Add to production environment variables
GOOGLE_TOKEN_ENCRYPTION_KEY=<secure_key_from_secrets_manager>
```

## New API Endpoints

### 1. Export Google Doc as PDF
```
GET /v1/google/document/{document_id}/export-pdf?user_id={user_id}
```
**Returns:** PDF file

### 2. Run Checks on Google Doc
```
POST /v1/google/document/{document_id}/run-checks
  ?user_id={user_id}
  &project_id={project_id}
  &section_key={section_key}
  &requirement_types={optional}
```
**Returns:** Same format as PDF upload checks

## What's Automatic Now?

✅ **Token Refresh** - Tokens automatically refresh before expiring  
✅ **Cache Invalidation** - PDF cache invalidates when document changes  
✅ **Error Handling** - Better error messages for expired/revoked tokens  

## Database Changes Applied

✅ Added PDF caching columns to `google_documents`  
✅ Added encrypted token columns to `google_tokens`  
✅ Created encryption/decryption functions  
✅ Added triggers for cache invalidation  

## Testing

```bash
# Test PDF export
curl -X GET "http://localhost:8000/v1/google/document/YOUR_DOC_ID/export-pdf?user_id=YOUR_USER_ID" -o test.pdf

# Test checks
curl -X POST "http://localhost:8000/v1/google/document/YOUR_DOC_ID/run-checks?user_id=YOUR_USER_ID&project_id=YOUR_PROJECT_ID&section_key=project_summary"
```

## Common Issues

### "No Google authorization found"
→ User needs to authorize: `/v1/google/auth/url`

### "Failed to export document"
→ Check document permissions and API quota

### Token refresh fails
→ User needs to re-authorize

## Full Documentation

- **Technical Details:** `docs/GOOGLE_DOCS_IMPROVEMENTS.md`
- **Setup Guide:** `docs/SETUP_GOOGLE_DOCS.md`
- **Implementation Summary:** `docs/IMPLEMENTATION_SUMMARY.md`

## Questions?

Check the docs above or contact the development team.

---

**Status:** ✅ Core implementation complete, ready for testing and integration

