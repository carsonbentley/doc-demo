# GrantComply AI Assistant - Google Docs Add-on

A Google Apps Script add-on that provides AI-powered assistance for grant writing and document review directly within Google Docs.

## Features

- **AI Chat Interface**: Ask questions and get intelligent responses in a sidebar
- **Smart Comments**: Automatically create Google Docs comments with AI suggestions
- **Text Selection Support**: Get context-aware responses based on selected text
- **Professional UI**: Clean, Google-style interface that integrates seamlessly

## Prerequisites

1. **Google Account** with access to Google Apps Script
2. **GrantComply Backend** running (your existing AI API)
3. **Node.js and clasp** for deployment (optional, for easier development)

## Quick Setup

### Option 1: Automated Setup (Recommended)

1. Make sure your GrantComply backend is running on `localhost:8000`
2. Run the setup script:
   ```bash
   cd addon
   ./setup.sh
   ```
3. Follow the prompts to create and deploy your add-on
4. Test in Google Docs!

### Option 2: Manual Setup

1. Go to [Google Apps Script](https://script.google.com)
2. Click "New Project"
3. Replace the default `Code.gs` with the contents of `Code.gs` from this folder
4. Add the HTML files:
   - Click the "+" next to "Files" → "HTML"
   - Create `sidebar.html` and paste the contents
   - Create `settings.html` and paste the contents
5. Replace `appsscript.json` with the contents from this folder
6. Update the `CONFIG.API_BASE_URL` in `Code.gs` to point to your backend
7. Save and deploy (see Deployment section below)

### Option 2: Using clasp (For Developers)

1. Install clasp globally:
   ```bash
   npm install -g @google/clasp
   ```

2. Login to Google Apps Script:
   ```bash
   clasp login
   ```

3. Create a new project:
   ```bash
   cd addon
   clasp create --type standalone --title "GrantComply AI Assistant"
   ```

4. Push the code:
   ```bash
   clasp push
   ```

5. Open in the web editor:
   ```bash
   clasp open
   ```

## Configuration

### Backend URL Configuration

Update the `CONFIG.API_BASE_URL` in `Code.gs`:

```javascript
const CONFIG = {
  API_BASE_URL: 'https://your-domain.com', // Change this!
  APP_NAME: 'GrantComply AI Assistant',
  VERSION: '1.0.0'
};
```

For local development, use `http://localhost:8000` (default).

### OAuth Scopes

The add-on requires these permissions (already configured in `appsscript.json`):
- `https://www.googleapis.com/auth/documents.currentonly` - Access current document
- `https://www.googleapis.com/auth/script.external_request` - Call external APIs
- `https://www.googleapis.com/auth/userinfo.email` - Get user email

### URL Whitelist

Update the `urlFetchWhitelist` in `appsscript.json` to include your backend domain:

```json
"urlFetchWhitelist": [
  "https://localhost:8000",
  "https://your-production-domain.com"
]
```

## Deployment

### For Testing (Development Mode)

1. In Google Apps Script editor, click "Deploy" → "Test deployments"
2. Click "Install" to test in your own Google Docs
3. Open any Google Doc and look for "GrantComply AI Assistant" in the Add-ons menu

### For Production (Published Add-on)

1. In Google Apps Script editor, click "Deploy" → "New deployment"
2. Choose type: "Add-on"
3. Fill in the deployment details:
   - **Description**: Brief description of your add-on
   - **Version**: Start with "Version 1"
   - **Execute as**: "Me" (your account)
   - **Who has access**: Choose based on your needs
4. Click "Deploy"
5. Copy the deployment ID for distribution

### Publishing to Google Workspace Marketplace (Optional)

For public distribution:

1. Complete the deployment steps above
2. Go to [Google Cloud Console](https://console.cloud.google.com)
3. Enable the Google Workspace Marketplace SDK
4. Configure OAuth consent screen
5. Submit for review (this process can take several weeks)

## Usage

### Basic Usage

1. Open any Google Doc
2. Go to "Add-ons" → "GrantComply AI Assistant" → "Open AI Assistant"
3. Type your question in the sidebar
4. Click "Ask AI" to get a response
5. Choose to add the response as a comment to your document

### Advanced Features

- **Text Selection**: Select text in your document before asking a question for context-aware responses
- **Comment Anchoring**: Comments will be anchored to selected text, cursor position, or document end
- **Settings**: Access settings via "Add-ons" → "GrantComply AI Assistant" → "Settings"

## Development

### Local Testing

1. Start your backend API:
   ```bash
   cd ai-api
   poetry run uvicorn src.agent_api.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. Test the add-on in Google Docs (development mode)

3. Check logs in Google Apps Script editor under "Executions"

### Debugging

- Use `console.log()` in Apps Script for server-side debugging
- Use browser dev tools for client-side (HTML/JavaScript) debugging
- Check the "Executions" tab in Apps Script editor for runtime errors

### Making Changes

1. Edit files locally
2. Push changes:
   ```bash
   clasp push
   ```
3. Refresh your Google Doc to see changes

## Authentication Flow

The add-on uses a simplified authentication approach:

1. Gets user's Google email via `Session.getActiveUser().getEmail()`
2. Generates a user ID hash for backend communication
3. Stores user ID in `PropertiesService` for persistence

For production, you may want to implement proper OAuth flow with your backend.

## API Integration

The add-on calls your backend's `/v1/ai/chat` endpoint:

```javascript
POST /v1/ai/chat
{
  "question": "User's question",
  "user_id": "generated_user_id",
  "context": "selected_text_if_any"
}
```

Expected response:
```javascript
{
  "response": "AI response text",
  "success": true
}
```

## Troubleshooting

### Common Issues

1. **"Script function not found"**
   - Make sure all functions are properly defined in `Code.gs`
   - Check for typos in function names

2. **"Authorization required"**
   - Re-authorize the add-on in Google Docs
   - Check OAuth scopes in `appsscript.json`

3. **"Failed to fetch"**
   - Verify backend URL in `CONFIG.API_BASE_URL`
   - Check URL whitelist in `appsscript.json`
   - Ensure backend is running and accessible

4. **Comments not being created**
   - Check document permissions
   - Verify the document supports comments
   - Check browser console for JavaScript errors

### Getting Help

1. Check the "Executions" tab in Google Apps Script for detailed error logs
2. Use browser developer tools to debug client-side issues
3. Test API endpoints directly using curl or Postman
4. Verify backend logs for API call issues

## Security Considerations

- The add-on only accesses the current document (not all user documents)
- User authentication is simplified for development - enhance for production
- All API calls go through Google's servers (UrlFetchApp)
- Consider implementing proper API authentication for production use

## Next Steps

1. Test the add-on thoroughly in development mode
2. Enhance authentication for production use
3. Add more sophisticated AI features
4. Consider publishing to Google Workspace Marketplace
5. Implement analytics and error tracking
