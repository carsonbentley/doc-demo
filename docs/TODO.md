# Google Docs Integration - TODO List

## ✅ Completed

### Phase 1: Security Fixes
- [x] Remove client_secret from token storage
- [x] Implement automatic token refresh
- [x] Add token encryption infrastructure (database ready)
- [x] Create encryption/decryption functions in database

### Phase 2: PDF Export
- [x] Add export_as_pdf() method to GoogleDocsService
- [x] Create /document/{id}/export-pdf endpoint
- [x] Create /document/{id}/run-checks endpoint
- [x] Integrate PDF export into check flow

### Phase 3: Caching Infrastructure
- [x] Add PDF caching columns to database
- [x] Create cache invalidation trigger
- [x] Add indexes for cache lookups

### Documentation
- [x] Create comprehensive technical documentation
- [x] Create setup guide
- [x] Create implementation summary
- [x] Create quick start guide

## 🔄 In Progress / Next Steps

### High Priority (This Week)

#### 1. Environment Configuration
- [ ] Generate encryption key: `openssl rand -base64 32`
- [ ] Add to `.env`: `GOOGLE_TOKEN_ENCRYPTION_KEY=...`
- [ ] Store in secrets manager for production
- [ ] Restart backend services

#### 2. Update Remaining Endpoints
Update these endpoints to use `get_valid_credentials()` helper:

- [ ] `post_comment_to_document` (line ~250 in google_auth.py)
- [ ] `map_document_sections` (line ~300)
- [ ] `generate_ai_comments` (line ~400)
- [ ] `get_document_comments` (line ~500)
- [ ] `resolve_comment` (line ~550)
- [ ] `delete_comment` (line ~600)

**Pattern to follow:**
```python
# OLD
result = supabase.table('google_tokens').select('*').eq('user_id', user_id).single().execute()
token_data = result.data['token_data']
credentials = auth_service.get_credentials_from_token_data(token_data)
docs_service = GoogleDocsService(credentials)

# NEW
docs_service, _ = await get_valid_credentials(user_id, auth_service, supabase)
```

#### 3. Test Core Functionality
- [ ] Test token refresh with expired token
- [ ] Test PDF export with small document
- [ ] Test PDF export with large document (50+ pages)
- [ ] Test running checks on Google Doc
- [ ] Compare results: PDF upload vs Google Doc
- [ ] Test with invalid/revoked tokens

### Medium Priority (Next 2 Weeks)

#### 4. Implement Token Encryption
- [ ] Update `exchange_code_for_tokens()` to encrypt tokens before storage
- [ ] Update token retrieval to decrypt tokens
- [ ] Test encryption/decryption flow
- [ ] Migrate existing tokens to encrypted format
- [ ] Verify all tokens are encrypted

**Files to modify:**
- `ai-api/src/agent_api/routers/google_auth.py` (storage)
- `ai-api/src/agent_api/services/google_auth.py` (retrieval)

#### 5. Implement PDF Caching
- [ ] Create Supabase Storage bucket for PDFs
- [ ] Add function to check cache validity
- [ ] Add function to store PDF in cache
- [ ] Add function to retrieve PDF from cache
- [ ] Update export endpoint to use cache
- [ ] Add cache hit/miss metrics

**Pseudocode:**
```python
def get_or_export_pdf(document_id, user_id):
    # Check cache
    doc = get_document_record(document_id)
    if doc.pdf_cache_valid and doc.cached_pdf_url:
        return download_from_storage(doc.cached_pdf_url)
    
    # Export new PDF
    pdf = export_as_pdf(document_id)
    
    # Store in cache
    url = upload_to_storage(pdf, f"{document_id}.pdf")
    update_cache_record(document_id, url)
    
    return pdf
```

#### 6. Frontend Integration
- [ ] Add "Run Checks" button for Google Docs
- [ ] Add "Export as PDF" button for Google Docs
- [ ] Update check results display
- [ ] Handle token expiration errors
- [ ] Add loading states for PDF export
- [ ] Show cache status (if applicable)

**Example UI:**
```typescript
// In document viewer component
<Button onClick={() => runChecksOnGoogleDoc(docId)}>
  Run Compliance Checks
</Button>

<Button onClick={() => exportGoogleDocAsPDF(docId)}>
  Export as PDF
</Button>
```

#### 7. Write Tests
- [ ] Unit test: `ensure_valid_token()`
- [ ] Unit test: `export_as_pdf()`
- [ ] Integration test: Token refresh flow
- [ ] Integration test: PDF export
- [ ] Integration test: Run checks on Google Doc
- [ ] Integration test: Cache invalidation
- [ ] E2E test: Full check flow

