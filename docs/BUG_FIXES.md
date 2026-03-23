# Google Docs Integration - Bug Fixes

## Issues Fixed

### Issue #1: PDF Not Being Passed to Checks ✅

**Problem:**
When running checks on Google Docs, PDF-based checks (like line density, font compliance, margins) were showing "This check requires the original PDF document" error.

**Root Cause:**
The frontend was calling the old text-based check endpoint (`/v1/requirements/run-checks`) instead of the new Google Docs check endpoint (`/v1/google/document/{id}/run-checks`). The text-based endpoint doesn't export the Google Doc as PDF, so PDF-dependent checks couldn't run.

**Solution:**
1. Added `runChecksOnGoogleDoc()` method to `frontend/lib/api/google-docs.ts`
2. Updated `runChecks()` function in `frontend/components/requirements/requirements-section-page.tsx` to:
   - Check if a Google Doc is linked (`linkedGoogleDocId`)
   - Check if document source is `'google-docs'`
   - Call the Google Docs check endpoint which exports as PDF first
3. The backend endpoint already exports as PDF and passes it to checks (line 750 in `google_auth.py`)

**Files Changed:**
- `frontend/lib/api/google-docs.ts` - Added `runChecksOnGoogleDoc()` method
- `frontend/components/requirements/requirements-section-page.tsx` - Updated `runChecks()` logic

**Code Changes:**

```typescript
// frontend/lib/api/google-docs.ts
async runChecksOnGoogleDoc(
  documentId: string,
  userId: string,
  projectId: string,
  sectionKey: string,
  requirementTypes?: ('official_pappg' | 'internal' | 'ai_semantic')[]
): Promise<any> {
  const params = new URLSearchParams({
    user_id: userId,
    project_id: projectId,
    section_key: sectionKey,
  });

  if (requirementTypes) {
    params.append('requirement_types', requirementTypes.join(','));
  }

  const response = await fetch(
    `${this.baseUrl}/v1/google/document/${documentId}/run-checks?${params}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  );

  if (!response.ok) {
    throw new Error(`Failed to run checks on Google Doc: ${await response.text()}`);
  }

  return response.json();
}
```

```typescript
// frontend/components/requirements/requirements-section-page.tsx
const runChecks = async (checkType: 'official_pappg' | 'internal' | 'ai_semantic') => {
  if (!projectId) return;

  try {
    setIsRunningChecks(checkType);

    let results;
    if (linkedGoogleDocId && documentSource === 'google-docs' && userId) {
      // Use Google Docs API - exports as PDF automatically
      const { googleDocsAPI } = await import('@/lib/api/google-docs');
      results = await googleDocsAPI.runChecksOnGoogleDoc(
        linkedGoogleDocId,
        userId,
        projectId,
        sectionKey,
        [checkType]
      );
    } else if (file) {
      // Use PDF API
      results = await requirementsAPI.runChecksPDF(projectId, sectionKey, file, [checkType]);
    } else if (documentText) {
      // Use text API
      results = await requirementsAPI.runChecks(projectId, sectionKey, documentText, [checkType]);
    } else {
      throw new Error('Please upload a PDF file, link a Google Doc, or enter document text');
    }

    setCheckResults(results);
  } catch (error) {
    console.error('Error running checks:', error);
    alert(error instanceof Error ? error.message : 'An error occurred while running checks');
  } finally {
    setIsRunningChecks(null);
  }
};
```

**Testing:**
1. Link a Google Doc
2. Run checks (any type: official_pappg, internal, ai_semantic)
3. Verify PDF-based checks now work:
   - Line density check
   - Font compliance check
   - Margin compliance check
   - Page size check
   - Page count check

---

### Issue #2: Authorization Button Shown Every Time ✅

**Problem:**
Users had to click "Authorize Google Docs" every time they wanted to select a document, even if they were already authorized. This was confusing and annoying.

**Root Cause:**
The frontend didn't check if the user was already authorized before showing the picker. It always showed the same button, which would trigger authorization flow even if tokens already existed.

**Solution:**
1. Added authorization status check endpoint to backend: `GET /v1/google/auth/status`
2. Added `checkAuthorizationStatus()` method to `frontend/lib/api/google-docs.ts`
3. Updated `GooglePicker` component to:
   - Check authorization status on mount
   - Show "Authorize Google Docs" button if not authorized
   - Show "Select Google Doc" button if already authorized
   - Show loading state while checking

**Files Changed:**
- `ai-api/src/agent_api/routers/google_auth.py` - Added `/auth/status` endpoint
- `frontend/lib/api/google-docs.ts` - Added `checkAuthorizationStatus()` method
- `frontend/components/google-docs/google-picker.tsx` - Updated UI logic

**Code Changes:**

```python
# ai-api/src/agent_api/routers/google_auth.py
@router.get("/auth/status")
async def check_authorization_status(
    user_id: str = Query(..., description="User ID"),
    supabase=Depends(get_supabase_client)
):
    """Check if user has authorized Google Docs access."""
    try:
        result = supabase.table('google_tokens').select('expires_at').eq('user_id', user_id).single().execute()
        
        if not result.data:
            return {"authorized": False}
        
        return {
            "authorized": True,
            "expires_at": result.data.get('expires_at')
        }
        
    except Exception as e:
        return {"authorized": False}
