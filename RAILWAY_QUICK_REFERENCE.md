# Railway Deployment Quick Reference

## 🚀 Quick Start

### Option A: Dashboard (Easiest)
1. Go to railway.app → Create Project
2. Select "Deploy from GitHub" → Choose GHL-NUVEI repo
3. Add Variables (see below)
4. Deploy ✅

### Option B: CLI
```bash
npm install -g @railway/cli
railway login --token 90b92baf-0340-4df2-beb6-b4dc62d82601
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
railway up
```

## ⚙️ Required Environment Variables

```
NODE_ENV=production
PORT=3000
NUVEI_MERCHANT_ID=63
NUVEI_SDK_USERNAME=AMWELLMULTIPASS
NUVEI_SDK_PASSWORD=amwellmultipass3306
NUVEI_SDK_KEY=64E9257352B95186DC86E598ECB97F5D49FB04D58F974051
NUVEI_API_ENDPOINT=https://secure.safecharge.com/api/v1
NUVEI_SANDBOX_MODE=false
LOG_LEVEL=info
```

## 🔍 Verify Deployment

```bash
# Health check
curl https://<your-railway-url>/api/health

# Should return:
# {"status":"healthy","timestamp":"...","uptime":...}
```

## 📝 Files Added/Modified

**New Files:**
- `Dockerfile` — Multi-stage Node.js build
- `.dockerignore` — Docker ignore rules
- `Procfile` — Start command for Railway
- `.railwayignore` — Railway ignore rules
- `RAILWAY_DEPLOYMENT.md` — Full deployment guide

**Modified Files:**
- `src/server.js` — Enhanced logging, graceful shutdown
- `.env.example` — Updated with SDK credentials
- `src/services/nuveiClient.js` — SDK auth support
- `src/routes/payments.js` — SDK auth support

## 📚 Documentation

- Full guide: `RAILWAY_DEPLOYMENT.md`
- All 3 deployment methods explained
- Troubleshooting tips included
- Production checklist included

## 🎯 Next Steps

1. Push code to GitHub (`git push origin main`)
2. Go to railway.app
3. Create project and connect GitHub repo
4. Add environment variables
5. Verify health check: `/api/health`
6. Test payment endpoint (optional)

## ✅ Deployment Checklist

- [ ] All files created/updated
- [ ] Code pushed to GitHub
- [ ] Railway project created
- [ ] GitHub repo connected to Railway
- [ ] Environment variables configured
- [ ] Deployment successful (check logs)
- [ ] Health check endpoint responding
- [ ] Auto-deployment enabled

---

**Support:** See RAILWAY_DEPLOYMENT.md for detailed instructions
