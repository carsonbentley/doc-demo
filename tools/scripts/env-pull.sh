#!/bin/bash

# GrantComply Environment Variables Setup
# This script pulls environment variables from Doppler and distributes them to the correct locations

set -e

echo "🔧 Pulling environment variables from Doppler..."

# Check if doppler is installed
if ! command -v doppler &> /dev/null; then
    echo "❌ Doppler CLI not found. Please install it first:"
    echo "   https://docs.doppler.com/docs/install-cli"
    exit 1
fi

# Pull all environment variables from Doppler
echo "📥 Downloading secrets from Doppler..."
DOPPLER_ENV=$(doppler secrets download -p grantcomply -c dev_main --no-file --format env)

if [ $? -ne 0 ]; then
    echo "❌ Failed to pull secrets from Doppler"
    echo "   Make sure you're logged in: doppler login"
    echo "   And have access to the grantcomply project"
    exit 1
fi

# Create frontend .env.local
echo "📝 Creating frontend/.env.local..."
mkdir -p frontend
cat > frontend/.env.local << EOF
# Frontend Environment Variables (Public)
# These are safe to expose to the browser

$(echo "$DOPPLER_ENV" | grep "^NEXT_PUBLIC_")
NEXT_PUBLIC_AGENT_API_URL=http://localhost:8002
NEXT_PUBLIC_AI_API_URL=http://localhost:8002

EOF

# Create ai-api .env
echo "📝 Creating ai-api/.env..."
mkdir -p ai-api
cat > ai-api/.env << EOF
# AI-API Environment Variables (Private)
# These contain sensitive keys and should never be exposed to the browser

$(echo "$DOPPLER_ENV" | grep -E "^(SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|GOOGLE_CLIENT_SECRET|OPENAI_MODEL)")
$(echo "$DOPPLER_ENV" | grep "^NEXT_PUBLIC_SUPABASE_URL" | sed 's/NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL/')
$(echo "$DOPPLER_ENV" | grep "^NEXT_PUBLIC_GOOGLE_CLIENT_ID" | sed 's/NEXT_PUBLIC_GOOGLE_CLIENT_ID/GOOGLE_CLIENT_ID/')
$(echo "$DOPPLER_ENV" | grep "^GOOGLE_REDIRECT_URI" || echo "GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback")
API_PORT=8002

EOF

# Create root .env.local for any shared variables
echo "📝 Creating root .env.local..."
cat > .env.local << EOF
# Root Environment Variables
# Shared variables for development scripts

$(echo "$DOPPLER_ENV" | grep -v -E "^(NEXT_PUBLIC_|SUPABASE_SERVICE_ROLE_KEY|OPENAI_API_KEY|GOOGLE_CLIENT_SECRET)")

EOF

echo "✅ Environment variables successfully distributed:"
echo "   📁 frontend/.env.local    - Public frontend variables"
echo "   📁 ai-api/.env           - Private AI-API variables"  
echo "   📁 .env.local            - Root/shared variables"
echo ""
echo "🔒 Security Note:"
echo "   - frontend/.env.local contains ONLY public variables (NEXT_PUBLIC_*)"
echo "   - ai-api/.env contains sensitive keys (never commit to git)"
echo "   - All .env files are in .gitignore for security"
echo ""
echo "🚀 Ready to run: npm run dev"
