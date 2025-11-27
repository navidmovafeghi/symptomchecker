# Setup Guide

## Prerequisites

- Python 3.11+ installed
- Node.js 18+ installed
- OpenAI API key ([Get one here](https://platform.openai.com/api-keys))

## Step-by-Step Setup

### 1. Clone/Navigate to Project

```bash
cd learn
```

### 2. Backend Setup

#### Windows:

```bash
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

#### macOS/Linux:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure Backend Environment

Copy the example and edit `backend/.env`:

```bash
cp .env.example .env
```

Add your API key:

```bash
OPENAI_API_KEY=sk-your-actual-api-key-here
CORS_ORIGINS=http://localhost:3000
LLM_PROVIDER=openai
STORAGE_TYPE=sqlite
```

### 4. Frontend Setup

Open a **new terminal** (keep backend terminal open):

```bash
cd frontend
npm install
```

The `.env.local` file should have:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

### 5. Run the Application

#### Terminal 1 - Backend:

```bash
cd backend
# Activate venv if not already active
python main.py
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
```

#### Terminal 2 - Frontend:

```bash
cd frontend
npm run dev
```

You should see:
```
- Local:   http://localhost:3000
```

### 6. Open the Application

Open your browser and navigate to:
```
http://localhost:3000
```

## Verify Installation

1. **Backend Health Check**: Visit http://localhost:8000/health
   - Should return: `{"status": "healthy"}`

2. **Backend API Docs**: Visit http://localhost:8000/docs
   - Should show interactive Swagger documentation

3. **Frontend**: Visit http://localhost:3000
   - Should see the chat interface with sidebar

## Testing the Chatbot

1. Type a message like "I have a headache" in the input box
2. Press Enter or click "Send"
3. The chatbot may ask clarifying questions with options
4. Click an option or type your response
5. Continue until you get a final response

## Configuration Options

### Storage Type

| Value | Description |
|-------|-------------|
| `sqlite` | Persistent storage in `conversations.db` (recommended) |
| `memory` | In-memory storage, lost on restart |

### Database Files

When using SQLite, two database files are created:
- `conversations.db` - Chat history
- `checkpoints.db` - LangGraph workflow state

## Troubleshooting

### Backend Issues

**Problem**: `ModuleNotFoundError`
```bash
# Make sure virtual environment is activated
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

pip install -r requirements.txt
```

**Problem**: `openai.APIError: invalid_api_key`
```bash
# Check your .env file has correct API key
# Make sure OPENAI_API_KEY is set correctly
```

**Problem**: `uvicorn: command not found`
```bash
pip install uvicorn[standard]
```

### Frontend Issues

**Problem**: `Module not found` errors
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json  # macOS/Linux
npm install
```

**Problem**: Port 3000 already in use
```bash
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux:
lsof -ti:3000 | xargs kill -9
```

**Problem**: Cannot connect to backend
- Check backend is running on port 8000
- Check `.env.local` has correct API URL
- Check CORS settings in `backend/.env`

## Development Tips

### Hot Reload

Both backend (uvicorn) and frontend (Next.js) support hot reload. Save your changes and they'll apply automatically.

### Debugging

**Backend**:
- Check terminal logs
- Visit `/docs` for API documentation
- Add print statements or use Python debugger

**Frontend**:
- Open browser DevTools (F12)
- Check Console and Network tabs

## Common Commands

### Backend
```bash
python main.py              # Run server
pip install package-name    # Install package
pip freeze > requirements.txt  # Update requirements
```

### Frontend
```bash
npm run dev     # Development server
npm run build   # Production build
npm start       # Run production build
```

## Next Steps

1. Read [README.md](./README.md) for feature overview
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
3. Read [DATA_PERSISTENCE.md](./DATA_PERSISTENCE.md) for storage details
