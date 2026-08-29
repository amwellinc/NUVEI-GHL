# 🚀 One-Command Deployment Guide

Your complete automated deployment script is ready!

## ⚡ Quick Start (3 Steps)

### Step 1: Create GitHub Personal Access Token

1. Go to: https://github.com/settings/tokens
2. Click **"Generate new token (classic)"**
3. Name it: `GHL-NUVEI-Deploy`
4. Select scopes:
   - ✅ `repo` (Full control of repositories)
   - ✅ `workflow`
5. Click **"Generate token"**
6. **Copy the token** (you'll need it in Step 2)

### Step 2: Make Script Executable

```bash
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
chmod +x deploy.sh
```

### Step 3: Run the Deployment

```bash
bash deploy.sh
```

The script will:
1. ✓ Configure Git (ask for your name/email - first time only)
2. ✓ Commit and push to GitHub
   - *When prompted, use your GitHub Personal Access Token as password*
3. ✓ Deploy to Railway
   - *Sets up project, configures environment variables, deploys the app*
4. ✓ Displays deployment info and next steps

**Total time:** ~5-10 minutes

---

## 📋 What the Script Does

```
✓ Git Setup
  ├─ Checks if Git is installed
  ├─ Configures user name/email (first time)
  ├─ Initializes repository
  ├─ Stages all files
  └─ Creates commit

✓ GitHub
  ├─ Configures remote
  └─ Pushes to: https://github.com/amwellinc/NUVEI-GHL

✓ Railway
  ├─ Installs Railway CLI
  ├─ Authenticates with your token
  ├─ Creates project: GHL-NUVEI
  ├─ Configures environment variables
  └─ Deploys application

✓ Verification
  └─ Shows deployment URL and next steps
```

---

## 🔑 Environment Variables Configured

| Variable | Value |
|----------|-------|
| `NODE_ENV` | `production` |
| `PORT` | `3000` |
| `NUVEI_MERCHANT_ID` | `63` |
| `NUVEI_SDK_USERNAME` | `YOUR_NUVEI_SDK_USERNAME` |
| `NUVEI_SDK_PASSWORD` | `YOUR_NUVEI_SDK_PASSWORD` |
| `NUVEI_SDK_KEY` | `YOUR_NUVEI_SDK_KEY` |
| `NUVEI_API_ENDPOINT` | `https://secure.safecharge.com/api/v1` |
| `NUVEI_SANDBOX_MODE` | `false` |
| `LOG_LEVEL` | `info` |

---

## ❓ If You're Stuck

### "Permission denied: ./deploy.sh"
```bash
chmod +x deploy.sh
bash deploy.sh
```

### "Command not found: git"
- Install Git: https://git-scm.com
- macOS: `brew install git`

### "GitHub push failed with authentication"
- Use **Personal Access Token** (not password)
- Token must have `repo` and `workflow` scopes
- Create here: https://github.com/settings/tokens

### "Railway push failed"
- Railway token is already configured in script
- Check: `railway login --token YOUR_RAILWAY_TOKEN`

### "Deployment status unclear"
After script completes, check manually:
```bash
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
railway logs          # View logs
railway status        # Check status
railway open          # Open in browser
```

---

## ✅ Success Checklist

- [ ] GitHub Personal Access Token created
- [ ] `deploy.sh` is executable
- [ ] Ran: `bash deploy.sh`
- [ ] Script completed without errors
- [ ] Health check responds: `https://<railway-url>/api/health`
- [ ] Logs show "listening on port 3000"

---

## 📚 Documentation

After deployment, see:
- **[RAILWAY_DEPLOYMENT.md](RAILWAY_DEPLOYMENT.md)** — Full deployment guide
- **[RAILWAY_QUICK_REFERENCE.md](RAILWAY_QUICK_REFERENCE.md)** — Quick reference
- **[PUSH_AND_DEPLOY_GUIDE.md](PUSH_AND_DEPLOY_GUIDE.md)** — Manual step-by-step

---

## 🎯 Ready?

```bash
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
chmod +x deploy.sh
bash deploy.sh
```

That's it! Your app will be live on Railway in ~5 minutes. 🚀