### Low Priority (Next Month)

#### 8. Improve Token Revocation
- [ ] Add actual Google API revocation call
- [ ] Improve error messages
- [ ] Add "Disconnect Google Docs" UI
- [ ] Add confirmation dialog

#### 9. Error Handling Improvements
- [ ] Add retry logic with exponential backoff
- [ ] Better error messages for users
- [ ] Graceful degradation when APIs down
- [ ] Add error tracking/monitoring

#### 10. Monitoring & Metrics
- [ ] Add metrics for token refresh frequency
- [ ] Track PDF export times (p50, p95, p99)
- [ ] Monitor cache hit rates
- [ ] Track API quota usage
- [ ] Set up alerts for quota limits
- [ ] Add dashboard for Google Docs usage

#### 11. Performance Optimization
- [ ] Batch operations where possible
- [ ] Background jobs for large documents
- [ ] Cache warming for frequently accessed docs
- [ ] Optimize database queries

#### 12. Advanced Features
- [ ] Webhook support for document changes
- [ ] Partial exports (specific sections only)
- [ ] Diff detection for incremental checks
- [ ] Batch export multiple documents
- [ ] Export format options (DOCX, etc.)

## 📋 Testing Checklist

### Manual Testing
- [ ] Create test Google Doc with known content
- [ ] Authorize Google Docs access
- [ ] Export document as PDF
- [ ] Verify PDF content matches document
- [ ] Run checks on Google Doc
- [ ] Compare with PDF upload results
- [ ] Wait for token to expire (or manually expire)
- [ ] Make API call and verify auto-refresh
- [ ] Revoke token and verify error handling
- [ ] Modify document and verify cache invalidation

### Automated Testing
- [ ] Write unit tests for new functions
- [ ] Write integration tests for endpoints
- [ ] Set up CI/CD to run tests
- [ ] Add test coverage reporting
- [ ] Aim for >80% coverage on new code

### Load Testing
- [ ] Test with 10 concurrent exports
- [ ] Test with 100 concurrent exports
- [ ] Test with very large documents (100+ pages)
- [ ] Monitor API quota usage
- [ ] Monitor database performance

## 🚀 Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Code reviewed by team
- [ ] Documentation reviewed
- [ ] Environment variables configured
- [ ] Database migrations applied
- [ ] Backup database before migration

### Staging Deployment
- [ ] Deploy to staging
- [ ] Run smoke tests
- [ ] Test with real Google Docs
- [ ] Verify token refresh works
- [ ] Verify PDF export works
- [ ] Verify checks work
- [ ] Get team to test

### Production Deployment
- [ ] Deploy during low-traffic window
- [ ] Monitor error rates
- [ ] Monitor API quota usage
- [ ] Monitor performance metrics
- [ ] Have rollback plan ready
- [ ] Notify team of deployment

### Post-Deployment
- [ ] Monitor for 24 hours
- [ ] Check error logs
- [ ] Verify metrics look normal
- [ ] Get user feedback
- [ ] Document any issues
- [ ] Plan next iteration

## 📊 Success Metrics

### Security
- [ ] 100% of tokens auto-refresh successfully
- [ ] 0 client credentials stored per-user
- [ ] Token encryption enabled for all new tokens
- [ ] No security incidents related to tokens

### Functionality
- [ ] PDF export success rate > 99%
- [ ] Check results match between PDF and Google Docs
- [ ] Export time < 5 seconds for typical documents

### Performance
- [ ] Cache hit rate > 70% for active documents
- [ ] API quota usage within limits
- [ ] No performance degradation vs. PDF uploads

### User Experience
- [ ] No unexpected authorization errors
- [ ] Clear error messages
- [ ] Fast check execution
- [ ] Positive user feedback

## 🐛 Known Issues

None currently. Document any issues discovered during testing here.

## 💡 Future Ideas

- Real-time collaboration features
- Version history integration
- Automated check scheduling
- AI-powered suggestions in Google Docs
- Integration with other document sources (Dropbox, OneDrive)
- Bulk operations (check multiple documents at once)
- Custom check templates
- Export check results to Google Docs as comments

## 📞 Support

For questions or issues:
1. Check documentation in `docs/` folder
2. Review error logs
3. Check Supabase logs
4. Check Google API Console
5. Contact development team

---

**Last Updated:** 2025-01-27  
**Status:** Core implementation complete, ready for integration and testing

