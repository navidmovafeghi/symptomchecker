# Medical Chatbot Application

A full-stack medical triage chatbot built with clean architecture principles. Features an intelligent LangGraph-powered workflow with human-in-the-loop interrupts for gathering patient information.

## Features

- **Medical Triage Workflow**: Intent detection, symptom gathering, urgency classification
- **Human-in-the-Loop**: Interactive clarification questions with selectable options
- **Real-time Streaming**: Live response streaming for better UX
- **Conversation Persistence**: SQLite storage for chat history and workflow state
- **Clean Architecture**: Swappable components with dependency injection
- **Multiple Conversations**: Sidebar with conversation history

## Architecture

### Backend (Python/FastAPI)
- **Domain Layer**: Entities, interfaces, business rules
- **Application Layer**: Use cases, DTOs
- **Infrastructure Layer**: LLM provider (OpenAI/LangGraph), repositories (SQLite)
- **Presentation Layer**: FastAPI routes, dependency injection

### Frontend (Next.js/TypeScript)
- **MVVM Pattern**: Views, ViewModels (Zustand), Services
- **React 19** with TypeScript
- **Tailwind CSS** for styling

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- OpenAI API key

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Run server
python main.py
```

Backend runs at: http://localhost:8000  
API docs: http://localhost:8000/docs

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment (optional - defaults work)
cp .env.local.example .env.local

# Run dev server
npm run dev
```

Frontend runs at: http://localhost:3000

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── domain/                 # Business logic
│   │   │   ├── entities.py         # Message, Conversation
│   │   │   ├── interfaces.py       # ILLMProvider, IConversationRepository
│   │   │   └── exceptions.py
│   │   ├── application/            # Use cases
│   │   │   ├── use_cases.py        # SendMessage, Resume, List, Delete
│   │   │   └── dtos.py             # Request/Response objects
│   │   ├── infrastructure/         # Implementations
│   │   │   ├── medical_chatbot_provider.py  # OpenAI + LangGraph
│   │   │   └── repositories.py     # SQLite, InMemory
│   │   └── presentation/           # API layer
│   │       ├── routes.py           # FastAPI endpoints
│   │       ├── dependencies.py     # DI container
│   │       └── config.py           # Settings
│   ├── main.py
│   ├── checkpoints.db              # LangGraph workflow state
│   └── conversations.db            # Chat history (when using SQLite)
│
├── frontend/
│   ├── app/                        # Next.js pages
│   ├── presentation/               # React components
│   │   ├── ChatPage.tsx
│   │   └── Sidebar.tsx
│   ├── viewmodels/                 # Zustand state management
│   │   └── useChatViewModel.ts
│   ├── services/                   # API communication
│   │   └── api.ts
│   └── types/                      # TypeScript types
│       └── index.ts
│
├── DATA_PERSISTENCE.md             # How data storage works
├── ARCHITECTURE.md                 # Detailed architecture docs
└── SETUP.md                        # Extended setup guide
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat/message` | Send message (non-streaming) |
| POST | `/api/chat/message/stream` | Send message (streaming) |
| POST | `/api/chat/resume` | Resume interrupted conversation |
| GET | `/api/chat/conversations` | List all conversations |
| GET | `/api/chat/conversations/{id}` | Get conversation history |
| DELETE | `/api/chat/conversations/{id}` | Delete conversation |

## Configuration

### Environment Variables (backend/.env)

```bash
OPENAI_API_KEY=your_key_here      # Required
LLM_PROVIDER=openai               # Only 'openai' supported
STORAGE_TYPE=sqlite               # 'sqlite' or 'memory'
CORS_ORIGINS=http://localhost:3000
```

### Storage Options

| Type | Database | Persistence | Use Case |
|------|----------|-------------|----------|
| `sqlite` | `conversations.db` | Yes | Production |
| `memory` | In-memory dict | No | Development/Testing |

## Medical Triage Workflow

The chatbot uses a LangGraph state machine:

1. **Intent Detection**: Classifies user intent (symptom_checking, non_medical, other_medical, ambiguous)
2. **Clarification**: If ambiguous, asks clarifying questions with options
3. **Symptom Gathering**: Multi-turn conversation to collect symptom details
4. **Evaluation**: Determines if enough info for triage
5. **Final Response**: Provides guidance based on gathered information

```
User Message → Intent Detection → [Clarification Loop] → Symptom Checking → [Info Gathering Loop] → Final Answer
```

## Extending the Application

### Add New LLM Provider

1. Implement `ILLMProvider` interface:
```python
class MyProvider(ILLMProvider):
    async def generate_response(self, messages, thread_id=None) -> str:
        ...
    
    async def generate_response_stream(self, messages, thread_id=None):
        yield chunk
    
    async def resume(self, thread_id, user_input) -> dict:
        ...
```

2. Update `dependencies.py` to use your provider

### Add New Storage Backend

1. Implement `IConversationRepository` interface
2. Update `dependencies.py` factory function

## License

MIT
