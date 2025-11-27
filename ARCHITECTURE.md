# Architecture Documentation

## Overview

This chatbot application follows **clean architecture principles** with clear separation of concerns, dependency inversion, and swappable components.

## Backend Architecture (Python)

### Layer Structure

```
┌─────────────────────────────────────────────────────────┐
│                   Presentation Layer                     │
│  (FastAPI routes, HTTP handling, dependency injection)  │
└────────────────────┬────────────────────────────────────┘
                     │ depends on
                     ↓
┌─────────────────────────────────────────────────────────┐
│                   Application Layer                      │
│        (Use cases, business workflows, DTOs)            │
└────────────────────┬────────────────────────────────────┘
                     │ depends on
                     ↓
┌─────────────────────────────────────────────────────────┐
│                     Domain Layer                         │
│  (Entities, business rules, interfaces/ports)           │
│                                                          │
│  ┌──────────────┐           ┌──────────────┐          │
│  │   Entities   │           │  Interfaces  │          │
│  │              │           │   (Ports)    │          │
│  │  - Message   │           │              │          │
│  │  - Conver... │           │  - ILLMPr... │          │
│  └──────────────┘           │  - IRepo...  │          │
│                             └──────────────┘          │
└────────────────────┬────────────────────────────────────┘
                     ↑ implements
                     │
┌─────────────────────────────────────────────────────────┐
│                 Infrastructure Layer                     │
│          (Adapters, external integrations)              │
│                                                          │
│  ┌─────────────────────┐    ┌──────────────────────┐  │
│  │  LLM Providers      │    │  Repositories        │  │
│  │  (swappable)        │    │  (swappable)         │  │
│  │                     │    │                      │  │
│  │  - Anthropic        │    │  - InMemory          │  │
│  │  - LangGraph (fut.) │    │  - Postgres (fut.)   │  │
│  │  - OpenAI (future)  │    │  - MongoDB (future)  │  │
│  └─────────────────────┘    └──────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Dependency Flow

- **Presentation** → **Application** → **Domain** ← **Infrastructure**
- Infrastructure implements domain interfaces (Dependency Inversion)
- Domain has NO dependencies on other layers

### Key Design Patterns

1. **Repository Pattern** - Data access abstraction
2. **Dependency Injection** - Loose coupling via constructor injection
3. **Strategy Pattern** - Swappable LLM providers
4. **Adapter Pattern** - Infrastructure adapts external services to domain interfaces

### SOLID Principles Applied

- **S**ingle Responsibility: Each class has one reason to change
- **O**pen/Closed: Open for extension (new providers), closed for modification
- **L**iskov Substitution: Any `ILLMProvider` implementation is interchangeable
- **I**nterface Segregation: Small, focused interfaces
- **D**ependency Inversion: High-level modules depend on abstractions

## Frontend Architecture (Next.js)

### MVVM Pattern

```
┌─────────────────────────────────────────────────────────┐
│                        View Layer                        │
│            (React Components - UI only)                  │
│                                                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │
│  │ ChatPage │  │ Message  │  │ Message  │  │ Message│ │
│  │          │  │   List   │  │  Input   │  │ Bubble │ │
│  └────┬─────┘  └──────────┘  └──────────┘  └────────┘ │
│       │ subscribes to state & triggers actions          │
└───────┼─────────────────────────────────────────────────┘
        │
        ↓ uses
┌─────────────────────────────────────────────────────────┐
│                    ViewModel Layer                       │
│         (Business logic, state management)              │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │         useChatViewModel (Zustand)               │  │
│  │                                                  │  │
│  │  State:                  Actions:               │  │
│  │  - messages              - sendMessage()        │  │
│  │  - conversationId        - clearConversation()  │  │
│  │  - isLoading             - setError()           │  │
│  │  - error                                        │  │
│  └────────────────────┬─────────────────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ calls
                        ↓
