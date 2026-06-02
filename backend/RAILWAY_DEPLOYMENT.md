# Deploy FastAPI Backend to Railway.app

## Prerequisites

1. **GitHub/GitLab/Bitbucket account** - Your code must be in a Git repository
2. **Railway account** - Sign up at [railway.app](https://railway.app)
3. **OpenAI API Key** - For the symptom checker functionality

## Quick Start (Recommended Method)

### Option 1: Deploy from GitHub (Easiest)

1. **Push your code to GitHub** (if not already done)
   ```bash
   cd c:\Users\NAVID\Desktop\learn\backend
   git init
   git add .
   git commit -m "Initial commit for Railway deployment"
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

2. **Go to Railway Dashboard**
   - Visit [railway.app](https://railway.app)
   - Click **"Start a New Project"**
   - Select **"Deploy from GitHub repo"**
   - Choose your repository
   - Select the `backend` folder (if monorepo) or root

3. **Railway will auto-detect:**
   - Python runtime (from `runtime.txt`)
   - Dependencies (from `requirements.txt`)
   - Start command (will use: `uvicorn main:app --host 0.0.0.0 --port $PORT`)

4. **Add a Volume for Persistent Storage**
   - In your service settings, go to **"Volumes"**
   - Click **"+ New Volume"**
   - Mount path: `/app/data`
   - Size: 1GB (more than enough for SQLite)

5. **Set Environment Variables**
   - Go to **"Variables"** tab
   - Add these variables:
   
   ```
   OPENAI_API_KEY=your_openai_api_key_here
   CORS_ORIGINS=https://your-frontend-url.com
   CHECKPOINT_DB_PATH=/app/data/checkpoints.db
   PYTHON_VERSION=3.11.9
   ```

6. **Deploy**
   - Click **"Deploy"**
   - Your API will be live at: `https://your-service.railway.app`

---

## Option 2: Deploy using Railway CLI

### Install Railway CLI

**Windows (PowerShell):**
```powershell
iwr https://railway.app/install.ps1 | iex
```

**Or using npm:**
```bash
npm install -g @railway/cli
```

### Deploy Steps

1. **Login to Railway**
   ```bash
   railway login
   ```

2. **Navigate to backend folder**
   ```bash
   cd c:\Users\NAVID\Desktop\learn\backend
   ```

3. **Initialize Railway project**
   ```bash
   railway init
   ```
   - This creates a new project on Railway
   - Links your local folder to the Railway project

4. **Add a Volume**
   ```bash
   railway volume create
   ```
   - Name it: `symptom-checker-data`
   - Mount path: `/app/data`

5. **Set environment variables**
   ```bash
   railway variables set OPENAI_API_KEY=your_key_here
   railway variables set CORS_ORIGINS=https://your-frontend.com
   railway variables set CHECKPOINT_DB_PATH=/app/data/checkpoints.db
   railway variables set PYTHON_VERSION=3.11.9
   ```

6. **Deploy**
   ```bash
   railway up
   ```

7. **Get your deployment URL**
   ```bash
   railway domain
   ```

---

## Configuration Files

### railway.toml (already created)

Railway will automatically use this configuration:
```toml
[build]
builder = "nixpacks"

[deploy]
startCommand = "uvicorn main:app --host 0.0.0.0 --port $PORT"
restartPolicyType = "on_failure"
restartPolicyMaxRetries = 10
```

### Nixpacks auto-detection

Railway uses Nixpacks which automatically:
- Detects Python from `runtime.txt` (3.11.9)
- Installs dependencies from `requirements.txt`
- Sets up the correct Python environment

---

## Important: Volume Configuration

⚠️ **Critical for SQLite persistence:**

Your SQLite database needs to be on a persistent volume, not ephemeral storage.

**Update your environment variable:**
```
CHECKPOINT_DB_PATH=/app/data/checkpoints.db
```

**Volume mount path:** `/app/data`

This ensures your LangGraph checkpoints survive deployments and restarts.

---

## Verify Deployment

After deployment, test your API:

1. **Check health endpoint:**
   ```bash
   curl https://your-service.railway.app/
   ```

2. **View API docs:**
   - Swagger UI: `https://your-service.railway.app/docs`
   - ReDoc: `https://your-service.railway.app/redoc`

3. **Check logs:**
   ```bash
   railway logs
   ```
   Or view in Railway Dashboard

---

## Free Tier Limits

### Trial (New Users):
- **$5 credit** (lasts about 30 days for small apps)
- All features unlocked
- Persistent volumes included

### After Trial:
- **$1/month** free credit
- Need to upgrade to **Hobby Plan ($5/month)** for continuous operation

### Resource Pricing:
- **RAM**: $10/GB/month (~$0.000231/GB/minute)
- **CPU**: $20/vCPU/month (~$0.000463/vCPU/minute)
- **Volume**: $0.25/GB/month
- **Bandwidth**: Free egress (no charge)

**Typical monthly cost for this app:** $3-7/month on Hobby plan

---

## Auto-Deploy from GitHub

Once connected to GitHub, Railway automatically:
- ✅ Deploys on every push to main branch
- ✅ Shows deployment status in GitHub commits
- ✅ Creates preview deployments for pull requests (Pro plan)

---

## Troubleshooting

### Build fails:
```bash
# Check build logs
railway logs --build

# Common fixes:
# 1. Ensure runtime.txt has correct Python version
# 2. Verify all dependencies in requirements.txt are installable
# 3. Check that main.py exists at project root
```

### App crashes on startup:
```bash
# Check runtime logs
railway logs

# Common issues:
# - Missing environment variables (OPENAI_API_KEY)
# - Database path issues (check CHECKPOINT_DB_PATH)
# - Port binding (Railway provides $PORT automatically)
```

### Database not persisting:
- Verify volume is created and mounted at `/app/data`
- Check `CHECKPOINT_DB_PATH=/app/data/checkpoints.db`
- Ensure volume size is adequate (1GB minimum)

---

## Useful Railway CLI Commands

```bash
# View service logs
railway logs

# Open dashboard in browser
railway open

# Check service status
railway status

# List environment variables
railway variables

# Connect to service shell
railway shell

# Link to different project
railway link

# Unlink current project
railway unlink
```

---

## Next Steps

After deployment:

1. ✅ Update your frontend's API URL to point to Railway
2. ✅ Set up custom domain (optional, available in dashboard)
3. ✅ Monitor usage in Railway dashboard
4. ✅ Set up GitHub auto-deploy

---

## Cost Optimization Tips

1. **Use the $5 Hobby plan** - Best value for small apps
2. **Monitor resource usage** - Check Railway dashboard regularly
3. **Optimize your code** - Reduce memory/CPU usage where possible
4. **Volume size** - Start small (1GB), expand if needed

---

## Support

- [Railway Docs](https://docs.railway.com)
- [Railway Discord](https://discord.gg/railway)
- [Railway Status](https://status.railway.app)

---

## API Endpoints

Once deployed, your API will be available at:

- Base URL: `https://your-service.railway.app`
- Health check: `/`
- Symptom checker: `/api/symptom-checker` (or your defined routes)
- API Documentation: `/docs`
- Alternative docs: `/redoc`
