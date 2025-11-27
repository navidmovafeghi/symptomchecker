Complete Request Flow
1. Entry Point: Server Start
main.py:7-12
Uvicorn ASGI server starts
Loads the FastAPI app from main:app
Listens on 0.0.0.0:8000 with hot reload
2. Application Creation
app.py:8-40
create_app() initializes FastAPI instance
Configures CORS middleware with allowed origins from settings
Registers the main router with /api/chat prefix
Sets up health check endpoints
3. Middleware Layer
app.py:18-24
CORSMiddleware intercepts all requests
Validates origins, credentials, methods, and headers
Adds CORS headers to responses
4. Routing Layer
routes.py:19
APIRouter with prefix /api/chat matches routes
Routes defined:
POST /api/chat/message → send_message
POST /api/chat/message/stream → send_message_stream
POST /api/chat/resume → resume_conversation
GET /api/chat/conversations/{conversation_id} → get_conversation
DELETE /api/chat/conversations/{conversation_id} → delete_conversation
5. Request Validation
Before entering handler functions:
Pydantic validates request body against DTOs (dtos.py)
Example: SendMessageRequest validates conversation_id and message fields
Invalid data returns 422 validation error automatically
6. Dependency Injection
dependencies.py
FastAPI's Depends() resolves dependencies
Example for send_message: get_send_message_use_case() is called
Creates use case with injected:
LLM Provider: LangGraphMedicalProvider (dependencies.py:19)
Repository: InMemoryConversationRepository (dependencies.py:15)
7. Handler Function Execution
routes.py:22-35 Example: send_message handler
Receives validated request and injected use case
Wraps use case call in try-except
Maps domain exceptions to HTTP status codes:
InvalidMessageException → 400
ConversationNotFoundException → 404
Generic exceptions → 500
8. Use Case Layer
use_cases.py:28-81 SendMessageUseCase.execute():
Validates message is not empty
Retrieves or creates conversation
Creates user Message entity
Calls LLM provider to generate response
Creates assistant Message entity
Saves conversation to repository
Returns SendMessageResponse DTO
9. Infrastructure Layer
langgraph_provider.py:565-614 LangGraphMedicalProvider.generate_response_stream():
Converts messages to LangChain format
Generates unique thread ID
Builds LangGraph workflow with checkpointer
Invokes graph asynchronously
Returns either:
Interrupt JSON (for clarification questions)
Final AI response content
10. LangGraph Workflow (Complex Medical Triage System)
langgraph_provider.py:70-139 The graph executes nodes in this flow:
intent_detector → Classifies intent (symptom_checking, information_seeking, etc.)
If unclear → intent_human_input (interrupt for clarification)
Based on intent:
symptom_checking → symptom_checking node
Gathers symptoms via interrupts (symptom_human_input)
Classifies urgency → Routes to Emergency/Urgent/Non_urgent/Self_care nodes
information_seeking → information_seeking node
medication_queries → medication_queries node
others → others node
11. Response Transformation
Use case converts domain entities to DTOs
FastAPI serializes DTOs to JSON using Pydantic
For streaming: yields chunks directly as text/plain
12. Response Path
Response travels back through:
Handler → Router → Middleware → FastAPI → Uvicorn
CORS headers added by middleware
Client receives JSON or streaming text