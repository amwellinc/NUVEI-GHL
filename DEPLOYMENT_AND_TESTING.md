# Deployment & Testing Guide

Complete step-by-step guide to deploy your GHL-NUVEI integration to Railway and test all endpoints.

## ⚡ Quick Deploy (3 Commands)

```bash
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI
chmod +x deploy-and-test.sh
bash deploy-and-test.sh
```

The script will:
1. ✅ Commit all changes
2. ✅ Push to GitHub
3. ✅ Trigger Railway deployment
4. ✅ Test all endpoints
5. ✅ Show results

---

## 📋 Manual Deployment (Step-by-Step)

### Step 1: Commit Changes

```bash
cd /Users/arunkemer/DIGI5Y/GHL-NUVEI

# Stage all changes
git add .

# Commit with message
git commit -m "Feature: Add GoHighLevel (GHL) integration

- Integrate NUVEI with GoHighLevel location: RbHDcK8ndpcPpcny4nga
- Add GHL client service and 6 new endpoints
- Auto-link payments to GHL contacts
- Add comprehensive documentation"

# Verify commit
git log --oneline -5
```

### Step 2: Push to GitHub

```bash
# Set your GitHub token first
export GITHUB_TOKEN='your_github_personal_access_token'

# Push to main branch
git push -u origin main
```

**Expected Output:**
```
Enumerating objects: 15, done.
Counting objects: 100% (15/15), done.
Delta compression using up to 8 threads
Compressing objects: 100% (12/12), done.
Writing objects: 100% (15/15), 5.42 KiB | 1.36 MiB/s, done.
Total 15 (delta 8), reused 0 (delta 0), pack-reused 0
To https://github.com/amwellinc/NUVEI-GHL.git
   abc1234..def5678  main -> main
Branch 'main' set to track remote branch 'main' from 'origin'.
```

### Step 3: Railway Auto-Deploy

Railway automatically detects the push and deploys:

```bash
# Check deployment status (optional)
railway login --token 90b92baf-0340-4df2-beb6-b4dc62d82601
railway status

# View logs
railway logs

# Get deployment info
railway info
```

**Typical deployment time: 2-3 minutes**

### Step 4: Update Railway Environment Variables

**Important:** Add GHL credentials to Railway dashboard

1. Go to: **https://railway.app**
2. Select your **GHL-NUVEI** project
3. Click on the **Service**
4. Go to **Variables** tab
5. Add/Update these variables:

```
GHL_LOCATION_ID=RbHDcK8ndpcPpcny4nga
GHL_API_TOKEN=pit-9c347602-6af4-48a9-be68-4ba38fdda722
```

6. Click **Save** → Railway automatically redeploys!

---

## 🧪 Testing All Endpoints

### Setup: Get Your Railway URL

```bash
# Option 1: Via Railway CLI
railway open --browser=false

# Option 2: Via Dashboard
# https://railway.app → Select Project → Get URL

# Example URL:
# https://ghl-nuvei-xyz123.up.railway.app
```

### Test 1: Health Check (Should Pass Immediately)

```bash
curl -X GET https://your-railway-url/api/health
```

**Expected Response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-03-20T10:30:00.000Z",
  "uptime": 45.23
}
```

✅ **Status: 200 OK**

---

### Test 2: GHL Integration Status (After Setting Env Vars)

```bash
curl -X GET https://your-railway-url/api/ghl/status
```

**Expected Response (After setting GHL_API_TOKEN):**
```json
{
  "success": true,
  "message": "GHL integration active",
  "location": {
    "id": "RbHDcK8ndpcPpcny4nga",
    "name": "Your Location Name",
    "email": "location@example.com"
  }
}
```

✅ **Status: 200 OK**

---

### Test 3: List GHL Contacts

```bash
curl -X GET https://your-railway-url/api/ghl/contacts
```

**Expected Response:**
```json
{
  "success": true,
  "contacts": [
    {
      "id": "contact-123",
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com"
    },
    ...
  ],
  "totalCount": 25
}
```

✅ **Status: 200 OK**

---

### Test 4: Create Payment with GHL Integration

First, get a contact ID from Test 3, then:

```bash
CONTACT_ID="contact-123"  # Replace with actual contact ID
RAILWAY_URL="https://your-railway-url"

curl -X POST $RAILWAY_URL/api/ghl/payment/create \
  -H "Content-Type: application/json" \
  -d '{
    "contactId": "'$CONTACT_ID'",
    "amount": 99.99,
    "currency": "USD",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "ccNumber": "4111111111111111",
    "ccExpMonth": "12",
    "ccExpYear": "2025",
    "ccCvv": "123"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Payment processed and linked to GHL contact",
  "payment": {
    "transactionId": "12345678",
    "status": "SUCCESS",
    "amount": 99.99,
    "currency": "USD",
    "ghlContactId": "contact-123"
  }
}
```

✅ **Status: 200 OK**
✅ **Payment recorded in GHL contact**

---

### Test 5: Refund Payment

```bash
TRANSACTION_ID="12345678"  # From Test 4 response
CONTACT_ID="contact-123"

