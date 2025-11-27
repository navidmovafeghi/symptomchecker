# Complete Request Flow

## 1. Entry Point: Server Start
`main.py`
- Uvicorn ASGI server starts
- Loads the FastAPI app from main:app
- Listens on 0.0.0.0:8000 with hot reload

## 2. Application Creation
`app.py`
- create_app() initializes FastAPI instance
- Configures CORS middleware with allowed origins from settings
- Registers the main router with /api/chat prefix
- Sets up health check endpoints

## 3. Middleware Layer
`app.py`
- CORSMiddleware intercepts all requests
- Validates origins, credentials, methods, and headers
- Adds CORS headers to responses

## 4. Routing Layer
`routes.py`
- APIRouter with prefix /api/chat matches routes
- Routes defined:
  - POST /api/chat/message → send_message
  - POST /api/chat/message/stream → send_message_stream
  - POST /api/chat/resume → resume_conversation
  - GET /api/chat/conversations → list_conversations
  - GET /api/chat/conversations/{id} → get_conversation
  - DELETE /api/chat/conversations/{id} → delete_conversation

## 5. Request Validation
- Pydantic validates request body against DTOs (dtos.py)
- Example: SendMessageRequest validates conversation_id and message fields
- Invalid data returns 422 validation error automatically

## 6. Dependency Injection
`dependencies.py`
- FastAPI's Depends() resolves dependencies
- get_send_message_use_case() creates use case with:
  - LLM Provider: MedicalChatbotProvider (OpenAI + LangGraph)
  - Repository: SQLiteConversationRepository or InMemoryConversationRepository

## 7. Handler Function Execution
`routes.py`
- Receives validated request and injected use case
- Wraps use case call in try-except
- Maps domain exceptions to HTTP status codes:
  - InvalidMessageException → 400
  - ConversationNotFoundException → 404
  - Generic exceptions → 500

## 8. Use Case Layer
`use_cases.py` SendMessageUseCase.execute_stream():
1. Validates message is not empty
2. Retrieves or creates conversation
3. Creates user Message entity
4. Saves conversation to repository
5. Yields conversation_id to frontend
6. Calls LLM provider to generate streaming response
7. Creates assistant Message entity
8. Saves conversation with response

## 9. Infrastructure Layer
`medical_chatbot_provider.py` MedicalChatbotProvider.generate_response_stream():
1. Converts messages to LangChain format
2. Uses conversation ID as thread_id
3. Builds LangGraph workflow with AsyncSqliteSaver checkpointer
4. Invokes graph asynchronously
5. Returns either:
   - Interrupt JSON (for clarification questions with options)
   - Final AI response content

## 10. LangGraph Workflow (Medical Triage System)
`medical_chatbot_provider.py` The graph executes nodes:

```
START → intent_detector
         ↓
    ┌────┴────┬────────────┬──────────────┐
    ↓         ↓            ↓              ↓
ambiguous  symptom    non_medical   other_medical
    ↓      checking       ↓              ↓
clarify       ↓        response      response
(INTERRUPT)   ↓
    ↓     needs_info?
    └──→     ↓
         ┌───┴───┐
         ↓       ↓
      gather   final_answer
    (INTERRUPT)    ↓
         ↓        END
         └────────┘
```

Key nodes:
- **intent_detector** - Classifies: symptom_checking, non_medical, other_medical, ambiguous
- **clarification_node** - Asks clarifying questions (INTERRUPT)
- **symptom_checker** - Gathers symptom details with diagnostic reasoning
- **symptom_evaluator** - Determines if enough info for guidance
- **final_answer** - Provides medical guidance based on gathered info

## 11. Response Transformation
- Use case converts domain entities to DTOs
- FastAPI serializes DTOs to JSON using Pydantic
- For streaming: yields chunks directly as text/plain

## 12. Response Path
Response travels back through:
1. Handler → Router → Middleware → FastAPI → Uvicorn
2. CORS headers added by middleware
3. Client receives JSON or streaming text

## Data Persistence

Two databases are used:
- **conversations.db** - Chat history (via SQLiteConversationRepository)
- **checkpoints.db** - LangGraph workflow state (via AsyncSqliteSaver)

The conversation.id is used as thread_id to link both databases.
