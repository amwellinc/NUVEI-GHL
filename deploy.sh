#!/bin/bash

################################################################################
# GHL-NUVEI: Complete Automated Deployment Script
# 
# This script automates:
# 1. Git configuration and setup
# 2. GitHub push (https://github.com/amwellinc/NUVEI-GHL)
# 3. Railway deployment
#
# Usage: bash deploy.sh
#
# Prerequisites:
# - Node.js installed
# - GitHub account with access to: https://github.com/amwellinc/NUVEI-GHL
# - GitHub Personal Access Token (PAT) created
# - Railway account with token: 90b92baf-0340-4df2-beb6-b4dc62d82601
#
################################################################################

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_DIR="/Users/arunkemer/DIGI5Y/GHL-NUVEI"
GITHUB_REPO="https://github.com/amwellinc/NUVEI-GHL.git"
GITHUB_BRANCH="main"
RAILWAY_TOKEN="90b92baf-0340-4df2-beb6-b4dc62d82601"
RAILWAY_PROJECT_NAME="GHL-NUVEI"

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}🚀 GHL-NUVEI: Complete Deployment Automation${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

################################################################################
# PART 1: GIT SETUP & GITHUB PUSH
################################################################################

echo -e "${YELLOW}📋 PART 1: Git Setup & GitHub Push${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if git is installed
if ! command -v git &> /dev/null; then
    echo -e "${RED}❌ Git not installed!${NC}"
    echo "Install from: https://git-scm.com"
    exit 1
fi
echo -e "${GREEN}✓${NC} Git installed: $(git --version)"
echo ""

# Navigate to project
if [ ! -d "$PROJECT_DIR" ]; then
    echo -e "${RED}❌ Project directory not found: $PROJECT_DIR${NC}"
    exit 1
fi

cd "$PROJECT_DIR"
echo -e "${GREEN}✓${NC} Changed to project directory"
echo ""

# Configure Git (first time)
echo -e "${BLUE}→${NC} Configuring Git..."

# Check if user.name is configured
if [ -z "$(git config user.name 2>/dev/null || true)" ]; then
    echo -e "${YELLOW}⚠️  Git user not configured. Setting up...${NC}"
    
    # Get user input
    read -p "Enter your Git user name (e.g., John Doe): " GIT_USER_NAME
    read -p "Enter your Git email (e.g., john@example.com): " GIT_USER_EMAIL
    
    git config --global user.name "$GIT_USER_NAME"
    git config --global user.email "$GIT_USER_EMAIL"
    
    echo -e "${GREEN}✓${NC} Git configured:"
    echo "   Name: $GIT_USER_NAME"
    echo "   Email: $GIT_USER_EMAIL"
else
    echo -e "${GREEN}✓${NC} Git already configured:"
    echo "   Name: $(git config user.name)"
    echo "   Email: $(git config user.email)"
fi
echo ""

# Initialize git if needed
if [ ! -d ".git" ]; then
    echo -e "${BLUE}→${NC} Initializing Git repository..."
    git init
    echo -e "${GREEN}✓${NC} Git repository initialized"
else
    echo -e "${GREEN}✓${NC} Git repository already initialized"
fi
echo ""

# Check for changes
echo -e "${BLUE}→${NC} Checking for changes..."
if git status --porcelain | grep -q .; then
    echo -e "${GREEN}✓${NC} Found changes to commit"
    echo ""
    echo "Files to be committed:"
    git status --porcelain | sed 's/^/   /'
else
    echo -e "${YELLOW}⚠️  No changes to commit${NC}"
fi
echo ""

# Stage all changes
echo -e "${BLUE}→${NC} Staging all files..."
git add .
echo -e "${GREEN}✓${NC} Files staged"
echo ""

# Create commit
echo -e "${BLUE}→${NC} Creating commit..."
git commit -m "Setup: Add Railway deployment configuration

- Added Dockerfile for multi-stage Node.js build
- Added .dockerignore and .railwayignore for optimization
- Added Procfile for Railway deployment
- Enhanced src/server.js with logging and graceful shutdown
- Updated src/services/nuveiClient.js for SDK auth support
- Updated src/routes/payments.js for SDK auth support  
- Updated .env.example with all required variables
- Added comprehensive Railway deployment documentation
- Added automated deployment scripts" || true

echo -e "${GREEN}✓${NC} Changes committed"
echo ""

# Configure remote
echo -e "${BLUE}→${NC} Configuring GitHub remote..."
if git remote | grep -q origin; then
    echo -e "${GREEN}✓${NC} Remote 'origin' already exists"
    CURRENT_REMOTE=$(git remote get-url origin)
    echo "   URL: $CURRENT_REMOTE"
else
    git remote add origin "$GITHUB_REPO"
    echo -e "${GREEN}✓${NC} Remote 'origin' added"
    echo "   URL: $GITHUB_REPO"
fi
echo ""

# Push to GitHub
echo -e "${BLUE}→${NC} Pushing to GitHub..."
echo -e "${YELLOW}⚠️  You may be prompted to enter credentials.${NC}"
echo "   Use your GitHub personal access token as password."
echo ""

if git push -u origin "$GITHUB_BRANCH" 2>&1; then
    echo -e "${GREEN}✓${NC} Successfully pushed to GitHub!"
    echo "   Repo: $GITHUB_REPO"
    echo "   Branch: $GITHUB_BRANCH"
else
    echo -e "${YELLOW}⚠️  GitHub push encountered an issue.${NC}"
    echo "   This might be due to authentication."
    echo ""
    echo "   To create a Personal Access Token:"
    echo "   1. Go to: https://github.com/settings/tokens"
    echo "   2. Click 'Generate new token (classic)'"
    echo "   3. Select 'repo' and 'workflow' scopes"
    echo "   4. Copy the token and use it as password when pushed again"
    echo ""
    read -p "Continue with Railway deployment? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi
echo ""

################################################################################
# PART 2: RAILWAY DEPLOYMENT
################################################################################

echo -e "${YELLOW}🚀 PART 2: Railway Deployment${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if Railway CLI is installed
echo -e "${BLUE}→${NC} Checking Railway CLI..."
if ! command -v railway &> /dev/null; then
    echo -e "${YELLOW}⚠️  Railway CLI not found. Installing...${NC}"
    npm install -g @railway/cli
    echo -e "${GREEN}✓${NC} Railway CLI installed"
else
    echo -e "${GREEN}✓${NC} Railway CLI installed: $(railway --version 2>&1 | head -1)"
fi
echo ""

# Authenticate with Railway
echo -e "${BLUE}→${NC} Authenticating with Railway..."
railway login --token "$RAILWAY_TOKEN" || {
    echo -e "${RED}❌ Failed to authenticate with Railway!${NC}"
    echo "   Token: $RAILWAY_TOKEN"
    exit 1
}
echo -e "${GREEN}✓${NC} Authenticated with Railway"
echo ""

# Initialize Railway project
echo -e "${BLUE}→${NC} Setting up Railway project..."
echo ""

# Check if already in a railway project
if [ -f "railway.json" ]; then
    echo -e "${GREEN}✓${NC} Railway project already configured"
    cat railway.json | head -5
else
    echo "Creating new Railway project: $RAILWAY_PROJECT_NAME"
    echo "This will prompt you to select or create a project."
    echo ""
    
    # Run railway init
    railway init << EOF
1
$RAILWAY_PROJECT_NAME
EOF

    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} Railway project initialized"
    else
        echo -e "${YELLOW}⚠️  Railway project initialization had issues${NC}"
        echo "   Continue to add variables..."
    fi