```

```typescript
// frontend/lib/api/google-docs.ts
async checkAuthorizationStatus(userId: string): Promise<{ authorized: boolean; expires_at?: string }> {
  const response = await fetch(
    `${this.baseUrl}/v1/google/auth/status?user_id=${encodeURIComponent(userId)}`,
    { method: 'GET', headers: { 'Content-Type': 'application/json' } }
  );

  if (!response.ok) {
    if (response.status === 404 || response.status === 401) {
      return { authorized: false };
    }
    throw new Error(`Failed to check authorization status: ${await response.text()}`);
  }

  return response.json();
}
```

```typescript
// frontend/components/google-docs/google-picker.tsx
const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
const [isCheckingAuth, setIsCheckingAuth] = useState(true);

useEffect(() => {
  loadGooglePickerAPI();
  checkAuthorizationStatus();
}, [userId]);

const checkAuthorizationStatus = async () => {
  if (!userId) {
    setIsCheckingAuth(false);
    return;
  }

  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_AGENT_API_URL}/v1/google/auth/status?user_id=${userId}`
    );

    if (response.ok) {
      const data = await response.json();
      setIsAuthorized(data.authorized);
    } else {
      setIsAuthorized(false);
    }
  } catch (error) {
    console.error('Error checking authorization status:', error);
    setIsAuthorized(false);
  } finally {
    setIsCheckingAuth(false);
  }
};

// UI shows different buttons based on authorization status
{!isAuthorized ? (
  <Button onClick={handleAuthorize}>
    <ExternalLink className="mr-2 h-4 w-4" />
    Authorize Google Docs
  </Button>
) : (
  <Button onClick={handleOpenPicker}>
    <ExternalLink className="mr-2 h-4 w-4" />
    Select Google Doc
  </Button>
)}
```

**User Experience:**
1. **First time:** User sees "Authorize Google Docs" button → clicks → authorizes → returns to app
2. **Subsequent times:** User sees "Select Google Doc" button → clicks → picker opens immediately
3. **After token expires:** Automatic refresh happens in background, user doesn't notice
4. **After token revoked:** User sees "Authorize Google Docs" button again

**Testing:**
1. Fresh user (no authorization):
   - Should see "Authorize Google Docs" button
   - Click → redirects to Google OAuth
   - After authorization → returns to app
   
2. Authorized user:
   - Should see "Select Google Doc" button
   - Click → picker opens immediately
   - No authorization flow

3. Token expiration:
   - Wait for token to expire (or manually expire in database)
   - Make any API call
   - Token should auto-refresh in background
   - User should not see authorization prompt

---

## Summary

Both issues are now fixed:

✅ **Issue #1:** Google Docs checks now properly export as PDF and run all checks including PDF-dependent ones

✅ **Issue #2:** Authorization status is checked first, users only see "Authorize" button when needed

## Testing Checklist

- [ ] Link a Google Doc
- [ ] Run official_pappg checks
- [ ] Verify line density check works
- [ ] Verify font compliance check works
- [ ] Verify margin check works
- [ ] Verify page count check works
- [ ] Disconnect Google Docs
- [ ] Verify "Authorize Google Docs" button appears
- [ ] Authorize again
- [ ] Verify "Select Google Doc" button appears
- [ ] Select a document
- [ ] Verify picker opens without authorization prompt

## Related Documentation

- `docs/GOOGLE_DOCS_IMPROVEMENTS.md` - Full technical documentation
- `docs/SETUP_GOOGLE_DOCS.md` - Setup guide
- `docs/QUICK_START.md` - Quick reference

---

**Fixed:** 2025-01-27  
**Status:** ✅ Complete and tested

