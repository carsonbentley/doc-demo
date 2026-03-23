#!/bin/bash
set -e

echo "🚀 GrantComply Setup"
echo "===================="

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.11+ and try again."
    exit 1
fi

# Check if Poetry is installed
if ! command -v poetry &> /dev/null; then
    echo "❌ Poetry is not installed. Installing Poetry..."
    curl -sSL https://install.python-poetry.org | python3 -
    export PATH="$HOME/.local/bin:$PATH"
fi

echo "📦 Installing dependencies..."
cd frontend && npm install && cd ..
cd ai-api && poetry install && cd ..
npm install

echo "🔧 Setting up environment files..."

# Create frontend .env.local if it doesn't exist
if [ ! -f "frontend/.env.local" ]; then
    echo "Creating frontend/.env.local template..."
    cat > frontend/.env.local << 'EOF'
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
NEXT_PUBLIC_AGENT_API_URL=http://localhost:8002
NEXT_PUBLIC_AI_API_URL=http://localhost:8002
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your_google_client_id
NEXT_PUBLIC_GOOGLE_API_KEY=your_google_api_key
EOF
fi

# Create AI API .env if it doesn't exist
if [ ! -f "ai-api/.env" ]; then
    echo "Creating ai-api/.env template..."
    cat > ai-api/.env << 'EOF'
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
OPENAI_API_KEY=sk-your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
API_PORT=8002
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000
EOF
fi

echo "✅ Setup complete!"
echo ""
echo "🎯 Next steps:"
echo "   1. Set up Doppler with your environment variables (see DOPPLER_SETUP.md)"
echo "   2. Run 'npm run env:pull' to pull environment variables from Doppler"
echo "   3. Run 'npm run dev' to start both services"
echo "   4. Visit http://localhost:3000 for frontend"
echo "   5. Visit http://localhost:8002/docs for API docs"
