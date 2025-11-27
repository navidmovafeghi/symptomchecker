# Setup Guide

## Prerequisites

- Python 3.10+ installed
- Node.js 18+ installed
- Anthropic API key ([Get one here](https://console.anthropic.com/))

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

Edit `backend/.env` and add your API key:

```bash
ANTHROPIC_API_KEY=sk-ant-your-actual-api-key-here
CORS_ORIGINS=http://localhost:3000
LLM_PROVIDER=anthropic
STORAGE_TYPE=memory
```

### 4. Frontend Setup

Open a **new terminal** (keep backend terminal open):

```bash
cd frontend
npm install
```

The `.env.local` file is already configured with:
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
   - Should see the chat interface

## Testing the Chatbot

1. Type a message in the input box at the bottom
2. Press Enter or click "Send"
3. Watch the AI response stream in real-time
4. Continue the conversation!

## Troubleshooting

### Backend Issues

**Problem**: `ModuleNotFoundError`
```bash
# Make sure virtual environment is activated
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate

# Then reinstall
pip install -r requirements.txt
```

**Problem**: `anthropic.APIError: invalid_api_key`
```bash
# Check your .env file has correct API key
cat .env  # macOS/Linux
type .env  # Windows

# Make sure ANTHROPIC_API_KEY is set correctly
```

**Problem**: `uvicorn: command not found`
```bash
# Install uvicorn explicitly
pip install uvicorn[standard]
```

### Frontend Issues

**Problem**: `Module not found` errors
```bash
# Delete node_modules and reinstall
rm -rf node_modules package-lock.json  # macOS/Linux
# Windows: delete node_modules folder manually

npm install
```

**Problem**: Port 3000 already in use
```bash
# Kill process on port 3000
# Windows:
netstat -ano | findstr :3000
taskkill /PID <PID> /F

# macOS/Linux:
lsof -ti:3000 | xargs kill -9
```

**Problem**: Cannot connect to backend
```bash
# Check backend is running on port 8000
# Check .env.local has correct API URL
# Check CORS settings in backend/.env
```

## Development Tips

### Backend Hot Reload

The backend uses `uvicorn` with `reload=True`, so changes to Python files will automatically reload the server.

### Frontend Hot Reload

Next.js automatically hot-reloads on file changes. Just save your changes and see them instantly.

### Debugging

**Backend**:
- Check logs in the terminal running `python main.py`
- Add `print()` statements or use Python debugger
- Visit `/docs` for API documentation

**Frontend**:
- Open browser DevTools (F12)
- Check Console tab for errors
- Check Network tab for API calls

## Next Steps

1. Read [README.md](./README.md) for feature overview
2. Read [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
3. Try swapping components (see README.md)
4. Extend with your own features!

## Common Commands

### Backend
```bash
# Run server
python main.py

# Install new package
pip install package-name
pip freeze > requirements.txt
```

### Frontend
```bash
# Run dev server
npm run dev

# Build for production
npm run build

# Run production build
npm start

# Install new package
npm install package-name
```

## Getting Help

- Check the [README.md](./README.md)
- Check the [ARCHITECTURE.md](./ARCHITECTURE.md)
- Review code comments in source files
- Check API docs at http://localhost:8000/docs
