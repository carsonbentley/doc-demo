#!/bin/bash

# Deploy Frontend to Vercel
# This script helps deploy the frontend service to Vercel

echo "🚀 Deploying GrantComply Frontend to Vercel..."

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Check if logged in
if ! vercel whoami &> /dev/null; then
    echo "🔐 Please login to Vercel first:"
    vercel login
fi

# Navigate to frontend directory
cd "$(dirname "$0")/../../apps/frontend" || exit 1

echo "📁 Current directory: $(pwd)"
echo "📋 Files in directory:"
ls -la

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

echo "✅ Frontend deployment initiated!"
echo "🌐 Check your Vercel dashboard for the deployment URL"
echo "📝 Don't forget to add environment variables in Vercel dashboard"