curl -X POST $RAILWAY_URL/api/ghl/payment/refund \
  -H "Content-Type: application/json" \
  -d '{
    "transactionId": "'$TRANSACTION_ID'",
    "contactId": "'$CONTACT_ID'",
    "amount": 99.99,
    "currency": "USD",
    "description": "Test refund"
  }'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Refund processed and recorded in GHL",
  "refund": {
    "transactionId": "12345678",
    "refundStatus": "SUCCESS",
    "amount": 99.99,
    "ghlContactId": "contact-123"
  }
}
```

✅ **Status: 200 OK**

---

## ✅ Verification Checklist

After deployment, verify:

- [ ] Can access health endpoint: `/api/health` (Status 200)
- [ ] GHL status endpoint accessible: `/api/ghl/status`
- [ ] Can list contacts: `/api/ghl/contacts`
- [ ] Payment endpoint exists: `/api/ghl/payment/create`
- [ ] Refund endpoint exists: `/api/ghl/payment/refund`
- [ ] App logs show no errors: `railway logs`
- [ ] GHL credentials working in Railway
- [ ] Payment recorded in GHL contact

---

## 🐛 Troubleshooting

### App Health Check Fails

**Problem:** `GET /api/health` returns 503 or no response

**Solution:**
- Wait 1-2 more minutes (app may still be starting)
- Check Railway logs: `railway logs`
- Verify app hasn't crashed: `railway status`

---

### GHL Status Returns 500 Error

**Problem:** `GET /api/ghl/status` returns 500 with "GHL credentials not configured"

**Solution:**
1. Go to Railway dashboard
2. Select your service
3. Go to Variables tab
4. Verify both variables are set:
   - `GHL_LOCATION_ID=RbHDcK8ndpcPpcny4nga`
   - `GHL_API_TOKEN=pit-9c347602-6af4-48a9-be68-4ba38fdda722`
5. Check that there are no extra spaces in values
6. Railway should auto-redeploy within 1-2 minutes

---

### Payment Creation Fails with "GHL credentials not configured"

**Same as above** - ensure GHL env vars are set in Railway

---

### "Contact not found" Error

**Problem:** Payment creation fails with contactId

**Solution:**
- Use `/api/ghl/contacts` endpoint to get valid contact IDs
- Verify contact exists in GHL
- Check contact ID spelling

---

### "NUVEI credentials not configured"

**Problem:** Payment endpoint returns 500

**Solution:**
- Railway deployment should have NUVEI credentials from before
- Check Railway Variables for NUVEI settings:
  - `NUVEI_SDK_USERNAME`
  - `NUVEI_SDK_PASSWORD`
  - `NUVEI_SDK_KEY`

---

## 📊 Monitoring After Deployment

### View Real-Time Logs

```bash
railway logs
```

Shows all app output including:
- Request logs
- Error messages
- Payment processing details

### Check Deployment Status

```bash
railway status
```

Shows:
- Deployment state (Running, Building, etc.)
- Memory/CPU usage
- Uptime

### Monitor Performance

Railway Dashboard shows:
- Request counts
- Response times
- Error rates
- Memory/CPU graphs

---

## 🔄 Redeployment

To redeploy after code changes:

```bash
# Make changes
git add .
git commit -m "Your changes"

# Push - Railway auto-deploys
git push origin main

# Monitor deployment
railway logs
```

No manual deployment needed - Railway watches GitHub and auto-deploys!

---

## ✨ Success Indicators

Your deployment is successful when:

1. ✅ Health endpoint returns 200
2. ✅ GHL status endpoint returns location info
3. ✅ Can list GHL contacts
4. ✅ Can create payments linked to contacts
5. ✅ No errors in logs
6. ✅ Payments appear as notes in GHL contacts

---

## 📞 Support

- **GHL Integration:** See `GHL_INTEGRATION.md`
- **Deployment Issues:** See `RAILWAY_DEPLOYMENT.md`
- **Railway Logs:** `railway logs` command
- **Health Status:** `GET /api/health` endpoint

---

## 🎯 Test Summary Table

| Endpoint | Method | Expected Status | Description |
|----------|--------|-----------------|-------------|
| `/api/health` | GET | 200 | Health check |
| `/api/ghl/status` | GET | 200 | GHL connection |
| `/api/ghl/contacts` | GET | 200 | List contacts |
| `/api/ghl/contacts/:id` | GET | 200 | Get contact |
| `/api/ghl/payment/create` | POST | 200 | Create payment |
| `/api/ghl/payment/refund` | POST | 200 | Process refund |
| `/api/ghl/webhook/payment-status` | POST | 200 | Status webhook |

---

**Your GHL-NUVEI app is production-ready!** 🚀
