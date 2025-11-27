# Chatbot Application

A full-stack chatbot application built with layered architecture and MVVM pattern.

## Architecture

### Backend (Python)
**Layered Architecture** with 4 layers:
- **Domain**: Business entities and interfaces
- **Application**: Use cases and DTOs
- **Infrastructure**: Swappable implementations (LLM, storage)
- **Presentation**: FastAPI routes

**Key Features**:
- Swappable LLM providers (currently Anthropic Claude)
- Swappable storage (currently in-memory)
- SOLID principles applied pragmatically
- Streaming responses support

### Frontend (Next.js)
**MVVM Pattern**:
- **Model**: Types and data structures
- **ViewModel**: Zustand state management
- **View**: React components
- **Service**: API communication

**Tech Stack**:
- Next.js 15 with TypeScript
- Tailwind CSS
- Zustand for state management

## Quick Start

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
# Edit .env and add your ANTHROPIC_API_KEY

# Run server
python main.py
```

Backend will run at: http://localhost:8000

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.local.example .env.local
# Edit .env.local if needed (default: http://localhost:8000)

# Run dev server
npm run dev
```

Frontend will run at: http://localhost:3000

## Project Structure

```
chatbot-project/
├── backend/
│   ├── src/
│   │   ├── domain/              # Business logic & interfaces
│   │   │   ├── entities.py      # Message, Conversation
│   │   │   ├── interfaces.py    # ILLMProvider, IRepository
│   │   │   └── exceptions.py
│   │   ├── application/         # Use cases
│   │   │   ├── use_cases.py     # SendMessage, GetHistory
│   │   │   └── dtos.py
│   │   ├── infrastructure/      # Implementations
│   │   │   ├── llm_providers.py # AnthropicLLMProvider
│   │   │   └── repositories.py  # InMemoryRepository
│   │   └── presentation/        # API
│   │       ├── app.py           # FastAPI app
│   │       ├── routes.py        # Endpoints
│   │       └── dependencies.py  # DI container
│   └── main.py
│
└── frontend/
    ├── app/                     # Next.js pages
    ├── presentation/            # View components
    ├── viewmodels/              # Business logic
    ├── services/                # API layer
    └── types/                   # TypeScript types
```

## API Endpoints

- `POST /api/chat/message` - Send message (non-streaming)
- `POST /api/chat/message/stream` - Send message (streaming)
- `GET /api/chat/conversations/{id}` - Get conversation
- `DELETE /api/chat/conversations/{id}` - Delete conversation
- `GET /health` - Health check

## Swapping Components

### Change LLM Provider

1. Create new provider in `backend/src/infrastructure/llm_providers.py`:
```python
class LangGraphProvider(ILLMProvider):
    async def generate_response(self, messages):
        # Your implementation
        pass
```

2. Update dependency injection in `backend/src/presentation/dependencies.py`

### Change Storage

1. Create new repository in `backend/src/infrastructure/repositories.py`:
```python
class PostgresConversationRepository(IConversationRepository):
    async def save(self, conversation):
        # Your implementation
        pass
```

2. Update dependency injection in `backend/src/presentation/dependencies.py`

## Features

- ✅ Real-time streaming responses
- ✅ Conversation persistence (in-memory)
- ✅ Clean architecture with separation of concerns
- ✅ SOLID principles
- ✅ Swappable components
- ✅ Type safety (Python typing + TypeScript)
- ✅ Error handling
- ✅ Responsive UI

## Future Enhancements

- [ ] Add PostgreSQL/MongoDB database
- [ ] Implement LangGraph integration
- [ ] Add authentication
- [ ] Multiple conversations support
- [ ] Message editing/deletion
- [ ] Code syntax highlighting
- [ ] File attachments
- [ ] Export conversations

## License

MIT
