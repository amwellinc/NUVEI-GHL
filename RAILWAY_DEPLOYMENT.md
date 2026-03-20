# Railway Deployment Guide - GHL-NUVEI Custom App

This guide provides step-by-step instructions to deploy the GHL-NUVEI app to Railway.

## Prerequisites

- Railway account (railway.app)
- GitHub repository with GHL-NUVEI code
- GitHub account with repository access
- NUVEI SDK credentials:
  - Organization ID: `63`
  - SDK Username: `AMWELLMULTIPASS`
  - SDK Password: `amwellmultipass3306`
  - SDK Key: `64E9257352B95186DC86E598ECB97F5D49FB04D58F974051`
- Railway API Token: `90b92baf-0340-4df2-beb6-b4dc62d82601` (if using CLI)

## Method 1: Deploy via Railway Dashboard (Recommended)

### Step 1: Create a New Railway Project

1. Go to [railway.app](https://railway.app)
2. Click **"Create a new project"**
3. Select **"Deploy from GitHub repo"**
4. Connect your GitHub account if not already connected
5. Select the `GHL-NUVEI` repository

### Step 2: Add Node.js Service

1. Click **"Add"** in the Railway project
2. Select **"Dockerfile"** or **"Empty Service"** (Railway will auto-detect from Dockerfile)
3. Railway will automatically detect the `Dockerfile` in the root of the project
4. Click **"Deploy"**

### Step 3: Configure Environment Variables

1. In the Railway project dashboard, click on the service
2. Go to the **"Variables"** tab
3. Add the following environment variables:

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

4. Click **"Save"** to apply the variables

### Step 4: Configure Domain & Access

1. In the **"Settings"** tab, note your Railway deployment URL
2. The app will be available at: `https://<your-railway-app-id>.up.railway.app`
3. Test your deployment: `curl https://<your-railway-app-id>.up.railway.app/api/health`

### Step 5: Enable Auto-Deployment from GitHub

1. Go to the **"Deployments"** tab
2. Ensure **"Auto Deploy"** is enabled
3. Any push to your `main` branch will trigger automatic deployment

## Method 2: Deploy via Railway CLI

### Step 1: Install Railway CLI

```bash
npm install -g @railway/cli
```

### Step 2: Authenticate with Railway

```bash
# Using API token
railway login --token 90b92baf-0340-4df2-beb6-b4dc62d82601
```

### Step 3: Navigate to Project Directory

```bash
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
```

### Step 4: Link to Railway Project

```bash
railway init
```

Follow the prompts to create or select a project.

### Step 5: Add Environment Variables

Create a `.env.railway` file with:

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

Then in Railway CLI:

```bash
railway variables import < .env.railway
```

### Step 6: Deploy

```bash
railway up
```

## Method 3: Using Procfile (Alternative)

If Railway doesn't auto-detect the Dockerfile, you can use Procfile instead:

1. Railway will use `Procfile` which specifies: `web: node src/server.js`
2. Railway will use Node.js buildpack automatically
3. Follow the dashboard steps above for environment variables

## Testing After Deployment

### 1. Health Check Endpoint

```bash
curl https://<your-railway-url>/api/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2026-03-20T10:30:00.000Z",
  "uptime": 123.456
}
```

### 2. Create Payment Test (Optional)

```bash
curl -X POST https://<your-railway-url>/api/payments/create \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 10.00,
    "currency": "USD",
    "firstName": "Test",
    "lastName": "User",
    "email": "test@example.com",
    "phone": "+1234567890",
    "ccNumber": "4111111111111111",
    "ccExpMonth": "12",
    "ccExpYear": "2025",
    "ccCvv": "123"
  }'
```

### 3. View Logs

In Railway Dashboard:
1. Go to **"Logs"** tab
2. View real-time application logs
3. Check for any errors or connectivity issues with NUVEI

## Monitoring & Troubleshooting

### View Logs in Railway Dashboard

1. Click on your service
2. Go to **"Logs"** tab
3. Monitor deployment progress and application output

### Common Issues

**Issue: "NUVEI credentials not configured"**
- Verify all environment variables are set in Railway dashboard
- Check for typos in variable names
- Ensure values don't have extra spaces

**Issue: "Health check failing"**
- Wait 1-2 minutes for app to fully start
- Check logs for startup errors
- Verify memory/CPU allocation is sufficient

**Issue: NUVEI API connection errors**
- Verify `NUVEI_API_ENDPOINT` is correct
- Check SDK credentials are valid
- Ensure `NUVEI_SANDBOX_MODE` is set to `false` for production

### Enable Debug Logging

If troubleshooting, temporarily set in Railway dashboard:
```
LOG_LEVEL=debug
```

Then view logs to see detailed output.

## Rollback to Previous Deployment

1. In Railway dashboard, go to **"Deployments"** tab
2. Find the previous successful deployment
3. Click **"Redeploy"** to rollback

## Auto-Deployment from GitHub

Once connected, any push to your repository will trigger auto-deployment:

```bash
# After code changes
git add .
git commit -m "Fix: Update NUVEI client"
git push origin main

# Railway automatically deploys the changes
```

## Scaling & Optimization

### Monitor Resource Usage

1. Go to **"Metrics"** tab in Railway dashboard
2. View CPU and memory usage
3. Scale up if needed

### Set Memory/CPU Limits

1. In **"Settings"** tab
2. Adjust **"Max CPU"** and **"Max Memory"** as needed
3. Default: 512MB memory is sufficient for Node.js app

## Production Checklist

- [ ] Environment variables configured in Railway dashboard (not in code)
- [ ] `NUVEI_SANDBOX_MODE=false` for production
- [ ] Health check endpoint responding (200 status)
- [ ] NUVEI connectivity tested with real credentials
- [ ] Logs monitoring enabled
- [ ] Auto-deployment from GitHub enabled
- [ ] Rollback plan documented
- [ ] Team members have access to Railway project
- [ ] Alerts/notifications configured (optional)

## Additional Resources

- Railway Docs: https://docs.railway.app
- Node.js on Railway: https://docs.railway.app/guides/nodejs
- Docker on Railway: https://docs.railway.app/platforms/docker
- NUVEI API: https://developers.nuvei.com/

## Support

For Railway deployment issues:
- Check Railway documentation: docs.railway.app
- View application logs in Railway dashboard
- Contact Railway support: https://railway.app/support

For NUVEI API issues:
- Contact NUVEI support
- Check NUVEI API documentation

---

**Deployment Date:** March 20, 2026
**App Version:** 1.0.0
**Node.js Version:** 18-alpine
