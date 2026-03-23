#!/bin/bash

# Deploy Backend to Railway
# This script helps deploy the backend service to Railway

echo "🚀 Deploying GrantComply Backend to Railway..."

# Check if Railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    echo "Run: npm install -g @railway/cli"
    echo "Or: brew install railway"
    exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "🔐 Please login to Railway first:"
    echo "railway login"
    exit 1
fi

# Navigate to backend directory
cd "$(dirname "$0")/../../apps/backend" || exit 1

echo "📁 Current directory: $(pwd)"
echo "📋 Files in directory:"
ls -la

# Initialize Railway project if needed
if [ ! -f ".railway" ]; then
    echo "🔧 Initializing Railway project..."
    railway init
fi

# Deploy to Railway
echo "🚀 Deploying to Railway..."
railway up --detach

echo "✅ Backend deployment initiated!"
echo "🌐 Check your Railway dashboard for the deployment URL"
echo "📝 Don't forget to add environment variables in Railway dashboard:"
echo ""
echo "SUPABASE_URL=https://aynrqsbkhnirucgovwnf.supabase.co"
echo "SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF5bnJxc2JraG5pcnVjZ292d25mIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjU3OTY1NSwiZXhwIjoyMDcyMTU1NjU1fQ.M7Vqa56uHObeV4C22VhFQFFou_ZNu8YqR0fkJ_j3GR8"
echo "OPENAI_API_KEY=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"
echo "OPENAI_MODEL=gpt-4o-mini"
echo "GOOGLE_CLIENT_SECRET=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"
