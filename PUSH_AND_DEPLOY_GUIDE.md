# Complete Push to GitHub & Deploy to Railway Guide

## 🎯 Overview

This guide will walk you through:
1. Setting up Git locally
2. Pushing code to GitHub
3. Deploying to Railway

**Estimated Time:** 15-20 minutes

---

## ⏯️ Quick Start (TL;DR)

```bash
# 1. Navigate to project
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI

# 2. Configure Git (first time only)
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"

# 3. Initialize Git (if not done)
git init

# 4. Add all files
git add .

# 5. Commit changes
git commit -m "Setup: Add Railway deployment configuration"

# 6. Set remote
git remote add origin https://github.com/amwellinc/NUVEI-GHL.git

# 7. Push to GitHub
git push -u origin main

# 8. Deploy to Railway
npm install -g @railway/cli
railway login --token YOUR_RAILWAY_TOKEN
railway init
railway up
```

---

## 📝 DETAILED STEP-BY-STEP

### PART 1: Git Setup (First Time Only)

#### Step 1.1: Check if Git is Installed

```bash
git --version
```

**Expected Output:**
```
git version 2.x.x
```

If not installed on macOS:
```bash
# Using Homebrew
brew install git

# Or download from https://git-scm.com
```

#### Step 1.2: Configure Git User (Global - One Time)

```bash
git config --global user.name "Your Name"
git config --global user.email "your.email@example.com"
```

Replace with your actual name and email address.

**Verify:**
```bash
git config --global --list
```

You should see:
```
user.name=Your Name
user.email=your.email@example.com
```

#### Step 1.3: Setup GitHub Personal Access Token (Authentication)

Since GitHub deprecated password authentication for HTTPS:

1. Go to https://github.com/settings/tokens
2. Click "Generate new token (classic)"
3. Give it a name: "GHL-NUVEI Deployment"
4. Select scopes:
   - ✅ `repo` (Full control of private repositories)
   - ✅ `workflow` (Update GitHub Action workflows)