┌─────────────────────────────────────────────────────────┐
│                     Service Layer                        │
│              (API communication)                         │
│                                                          │
│  ┌──────────────────────────────────────────────────┐  │
│  │            ApiService                            │  │
│  │  - sendMessage()                                 │  │
│  │  - sendMessageStream()                           │  │
│  │  - getConversation()                             │  │
│  │  - deleteConversation()                          │  │
│  └──────────────────────┬───────────────────────────┘  │
└───────────────────────┼─────────────────────────────────┘
                        │ HTTP
                        ↓
┌─────────────────────────────────────────────────────────┐
│                   Backend API                            │
│                 (FastAPI)                                │
└─────────────────────────────────────────────────────────┘
```

### Responsibilities

- **View**: Render UI, handle user events, NO business logic
- **ViewModel**: Manage state, orchestrate actions, transform data for View
- **Service**: HTTP communication, error handling

### Data Flow

1. User interacts with **View**
2. View triggers **ViewModel** action
3. ViewModel calls **Service**
4. Service communicates with **Backend**
5. Service returns data to ViewModel
6. ViewModel updates state
7. View re-renders automatically (React)

## Communication Flow

### Send Message Flow

```
User types message
    ↓
MessageInput (View)
    ↓ onSend
useChatViewModel.sendMessage() (ViewModel)
    ↓ validates & updates state
apiService.sendMessageStream() (Service)
    ↓ HTTP POST
FastAPI /api/chat/message/stream (Backend Presentation)
    ↓ routes to
SendMessageUseCase.execute_stream() (Backend Application)
    ↓ uses
AnthropicLLMProvider.generate_response_stream() (Backend Infrastructure)
    ↓ calls
Anthropic API
    ↓ streams back
Chunks → ViewModel → View (real-time update)
```

## Swappability Strategy

### How to Swap LLM Provider

**Step 1**: Implement `ILLMProvider` interface
```python
class LangGraphProvider(ILLMProvider):
    async def generate_response(self, messages):
        # Your implementation
        pass
```

**Step 2**: Update dependency injection
```python
# In dependencies.py
def get_llm_provider():
    if settings.llm_provider == "langgraph":
        return LangGraphProvider()
    return AnthropicLLMProvider()
```

**Step 3**: Configure via environment variable
```bash
LLM_PROVIDER=langgraph
```

### How to Swap Storage

Same pattern:
1. Implement `IConversationRepository`
2. Update dependency injection
3. Configure via environment

## Testing Strategy

### Backend Testing

- **Unit Tests**: Domain entities and use cases
- **Integration Tests**: API endpoints with mock dependencies
- **Contract Tests**: Verify interface implementations

### Frontend Testing

- **Unit Tests**: ViewModel logic (Zustand store)
- **Component Tests**: View components with mocked ViewModel
- **E2E Tests**: Full user flows

## Security Considerations

- API keys stored in environment variables
- CORS configured for frontend origin
- Input validation at multiple layers
- Error messages sanitized for users

## Performance Optimizations

- **Streaming responses** - Better perceived performance
- **In-memory storage** - Fast for development
- **Zustand** - Lightweight state management
- **React optimizations** - Auto-scroll only on new messages

## Future Scalability

### Adding Database

```python
class PostgresConversationRepository(IConversationRepository):
    def __init__(self, connection_string):
        self.db = Database(connection_string)

    async def save(self, conversation):
        await self.db.conversations.insert(conversation.dict())
```

### Adding Authentication

```python
# In presentation layer
from fastapi import Depends
from fastapi.security import HTTPBearer

security = HTTPBearer()

@router.post("/message")
async def send_message(
    request: SendMessageRequest,
    token: str = Depends(security)
):
    user_id = verify_token(token)
    # ... rest of logic
```

## Conclusion

This architecture provides:
- ✅ Clean separation of concerns
- ✅ Testability (dependency injection)
- ✅ Maintainability (small, focused modules)
- ✅ Extensibility (easy to add features)
- ✅ Swappability (change components without rewriting)
- ✅ SOLID principles
- ✅ Type safety (Python typing + TypeScript)
