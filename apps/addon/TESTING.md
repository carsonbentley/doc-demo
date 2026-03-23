# Testing Guide - GrantComply Google Docs Add-on

This guide walks you through testing the Google Docs add-on locally before deployment.

## Prerequisites

1. **Backend API Running**: Your GrantComply backend must be running on `localhost:8000`
2. **Google Account**: With access to Google Docs and Google Apps Script
3. **User Account**: You must have a user account in the GrantComply system (sign up at your web app first)

## Quick Start

### 1. Set Up the Development Environment

```bash
cd addon
npm run setup
```

This will:
- Install Google Apps Script CLI (clasp) if needed
- Login to Google Apps Script
- Create a new project
- Push the code to Google Apps Script

### 2. Start Your Backend

Make sure your GrantComply backend is running:

```bash
cd ai-api
poetry run uvicorn src.agent_api.main:app --reload --host 0.0.0.0 --port 8000
```

Verify it's working by visiting: http://localhost:8000/docs

### 3. Test the Add-on

1. Open the Apps Script project:
   ```bash
   npm run open
   ```

2. In the Apps Script editor, click "Deploy" → "Test deployments"

3. Click "Install" to install the test version

4. Open any Google Doc in a new tab

5. Look for "GrantComply AI Assistant" in the Add-ons menu

6. Click "Add-ons" → "GrantComply AI Assistant" → "Open AI Assistant"

## Testing Scenarios

### Scenario 1: Basic Authentication

**Test**: Verify user authentication works

1. Open the add-on sidebar
2. Check the status bar at the top
3. **Expected**: Should show "✓ Connected as your-email@domain.com"
4. **If not**: Check that you have a user account in GrantComply system

**Troubleshooting**:
- If you see "Not authenticated", sign up at your GrantComply web app first
- If you see "Authentication error", check that your backend is running
- Use Settings → "Clear Cache" to reset authentication

### Scenario 2: Simple AI Question

**Test**: Ask a basic question without text selection

1. Type a question like "What makes a good grant proposal?"
2. Click "Ask AI"
3. **Expected**: Should get a 2-sentence response
4. **Expected**: Should be prompted to add as comment
5. Click "OK" to add as comment
6. **Expected**: Comment should appear in the document

### Scenario 3: Context-Aware Question

**Test**: Ask a question with selected text

1. Select some text in your Google Doc
2. Open the add-on sidebar
3. **Expected**: Should see "Selected text: [your text...]" in yellow box
4. Ask a question like "How can I improve this section?"
5. Click "Ask AI"
6. **Expected**: AI should reference the selected text in its response
7. Add as comment
8. **Expected**: Comment should be anchored to the selected text

### Scenario 4: Cursor Position Comments

**Test**: Add comments at cursor position

1. Place your cursor somewhere in the document (don't select text)
2. Ask a question and add as comment
3. **Expected**: Comment should be anchored near the cursor position

### Scenario 5: Settings and Cache Management

**Test**: Settings dialog functionality

1. Go to "Add-ons" → "GrantComply AI Assistant" → "Settings"
2. **Expected**: Should show your email and user ID
3. Click "Refresh Authentication"
4. **Expected**: Should update the information
5. Click "Clear Cache"
6. **Expected**: Should clear authentication cache
7. Close settings and reopen add-on
8. **Expected**: Should re-authenticate automatically

## API Testing

### Test Backend Endpoints Directly

You can test the backend endpoints directly to isolate issues:

#### 1. Test Authentication Endpoint

```bash
curl -X POST "http://localhost:8000/v1/ai/authenticate" \
  -H "Content-Type: application/json" \
  -d '{"email": "your-email@domain.com"}'
```

**Expected Response**:
```json
{
  "success": true,
  "user_id": "your-user-id",
  "message": "Authentication successful"
}
```

#### 2. Test AI Chat Endpoint

```bash
curl -X POST "http://localhost:8000/v1/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What makes a good grant proposal?",
    "user_id": "your-user-id",
    "context": ""
  }'
```

**Expected Response**:
```json
{
  "response": "A good grant proposal clearly articulates the problem and presents a compelling solution with measurable outcomes. It should demonstrate the applicant's expertise and include a realistic budget and timeline.",
  "success": true
}
```

## Debugging

### Apps Script Debugging

1. **View Logs**: In Apps Script editor, go to "Executions" tab to see runtime logs
2. **Add Logging**: Add `console.log()` statements in Code.gs for debugging
3. **Test Functions**: Use the Apps Script editor to test individual functions

### Client-Side Debugging

1. **Browser Console**: Open browser dev tools in Google Docs to see JavaScript errors
2. **Network Tab**: Check for failed API calls
3. **Add Alerts**: Add `alert()` statements in sidebar.html for debugging

### Common Issues and Solutions

#### "Script function not found"
- **Cause**: Function name mismatch or syntax error
- **Solution**: Check function names in Code.gs, look for typos

#### "Authorization required" 
- **Cause**: OAuth permissions not granted
- **Solution**: Re-authorize the add-on, check scopes in appsscript.json

#### "Failed to fetch" or network errors
- **Cause**: Backend not running or URL mismatch
- **Solution**: 
  - Verify backend is running on localhost:8000
  - Check CONFIG.API_BASE_URL in Code.gs
  - Verify URL whitelist in appsscript.json

#### "User not found" authentication error
- **Cause**: User doesn't exist in GrantComply system
- **Solution**: Sign up at the GrantComply web app first

#### Comments not being created
- **Cause**: Document permissions or API issues
- **Solution**:
  - Check document allows comments
  - Verify you have edit access to the document
  - Check browser console for JavaScript errors

## Performance Testing

### Test with Different Document Sizes

1. **Small Document**: Test with a 1-page document
2. **Medium Document**: Test with a 10-page document  
3. **Large Document**: Test with a 50+ page document

### Test Response Times

- AI responses should come back within 5-10 seconds
- Comment creation should be nearly instantaneous
- Authentication should complete within 2-3 seconds

## Security Testing

### Test Authentication Edge Cases

1. **Invalid Email**: Try authenticating with an email not in the system
2. **Network Failure**: Disconnect internet during authentication
3. **Backend Down**: Stop the backend and test error handling

### Test Data Handling

1. **Long Questions**: Test with very long questions (1000+ characters)
2. **Special Characters**: Test with emojis, special characters, HTML
3. **Large Selections**: Test with very large text selections

## Automated Testing

For continuous integration, you can create automated tests:

```bash
# Test backend endpoints
npm test

# Deploy test version
clasp deploy --description "Test deployment $(date)"

# Run integration tests
# (You would need to implement these)
```

## Next Steps After Testing

1. **Fix Issues**: Address any bugs found during testing
2. **Performance Optimization**: Optimize slow operations
3. **User Experience**: Improve UI/UX based on testing feedback
4. **Production Deployment**: Deploy to production environment
5. **User Acceptance Testing**: Have real users test the add-on

## Getting Help

If you encounter issues during testing:

1. Check the logs in Apps Script editor ("Executions" tab)
2. Check browser console for client-side errors
3. Test API endpoints directly with curl
4. Verify backend logs for server-side issues
5. Check this guide's troubleshooting section

Remember: Most issues are related to authentication, network connectivity, or configuration mismatches.
