#!/bin/bash
# GHL-NUVEI Push & Deploy Script
# This script will push your code to GitHub and deploy to Railway

set -e  # Exit on error

echo "🚀 GHL-NUVEI GitHub Push & Railway Deployment"
echo "=============================================="
echo ""

# Step 1: Configure Git
echo "📋 Step 1: Setting up Git..."
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI

# Check if git is initialized
if [ ! -d .git ]; then
    echo "❌ Git not initialized. Run: git init"
    exit 1
fi

# Configure git user (optional - replace with your info)
# git config user.name "Your Name"
# git config user.email "your.email@example.com"
echo "✅ Git configured"
echo ""

# Step 2: Check git status
echo "📊 Step 2: Checking git status..."
git status
echo ""

# Step 3: Stage all changes
echo "📝 Step 3: Staging all changes..."
git add .
echo "✅ All files staged"
echo ""

# Step 4: Show what will be committed
echo "📋 Files to be committed:"
git diff --cached --name-only
echo ""

# Step 5: Commit changes
echo "💾 Step 5: Committing changes..."
git commit -m "Setup: Add Railway deployment configuration
- Added Dockerfile for multi-stage Node.js build
- Added .dockerignore and .railwayignore
- Added Procfile for Railway
- Enhanced src/server.js with logging and graceful shutdown
- Updated src/services/nuveiClient.js for SDK auth support
- Updated src/routes/payments.js for SDK auth support
- Updated .env.example with all required variables
- Added RAILWAY_DEPLOYMENT.md with complete guide
- Added RAILWAY_QUICK_REFERENCE.md for quick start"
echo "✅ Changes committed"
echo ""

# Step 6: Add remote (if not already added)
echo "🔗 Step 6: Configuring GitHub remote..."
if git remote | grep -q origin; then
    echo "✅ Remote 'origin' already configured"
    git remote -v
else
    echo "Adding GitHub repository..."
    git remote add origin https://github.com/amwellinc/NUVEI-GHL.git
    echo "✅ Remote 'origin' added"
fi
echo ""

# Step 7: Verify connection
echo "🔐 Step 7: Verifying GitHub connection..."
echo "⚠️  You may be prompted to authenticate with GitHub"
echo "   (If using HTTPS, GitHub may ask for Personal Access Token)"
echo ""

# Step 8: Push to GitHub
echo "📤 Step 8: Pushing to GitHub..."
git push -u origin main
echo "✅ Code pushed to GitHub successfully!"
echo ""

# Step 9: Verify push
echo "✅ Step 9: Verifying push..."
git log --oneline -5
echo ""

echo "🎉 GitHub push complete!"
echo ""
echo "=============================================="
echo "Next: Deploy to Railway"
echo "=============================================="
echo ""
echo "Option A: Via Railway Dashboard (Easiest)"
echo "1. Go to https://railway.app"
echo "2. Create new project"
echo "3. Select 'Deploy from GitHub'"
echo "4. Connect to: https://github.com/amwellinc/NUVEI-GHL"
echo "5. Add environment variables (see RAILWAY_QUICK_REFERENCE.md)"
echo "6. Deploy!"
echo ""
echo "Option B: Via Railway CLI"
echo "Run the commands in: RAILWAY_DEPLOYMENT_COMMANDS.sh"
echo ""
echo "=============================================="
