# GrantComply Deployment Guide

This guide walks you through deploying GrantComply using the optimal **Railway + Vercel + Supabase** architecture.

## 🏗️ Architecture Overview

- **Backend (FastAPI)**: Railway
- **Frontend (Next.js)**: Vercel  
- **Database**: Supabase (already configured)
- **Google Apps Script**: Uses Railway backend URL

## 🚀 Deployment Steps

### Step 1: Deploy Backend to Railway

1. **Install Railway CLI** (if not already installed):
   ```bash
   npm install -g @railway/cli
   # OR
   brew install railway
   ```

2. **Login to Railway**:
   ```bash
   railway login
   ```

3. **Deploy Backend**:
   ```bash
   ./tools/scripts/deploy-backend.sh
   ```

   OR manually:
   ```bash
   cd apps/backend
   railway up
   ```

4. **Add Environment Variables in Railway Dashboard**:
   - Go to your Railway project
   - Click on the backend service
   - Go to "Variables" tab
   - Add these variables:

   ```bash
   SUPABASE_URL=https://<your-project-ref>.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=<your_supabase_service_role_key>
   OPENAI_API_KEY=<your_openai_api_key>
   OPENAI_MODEL=gpt-4o-mini
   GOOGLE_CLIENT_SECRET=<your_google_oauth_client_secret>
   ```

   Use values from the Supabase project settings, OpenAI dashboard, and Google Cloud OAuth client. Never commit real keys to the repository.

5. **Get Backend URL**:
   - Copy the Railway deployment URL (e.g., `https://backend-production-xxxx.up.railway.app`)

### Step 2: Deploy Frontend to Vercel

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy Frontend**:
   ```bash
   ./tools/scripts/deploy-frontend.sh
   ```

   OR manually:
   ```bash
   cd apps/frontend
   vercel --prod
   ```

4. **Add Environment Variables in Vercel Dashboard**:
   - Go to your Vercel project
   - Go to Settings → Environment Variables
   - Add these variables:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_supabase_anon_or_publishable_key>
   NEXT_PUBLIC_GOOGLE_API_KEY=<your_google_api_key>
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=<your_google_oauth_client_id>.apps.googleusercontent.com
   NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER=<your_gcp_project_number>

   # Do not set SUPABASE_SERVICE_ROLE_KEY on the frontend project unless a specific
   # server-only integration requires it; prefer the anon key + RLS for browser code.

   # UPDATE THESE WITH YOUR RAILWAY BACKEND URL:
   NEXT_PUBLIC_AI_API_URL=https://your-backend-url.up.railway.app
   NEXT_PUBLIC_AGENT_API_URL=https://your-backend-url.up.railway.app
   ```

   Restrict Google API keys in Google Cloud Console (HTTP referrers / bundle IDs) where applicable.

### Step 3: Update Google Apps Script

1. **Update `addon/Code.gs` line 10**:
   ```javascript
   API_BASE_URL: 'https://your-backend-url.up.railway.app',
   ```

2. **Update `addon/appsscript.json` whitelist**:
   ```json
   "urlFetchWhitelist": [
     "https://your-backend-url.up.railway.app/"
   ]
   ```

3. **Deploy new version** in Google Apps Script

## 🧪 Testing

### Test Backend:
```bash
curl -X POST "https://your-backend-url.up.railway.app/v1/ai/chat" \
  -H "Content-Type: application/json" \
  -d '{"question": "test question"}'
```

### Test Frontend:
Visit your Vercel URL and test the application

### Test Google Apps Script:
1. Open a Google Doc
2. Use the add-on to ask a question
3. Should create comments successfully

## 💰 Cost Estimate

- **Railway Backend**: ~$5/month
- **Vercel Frontend**: Free tier (very generous)
- **Supabase Database**: Free tier
- **Total**: ~$5/month

## 🔧 Troubleshooting

### Backend Issues:
- Check Railway logs in dashboard
- Verify environment variables are set
- Test health endpoint: `/health`

### Frontend Issues:
- Check Vercel function logs
- Verify environment variables include backend URL
- Test API connections

### Google Apps Script Issues:
- Verify backend URL is correct
- Check OAuth permissions are granted
- Test API endpoint directly first