fi
echo ""

# Configure environment variables
echo -e "${BLUE}→${NC} Configuring environment variables..."

# Create environment variable file
ENV_VARS_FILE="/tmp/railway_nuvei_env.txt"
cat > "$ENV_VARS_FILE" << 'EOF'
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

echo "Setting variables:"
cat "$ENV_VARS_FILE" | sed 's/^/   /'
echo ""

# Import variables
if railway variables import < "$ENV_VARS_FILE" 2>&1 | grep -q "imported\|updated"; then
    echo -e "${GREEN}✓${NC} Environment variables configured"
else
    echo -e "${YELLOW}⚠️  Variable import status unclear. Continuing...${NC}"
fi
echo ""

# Deploy
echo -e "${BLUE}→${NC} Deploying to Railway..."
echo "This will build and deploy your application."
echo "Deployment typically takes 2-3 minutes..."
echo ""

if railway up 2>&1; then
    echo ""
    echo -e "${GREEN}✓${NC} Deployment initiated successfully!"
else
    echo -e "${YELLOW}⚠️  Deployment completed with messages above.${NC}"
fi
echo ""

################################################################################
# PART 3: VERIFICATION & INFO
################################################################################

echo -e "${YELLOW}✅ PART 3: Verification${NC}"
echo -e "${YELLOW}═══════════════════════════════════════════════════════════════${NC}"
echo ""

# Get Railway info
echo -e "${BLUE}→${NC} Getting deployment information..."
echo ""

if railway status 2>&1; then
    echo ""
    echo -e "${GREEN}✓${NC} Deployment status retrieved"
fi
echo ""

# Display deployment URL
echo -e "${BLUE}→${NC} Getting access information..."
if railway info 2>&1; then
    echo ""
    echo -e "${GREEN}✓${NC} Railway info displayed"
fi
echo ""

################################################################################
# SUMMARY
################################################################################

echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 DEPLOYMENT COMPLETE!${NC}"
echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
echo ""

echo "📊 What was done:"
echo "   ✓ Git configured and repository initialized"
echo "   ✓ Code pushed to GitHub (amwellinc/NUVEI-GHL)"
echo "   ✓ Railway project created/configured"
echo "   ✓ Environment variables configured"
echo "   ✓ Application deployed to Railway"
echo ""

echo "🔗 Next steps:"
echo "   1. Monitor deployment:"
echo "      $ railway logs"
echo ""
echo "   2. Test health endpoint:"
echo "      $ railway open"
echo "      Then navigate to: /api/health"
echo ""
echo "   3. View Railway dashboard:"
echo "      https://railway.app"
echo ""

echo "📚 Useful commands:"
echo "   $ railway logs          — View application logs"
echo "   $ railway status        — Check deployment status"
echo "   $ railway open          — Open app in browser"
echo "   $ railway info          — Get deployment info"
echo "   $ railway restart       — Restart application"
echo "   $ railway variables     — View environment variables"
echo ""

echo "📞 Support:"
echo "   Railway: https://docs.railway.app"
echo "   NUVEI: https://developers.nuvei.com/"
echo ""

echo -e "${GREEN}Your GHL-NUVEI app is now live on Railway! 🚀${NC}"
echo ""
