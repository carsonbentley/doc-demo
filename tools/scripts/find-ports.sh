#!/bin/bash

# Find available ports for development
echo "🔍 Finding available ports..."

# Function to check if port is available
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 1  # Port is in use
    else
        return 0  # Port is available
    fi
}

# Find available port starting from given port
find_available_port() {
    local start_port=$1
    local port=$start_port
    
    while [ $port -lt $((start_port + 100)) ]; do
        if check_port $port; then
            echo $port
            return 0
        fi
        port=$((port + 1))
    done
    
    echo "No available port found starting from $start_port"
    return 1
}

# Check default ports
FRONTEND_PORT=3000
AI_API_PORT=8000

echo "Checking default ports..."

if check_port $FRONTEND_PORT; then
    echo "✅ Frontend port $FRONTEND_PORT is available"
else
    NEW_FRONTEND_PORT=$(find_available_port 3001)
    echo "⚠️  Frontend port $FRONTEND_PORT is in use, try: $NEW_FRONTEND_PORT"
    echo "   Set: export PORT=$NEW_FRONTEND_PORT"
fi

if check_port $AI_API_PORT; then
    echo "✅ AI API port $AI_API_PORT is available"
else
    NEW_AI_PORT=$(find_available_port 8001)
    echo "⚠️  AI API port $AI_API_PORT is in use, try: $NEW_AI_PORT"
    echo "   Set: export AI_API_PORT=$NEW_AI_PORT"
    echo "   And: export NEXT_PUBLIC_AGENT_API_URL=http://localhost:$NEW_AI_PORT"
fi

echo ""
echo "💡 To use different ports:"
echo "   Frontend: PORT=3001 npm run dev:frontend"
echo "   AI API:   AI_API_PORT=8001 npm run dev:ai"
