# Design Document: Streaming Resume Stages

## Overview

This feature converts the conversation resume endpoint from a synchronous request/response pattern to a streaming pattern, enabling real-time stage indicators during the resume flow. Users will see contextual progress messages ("Analyzing symptoms...", "Preparing follow-up question...", etc.) instead of a generic "Thinking..." while the backend processes their answers through multiple LangGraph nodes.

## Architecture

The solution involves changes across three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │  ChatPage    │───▶│  ViewModel   │───▶│  API Service │      │
│  │  (displays   │    │  (manages    │    │  (streaming  │      │
│  │   stages)    │◀───│   state)     │◀───│   fetch)     │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP Streaming
┌─────────────────────────────────────────────────────────────────┐
│                         Backend                                  │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Routes     │───▶│  Use Cases   │───▶│  Provider    │      │
│  │  (streaming  │    │  (orchestrate│    │  (yields     │      │
│  │   response)  │◀───│   resume)    │◀───│   stages)    │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### Backend Changes

#### 1. SymptomCheckerProvider - New `resume_stream()` Method

```python
async def resume_stream(self, thread_id: str, user_input: str) -> AsyncIterator[str]:
    """Resume an interrupted conversation with streaming stage updates.
    
    Yields:
        Stage indicator JSON messages as processing progresses
        Final interrupt or complete JSON message
    """
```

#### 2. ResumeConversationUseCase - New `execute_stream()` Method

```python
async def execute_stream(self, request: ResumeConversationRequest):
    """Execute resume with streaming response.
    
    Yields:
        Stage and result chunks from the provider
    """
```

#### 3. Routes - New Streaming Resume Endpoint

```python
@router.post("/resume/stream")
async def resume_conversation_stream(request: ResumeConversationRequest):
    """Resume with streaming response for stage indicators."""
```

### Frontend Changes

#### 1. API Service - New `resumeConversationStream()` Method

```typescript
async resumeConversationStream(
  threadId: string,
  userInput: string | string[],
  onStage?: (stage: string, message: string) => void
): Promise<ResumeResult>
```

#### 2. ViewModel - Update Resume Methods

Update `selectOption()`, `resumeConversation()`, and `submitMultipleAnswers()` to use the streaming resume endpoint and pass stage callbacks.

## Data Models

### Stage Message Format (Backend → Frontend)

```json
{
  "type": "stage",
  "stage": "generate_ddx",
  "message": "Analyzing symptoms..."
}
```

### Interrupt Response Format

```json
{
  "type": "interrupt",
  "question": "How severe is the pain?",
  "options": ["Mild", "Moderate", "Severe"],
  "thread_id": "abc-123"
}
```

### Complete Response Format

```json
{
  "type": "complete",
  "content": "Based on our conversation...",
  "thread_id": "abc-123"
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Stage messages update UI state
*For any* sequence of stage messages received from the resume stream, each stage message SHALL update the currentStageMessage state to the message content.
**Validates: Requirements 1.1, 1.2**

### Property 2: Stage message structure validity
*For any* stage message yielded by the backend resume_stream method, the message SHALL contain "type" equal to "stage", a non-empty "stage" field, and a non-empty "message" field.
**Validates: Requirements 2.2**

### Property 3: Final message is always last
*For any* resume stream execution, the last message yielded SHALL be either an interrupt or complete type, never a stage type.
**Validates: Requirements 2.3**

### Property 4: Newline delimiter presence
*For any* JSON message yielded by the backend resume_stream method, the message SHALL end with a newline character.
**Validates: Requirements 2.4**

### Property 5: Stage callback invocation
*For any* stage-type JSON message parsed by the API service, the onStage callback SHALL be invoked with the stage name and message from the parsed JSON.
**Validates: Requirements 3.2**

### Property 6: Initial stage message first
*For any* resume stream execution, the first message yielded SHALL be a stage-type message.
**Validates: Requirements 4.1**

## Error Handling

| Error Scenario | Handling |
|----------------|----------|
| Checkpoint not found | Yield error JSON, return 404 status |
| Stream parsing error | Log error, continue processing remaining chunks |
| LLM provider error | Yield error JSON with message, close stream |
| Network interruption | Frontend shows error, allows retry |

## Testing Strategy

### Unit Tests
- Test stage message JSON structure validation
- Test API service stream parsing with mock responses
- Test ViewModel state updates on stage callbacks

### Property-Based Tests
- Use fast-check (frontend) and hypothesis (backend) for property testing
- Generate random sequences of stage/interrupt/complete messages
- Verify properties hold across all generated inputs

**Property-Based Testing Library:**
- Backend: `hypothesis` (already in requirements.txt)
- Frontend: `fast-check` (already in package.json)

**Test Annotation Format:**
Each property-based test MUST include a comment: `**Feature: streaming-resume-stages, Property {number}: {property_text}**`
