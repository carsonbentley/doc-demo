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
   SUPABASE_URL=https://aynrqsbkhnirucgovwnf.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bnJxc2JraG5pcnVjZ292d25mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjU3OTY1NSwiZXhwIjoyMDcyMTU1NjU1fQ.M7Vqa56uHObeV4C22VhFQFFou_ZNu8YqR0fkJ_j3GR8
   OPENAI_API_KEY=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
   OPENAI_MODEL=gpt-4o-mini
   GOOGLE_CLIENT_SECRET=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
   ```

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
   NEXT_PUBLIC_SUPABASE_URL=https://aynrqsbkhnirucgovwnf.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bnJxc2JraG5pcnVjZ292d25mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY1Nzk2NTUsImV4cCI6MjA3MjE1NTY1NX0.HqgRQfW-QduwnBob7ZpsI_e30iXAEuq2wzhy0_idWZk
   NEXT_PUBLIC_GOOGLE_API_KEY=AIzaSyAUCnP0ce9WqhfiYtbJ5vCjaB6vMpvIV7E
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=134720547219-bqof9sbkq53kr3rsrhhl4ddnl2vdglg8.apps.googleusercontent.com
   NEXT_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER=134720547219
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bnJxc2JraG5pcnVjZ292d25mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjU3OTY1NSwiZXhwIjoyMDcyMTU1NjU1fQ.M7Vqa56uHObeV4C22VhFQFFou_ZNu8YqR0fkJ_j3GR8
   
   # UPDATE THESE WITH YOUR RAILWAY BACKEND URL:
   NEXT_PUBLIC_AI_API_URL=https://your-backend-url.up.railway.app
   NEXT_PUBLIC_AGENT_API_URL=https://your-backend-url.up.railway.app
   ```

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
