# Quick Start: Deploy to Railway

## 🚀 Fastest Way (5 minutes)

### Step 1: Push to GitHub (if not already done)

```bash
cd c:\Users\NAVID\Desktop\learn
git add .
git commit -m "Prepare for Railway deployment"
git push
```

### Step 2: Deploy via Railway Dashboard

1. Go to **[railway.app](https://railway.app)** and sign in
2. Click **"New Project"**
3. Select **"Deploy from GitHub repo"**
4. Choose your repository
5. Railway will auto-detect Python and start deploying

### Step 3: Add Volume (CRITICAL for SQLite)

In your service settings:
1. Click **"Volumes"** tab
2. Click **"+ New Volume"**
3. Mount path: `/app/data`
4. Save

### Step 4: Set Environment Variables

In **"Variables"** tab, add:

```
OPENAI_API_KEY=sk-your-key-here
CORS_ORIGINS=http://localhost:3000,https://your-frontend.com
CHECKPOINT_DB_PATH=/app/data/checkpoints.db
```

### Step 5: Redeploy

Click **"Deploy"** or push a new commit to trigger redeployment.

---

## ✅ Verify It's Working

Your API will be at: `https://[your-service-name].up.railway.app`

Test it:
```bash
curl https://your-service-name.up.railway.app/health
```

View docs: `https://your-service-name.up.railway.app/docs`

---

## 💰 Free Tier

- **$5 credit** for first 30 days
- Then **$1/month** free tier
- Upgrade to **Hobby ($5/month)** for continuous operation

---

## 📝 Need Help?

See full guide: `RAILWAY_DEPLOYMENT.md`
