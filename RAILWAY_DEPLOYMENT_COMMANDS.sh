#!/bin/bash
# Railway CLI Deployment Script
# Run this after pushing to GitHub

set -e  # Exit on error

echo "🚀 Railway CLI Deployment"
echo "======================="
echo ""

# Railway Token
RAILWAY_TOKEN="90b92baf-0340-4df2-beb6-b4dc62d82601"

# Step 1: Check if Railway CLI is installed
echo "📋 Step 1: Checking Railway CLI installation..."
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found"
    echo "Installing Railway CLI..."
    npm install -g @railway/cli
    echo "✅ Railway CLI installed"
else
    echo "✅ Railway CLI already installed"
    railway --version
fi
echo ""

# Step 2: Authenticate with Railway
echo "🔐 Step 2: Authenticating with Railway..."
railway login --token "$RAILWAY_TOKEN"
echo "✅ Authenticated with Railway"
echo ""

# Step 3: Navigate to project directory
echo "📂 Step 3: Navigating to project..."
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
echo "✅ In project directory: $(pwd)"
echo ""

# Step 4: Initialize Railway project
echo "🔧 Step 4: Initializing Railway project..."
echo ""
echo "Select existing project or create new:"
echo "(Follow the prompts to select or create a Railway project)"
echo ""
railway init
echo ""
echo "✅ Railway project initialized"
echo ""

# Step 5: Configure environment variables
echo "📝 Step 5: Setting environment variables..."
echo ""
echo "Adding production environment variables..."
echo ""

# Create temp env file
cat > /tmp/railway_env.txt << 'EOF'
NODE_ENV=production
PORT=3000
NUVEI_MERCHANT_ID=63
NUVEI_SDK_USERNAME=AMWELLMULTIPASS
NUVEI_SDK_PASSWORD=amwellmultipass3306
NUVEI_SDK_KEY=64E9257352B95186DC86E598ECB97F5D49FB04D58F974051
NUVEI_API_ENDPOINT=https://secure.safecharge.com/api/v1
NUVEI_SANDBOX_MODE=false
LOG_LEVEL=info
EOF

echo "Environment variables to be set:"
cat /tmp/railway_env.txt
echo ""
echo "Setting variables..."
railway variables import < /tmp/railway_env.txt

echo "✅ Environment variables configured"
echo ""

# Step 6: Deploy
echo "🚀 Step 6: Deploying to Railway..."
echo ""
echo "Deploying application..."
echo "(This may take 2-3 minutes...)"
echo ""
railway up
echo ""
echo "✅ Deployment started!"
echo ""

# Step 7: Get deployment info
echo "📊 Step 7: Getting deployment information..."
echo ""
echo "Deployment Status:"
railway status
echo ""

echo "🎉 Railway deployment initiated!"
echo ""
echo "=============================================="
echo "Next Steps:"
echo "=============================================="
echo ""
echo "1. Monitor deployment in Railway dashboard:"
echo "   https://railway.app"
echo ""
echo "2. Check logs:"
echo "   railway logs"
echo ""
echo "3. Test health endpoint:"
echo "   railway open"
echo "   Then navigate to: /api/health"
echo ""
echo "4. View deployment URL:"
echo "   railway info"
echo ""
echo "=============================================="