5. Click "Generate token"
6. **Copy the token** - you'll need it when pushing
7. Keep this token safe (don't share!)

---

### PART 2: Push Code to GitHub

#### Step 2.1: Navigate to Project Directory

```bash
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
```

#### Step 2.2: Check Git Status

```bash
git status
```

**Expected Output:**
```
On branch main

Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
        modified:   .env.example
        modified:   src/routes/payments.js
        ...

Untracked files:
  (use "git add <file>..." to include in what will be committed)
        Dockerfile
        .dockerignore
        RAILWAY_DEPLOYMENT.md
        ...
```

#### Step 2.3: Initialize Git (If Not Already Done)

```bash
# Check if .git folder exists
ls -la | grep ".git"

# If not, initialize
git init
```

#### Step 2.4: Add All Changes

```bash
git add .
```

**Verify what will be committed:**
```bash
git diff --cached --name-only
```

You should see all the new files and modified files.

#### Step 2.5: Create Your First Commit

```bash
git commit -m "Setup: Add Railway deployment configuration

- Added Dockerfile for multi-stage Node.js build
- Added .dockerignore and .railwayignore for optimization
- Added Procfile for Railway
- Enhanced src/server.js with logging and graceful shutdown
- Updated src/services/nuveiClient.js for SDK auth support
- Updated src/routes/payments.js for SDK auth support
- Updated .env.example with all required variables
- Added RAILWAY_DEPLOYMENT.md with complete guide
- Added RAILWAY_QUICK_REFERENCE.md for quick start"
```

#### Step 2.6: Configure GitHub Remote

```bash
# Add the GitHub repository as remote
git remote add origin https://github.com/amwellinc/NUVEI-GHL.git

# Verify
git remote -v
```

**Expected Output:**
```
origin  https://github.com/amwellinc/NUVEI-GHL.git (fetch)
origin  https://github.com/amwellinc/NUVEI-GHL.git (push)
```

#### Step 2.7: Push to GitHub

```bash
# Push to main branch
git push -u origin main
```

**First time only:** GitHub will ask for credentials:
- **Username:** Your GitHub username
- **Password:** Your Personal Access Token (from Step 1.3)

**Expected Output:**
```
Enumerating objects: 45, done.
Counting objects: 100% (45/45), done.
Delta compression using up to 8 threads
Compressing objects: 100% (38/38), done.
Writing objects: 100% (45/45), 15.23 KiB | 2.54 MiB/s, done.
Total 45 (delta 12), reused 0 (delta 0), pack-reused 0
remote: Reviewable by maintainers
To https://github.com/amwellinc/NUVEI-GHL.git
 * [new branch]      main -> main
Branch 'main' set to track remote branch 'main' from 'origin'.
```

✅ **Code is now pushed to GitHub!**

---

### PART 3: Deploy to Railway

#### Step 3.1: Install Railway CLI

```bash
npm install -g @railway/cli
```

**Verify:**
```bash
railway --version
```

#### Step 3.2: Authenticate with Railway

```bash
railway login --token YOUR_RAILWAY_TOKEN
```

**Expected Output:**
```
✓ Authenticated successfully
```

#### Step 3.3: Initialize Railway Project

```bash
# Make sure you're in the project directory
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI

# Initialize
railway init
```

**You'll see a prompt:**
```
? Create a new project or select an existing one?
❯ Create a new project
  Select an existing project
```

**Choose:** `Create a new project`

**Then you'll be asked:**
```
? Enter project name: (GHL-NUVEI)
```

Press Enter or enter a name. The default is fine.

**Expected Output:**
```
✓ Project created: GHL-NUVEI
✓ Environment created: production
```

#### Step 3.4: Configure Environment Variables

Create a temporary file with environment variables:

```bash
cat > /tmp/railway_env.txt << 'EOF'
NODE_ENV=production
PORT=3000
NUVEI_MERCHANT_ID=63
NUVEI_SDK_USERNAME=YOUR_NUVEI_SDK_USERNAME
NUVEI_SDK_PASSWORD=YOUR_NUVEI_SDK_PASSWORD
NUVEI_SDK_KEY=YOUR_NUVEI_SDK_KEY
NUVEI_API_ENDPOINT=https://secure.safecharge.com/api/v1
NUVEI_SANDBOX_MODE=false
LOG_LEVEL=info
EOF
```

Then import them:

```bash
railway variables import < /tmp/railway_env.txt
```

**Expected Output:**
```
✓ Variables imported successfully
```

#### Step 3.5: Deploy

```bash
railway up
```

This will:
1. Build your Docker image
2. Push to Railway
3. Start the container
4. Show deployment logs

**Expected Output (partial):**
```
✓ Building Docker image...
✓ Pushing to registry...
✓ Deployment started
✓ Application running at: https://ghl-nuvei-xxx.up.railway.app
```

The deployment typically takes 2-3 minutes.

#### Step 3.6: Verify Deployment

```bash
# Check deployment status
railway status

# View logs
railway logs

# Open in browser
railway open
```

Then navigate to: `https://<your-railway-url>/api/health`

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-03-20T10:30:00.000Z",
  "uptime": 123.45
}
```

---

## 🔧 Troubleshooting

### Git Issues

**Problem: "fatal: not a git repository"**
```bash
# Solution: Initialize git
git init
```

**Problem: "error: src refspec main does not match any"**
```bash
# Solution: Switch to correct branch first
git checkout -b main  # If main doesn't exist
```

**Problem: "Authentication failed"**
- Verify you're using Personal Access Token (not password)
- Token should be copied correctly from GitHub settings

### Railway Issues

**Problem: "NUVEI credentials not configured"**
- Verify all environment variables are set: `railway variables`
- Check variable names (case-sensitive)

**Problem: "Health check failing"**
- Wait 2-3 minutes for app to start
- Check logs: `railway logs`

**Problem: "Docker build failed"**
- Verify Dockerfile exists in root: `ls -la Dockerfile`
- Check syntax: `cat Dockerfile`

---

## ✅ Verification Checklist

- [ ] Git installed and configured
- [ ] GitHub token created
- [ ] Code committed to git
- [ ] Remote added: `git remote -v`
- [ ] Code pushed to GitHub (verify at github.com)
- [ ] Railway CLI installed
- [ ] Railway authenticated
- [ ] Railway project created
- [ ] Environment variables imported
- [ ] Deployment successful
- [ ] Health check passing

---

## 📚 Useful Commands

```bash
# Git
git status                    # Check status
git log --oneline            # View commit history
git branch                    # List branches
git diff                      # See changes

# Railway
railway status               # Deployment status
railway logs                 # View logs
railway open                 # Open app in browser
railway info                 # Get deployment info
railway variables            # View env variables
railway restart              # Restart app
```

---

## 🚀 You're Done!

Your app is now:
- ✅ Pushed to GitHub
- ✅ Deployed to Railway
- ✅ Running on production NUVEI credentials

**Next Steps:**
1. Test payment endpoints
2. Monitor logs in Railway dashboard
3. Set up auto-deployment on GitHub push (optional)
4. Configure custom domain (optional)

---

**Support:**
- Railway Docs: https://docs.railway.app
- GitHub Docs: https://docs.github.com
- NUVEI API: https://developers.nuvei.com/
