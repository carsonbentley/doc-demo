#!/bin/bash

# Test script to verify environment variables are set correctly
# This script checks if all required environment files exist and contain the expected variables

set -e

echo "🧪 Testing environment variable setup..."

# Check if files exist
echo "📁 Checking if environment files exist..."

if [ ! -f "frontend/.env.local" ]; then
    echo "❌ frontend/.env.local not found"
    exit 1
fi

if [ ! -f "ai-api/.env" ]; then
    echo "❌ ai-api/.env not found"
    exit 1
fi

if [ ! -f ".env.local" ]; then
    echo "❌ .env.local not found"
    exit 1
fi

echo "✅ All environment files exist"

# Check frontend/.env.local for required variables
echo "🔍 Checking frontend/.env.local..."
FRONTEND_VARS=(
    "NEXT_PUBLIC_SUPABASE_URL"
    "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    "NEXT_PUBLIC_AGENT_API_URL"
    "NEXT_PUBLIC_AI_API_URL"
    "NEXT_PUBLIC_GOOGLE_CLIENT_ID"
    "NEXT_PUBLIC_GOOGLE_API_KEY"
    "NEXT_PUBLIC_APP_URL"
)

for var in "${FRONTEND_VARS[@]}"; do
    if grep -q "^$var=" frontend/.env.local; then
        echo "✅ $var found"
    else
        echo "❌ $var missing from frontend/.env.local"
    fi
done

# Check ai-api/.env for required variables
echo "🔍 Checking ai-api/.env..."
AI_VARS=(
    "SUPABASE_URL"
    "SUPABASE_SERVICE_ROLE_KEY"
    "OPENAI_API_KEY"
    "GOOGLE_CLIENT_ID"
    "GOOGLE_CLIENT_SECRET"
    "OPENAI_MODEL"
    "GOOGLE_REDIRECT_URI"
    "API_PORT"
)

for var in "${AI_VARS[@]}"; do
    if grep -q "^$var=" ai-api/.env; then
        echo "✅ $var found"
    else
        echo "❌ $var missing from ai-api/.env"
    fi
done

echo "🎉 Environment variable test complete!"
echo ""
echo "💡 If any variables are missing, run: npm run env:pull"
echo "📖 For setup instructions, see: DOPPLER_SETUP.md"
