# Medical Chatbot Backend

FastAPI backend with clean architecture and LangGraph-powered medical triage workflow.

## Architecture

```
src/
├── domain/           # Business logic (no dependencies)
│   ├── entities.py   # Message, Conversation
│   ├── interfaces.py # ILLMProvider, IConversationRepository
│   └── exceptions.py # Domain exceptions
│
├── application/      # Use cases (depends on domain)
│   ├── use_cases.py  # SendMessage, Resume, List, Delete
│   └── dtos.py       # Request/Response objects
│
├── infrastructure/   # Implementations (depends on domain)
│   ├── medical_chatbot_provider.py  # OpenAI + LangGraph workflow
│   └── repositories.py              # SQLite, InMemory storage
│
└── presentation/     # API layer (depends on application)
    ├── routes.py     # FastAPI endpoints
    ├── dependencies.py # Dependency injection
    └── config.py     # Environment settings
```

## Setup

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Add your OPENAI_API_KEY to .env

# Run server
python main.py
```

Server: http://localhost:8000  
Docs: http://localhost:8000/docs

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | - | Required for LLM |
| `LLM_PROVIDER` | `openai` | Only 'openai' supported |
| `STORAGE_TYPE` | `sqlite` | 'sqlite' or 'memory' |
| `CORS_ORIGINS` | `http://localhost:3000` | Allowed origins |

## API Endpoints

### Chat
- `POST /api/chat/message` - Send message (non-streaming)
- `POST /api/chat/message/stream` - Send message (streaming)
- `POST /api/chat/resume` - Resume interrupted conversation

### Conversations
- `GET /api/chat/conversations` - List all
- `GET /api/chat/conversations/{id}` - Get by ID
- `DELETE /api/chat/conversations/{id}` - Delete

## Data Persistence

Two SQLite databases:

| Database | Purpose |
|----------|---------|
| `conversations.db` | Chat history (messages, metadata) |
| `checkpoints.db` | LangGraph workflow state (for interrupts) |

See `DATA_PERSISTENCE.md` in project root for details.

## LangGraph Workflow

The `MedicalChatbotProvider` implements a state machine:

```
START → intent_detector → [clarification_node] → symptom_checker → [symptom_clarification] → final_answer → END
                ↓                                        ↓
         non_medical_response                    other_medical_response
```

Key features:
- **Interrupts**: Pauses workflow to ask user questions
- **Checkpointing**: Saves state to resume after user responds
- **Per-node models**: Different OpenAI models for different tasks

## Extending

### New LLM Provider

```python
# src/infrastructure/my_provider.py
from ..domain.interfaces import ILLMProvider

class MyProvider(ILLMProvider):
    async def generate_response(self, messages, thread_id=None) -> str:
        # Your implementation
        pass
    
    async def generate_response_stream(self, messages, thread_id=None):
        # Yield chunks
        yield "chunk"
    
    async def resume(self, thread_id, user_input) -> dict:
        # For interrupt support
        return {"type": "complete", "content": "..."}
```

### New Repository

```python
# src/infrastructure/repositories.py
from ..domain.interfaces import IConversationRepository

class PostgresRepository(IConversationRepository):
    async def save(self, conversation): ...
    async def get_by_id(self, id): ...
    async def delete(self, id): ...
    async def list_all(self): ...
```

Then update `dependencies.py` to use your implementation.
