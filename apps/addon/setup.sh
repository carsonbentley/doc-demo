#!/bin/bash

# GrantComply Google Docs Add-on Setup Script
# This script helps set up the local development environment

set -e

echo "🚀 GrantComply Google Docs Add-on Setup"
echo "========================================"

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js first."
    echo "   Visit: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm found: $(npm --version)"

# Install clasp globally if not already installed
if ! command -v clasp &> /dev/null; then
    echo "📦 Installing Google Apps Script CLI (clasp)..."
    npm install -g @google/clasp
    echo "✅ clasp installed successfully"
else
    echo "✅ clasp found: $(clasp --version)"
fi

# Check if user is logged in to clasp
echo ""
echo "🔐 Checking Google Apps Script authentication..."

if ! clasp login --status &> /dev/null; then
    echo "⚠️  You need to login to Google Apps Script"
    echo "   Running: clasp login"
    echo ""
    clasp login
else
    echo "✅ Already logged in to Google Apps Script"
fi

# Enable Apps Script API if needed
echo ""
echo "🔧 Checking Apps Script API..."
echo "   Please ensure the Apps Script API is enabled at:"
echo "   https://script.google.com/home/usersettings"
echo ""

# Create .clasp.json if it doesn't exist
if [ ! -f ".clasp.json" ]; then
    echo "📝 Creating new Google Apps Script project..."
    echo "   This will create a new project in your Google Drive"
    echo ""
    
    read -p "Enter a name for your add-on project (default: GrantComply AI Assistant): " project_name
    project_name=${project_name:-"GrantComply AI Assistant"}
    
    clasp create --type standalone --title "$project_name"
    echo "✅ Project created successfully"
else
    echo "✅ Found existing .clasp.json"
fi

# Push the code to Google Apps Script
echo ""
echo "📤 Pushing code to Google Apps Script..."
clasp push

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "1. Open your project: clasp open"
echo "2. Test the add-on in Google Docs"
echo "3. Make sure your backend API is running on localhost:8000"
echo ""
echo "For deployment instructions, see README.md"
echo ""
echo "Happy coding! 🚀"
