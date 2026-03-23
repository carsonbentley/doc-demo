# Privacy Policy Setup for GrantComply

## Overview
This document outlines the privacy policy implementation and Google OAuth scope reduction for GrantComply to avoid Google Cloud API verification requirements.

## ✅ SCOPE REDUCTION COMPLETED

### Previous Scopes (Required Verification):
- `https://www.googleapis.com/auth/documents` - Full read/write access to ALL documents
- `https://www.googleapis.com/auth/drive` - Full access to ALL Drive files (needed for comments)

### New Scope (No Verification Required):
- `https://www.googleapis.com/auth/drive.file` - Access ONLY to files user explicitly selects

### Key Difference:
The `drive.file` scope only grants access to files that users explicitly open/select through your app (like through Google Picker). This is much more limited than the broad scopes that can access ALL user files.

### Restored Functionality:
- ✅ Posting AI-generated comments to Google Docs
- ✅ Reading existing comments from Google Docs
- ✅ Resolving/deleting comments
- ✅ Full comment management capabilities

### How It Works:
1. **User Authorization**: User grants `drive.file` permission (no verification needed)
2. **File Selection**: User explicitly selects documents through Google Picker interface
3. **Limited Access**: App can only access the specific files user selected
4. **Operations**: Read document content, download as PDF, get metadata, run AI analysis, post comments

### Full Functionality Available:
- ✅ Download Google Docs as PDF files
- ✅ Get file metadata (name, size, modification dates)
- ✅ Document analysis and AI suggestions
- ✅ Google Picker integration for file selection
- ✅ Post AI-generated comments to selected documents
- ✅ Read, resolve, and delete comments
- ✅ Complete comment management workflow

## Files Created/Modified

### 1. Privacy Policy Page (React/Next.js)
- **File**: `frontend/app/(public)/privacy/page.tsx`
- **URL**: `https://yourdomain.com/privacy`
- **Description**: Full-featured privacy policy page with proper styling and navigation

### 2. Static HTML Privacy Policy
- **File**: `frontend/public/privacy-policy.html`
- **URL**: `https://yourdomain.com/privacy-policy.html`
- **Description**: Static HTML version for Google Cloud API verification

### 3. Landing Page Footer
- **File**: `frontend/components/landing/landing-page.tsx`
- **Changes**: Added footer with privacy policy link and contact information

### 4. Login Page
- **File**: `frontend/app/(public)/login/page.tsx`
- **Changes**: Added privacy policy link to the terms acceptance text

## Updated API Endpoints

### Restored Comment Endpoints:
- `POST /document/comment` - Post comments to Google Docs ✅ RESTORED
- `GET /document/{id}/comments` - Get comments from Google Docs ✅ RESTORED
- `PATCH /document/{id}/comment/{id}/resolve` - Resolve comments ✅ RESTORED
- `DELETE /document/{id}/comment/{id}` - Delete comments ✅ RESTORED

### Additional Endpoints:
- `POST /document/{id}/download-pdf` - Download document as PDF
- `GET /document/{id}/metadata` - Get file metadata
- `POST /document/{id}/ai-analysis` - Generate AI analysis and suggestions

## Privacy Policy Content

The privacy policy covers:
- **Data Access**: Explains read-only Google Drive/Docs integration
- **Data Storage**: Clarifies temporary processing, no permanent storage
- **User Consent**: References Google OAuth 2.0 and revocation process
- **Data Security**: Mentions HTTPS/TLS encryption
- **Third-Party Services**: References Google's policies
- **Contact Information**: Provides support email

## Google Cloud API Requirements

For Google Cloud API approval, ensure:

1. **Privacy Policy URL**: Use either:
   - `https://yourdomain.com/privacy` (React page)
   - `https://yourdomain.com/privacy-policy.html` (static HTML)

2. **Accessibility**: Privacy policy must be:
   - Publicly accessible (no login required)
   - Clearly linked from main application pages
   - Available at a consistent URL

3. **Content Requirements**: Policy must address:
   - What data is accessed from Google services
   - How data is used and processed
   - Data retention and deletion policies
   - User rights and consent mechanisms

## Next Steps

1. **Deploy**: Deploy the application with privacy policy
2. **Test**: Verify privacy policy is accessible at the public URL
3. **Google Cloud Console**: 
   - Add privacy policy URL to your OAuth consent screen
   - Submit for verification if required
4. **Domain Verification**: Ensure your domain is verified in Google Search Console

## URLs for Google Cloud Console

When configuring your OAuth consent screen in Google Cloud Console, use:
- **Privacy Policy URL**: `https://yourdomain.com/privacy`
- **Terms of Service URL**: (create if needed)
- **Homepage URL**: `https://yourdomain.com`

## Contact Information

The privacy policy includes:
- **Support Email**: support@grantcomply.ai
- **Last Updated**: October 10, 2025

Remember to update the "Last updated" date when making changes to the privacy policy.
