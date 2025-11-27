# Data Persistence Architecture

This document provides a comprehensive overview of how data is persisted in the Medical Chatbot application, with special focus on the interaction between LangGraph workflows and the repository layer.

---

## Table of Contents

1. [Overview](#overview)
2. [Two Persistence Systems](#two-persistence-systems)
3. [Conversation Repository (Application State)](#conversation-repository-application-state)
4. [LangGraph Checkpointer (Workflow State)](#langgraph-checkpointer-workflow-state)
5. [Data Flow Diagrams](#data-flow-diagrams)
6. [How They Work Together](#how-they-work-together)
7. [Database Files](#database-files)
8. [Configuration](#configuration)

---

## Overview

The application uses **two separate persistence mechanisms** that serve different purposes:

| System | Purpose | Database | What It Stores |
|--------|---------|----------|----------------|
| **Conversation Repository** | Application-level chat history | `conversations.db` | User messages, AI responses, conversation metadata |
| **LangGraph Checkpointer** | Workflow state for interrupts | `checkpoints.db` | Graph execution state, node positions, intermediate values |

These two systems are **independent but coordinated** - they don't share data directly, but work together to provide a seamless user experience.

---

## Two Persistence Systems

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION LAYER                                  │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Use Cases                                      │   │
│  │   SendMessageUseCase, ResumeConversationUseCase, etc.                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                    │                              │                          │
│                    ▼                              ▼                          │
│  ┌─────────────────────────────┐   ┌─────────────────────────────────────┐ │
│  │   IConversationRepository   │   │         ILLMProvider                │ │
│  │   (Domain Interface)        │   │         (Domain Interface)          │ │
│  └─────────────────────────────┘   └─────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INFRASTRUCTURE LAYER                                  │
│  ┌─────────────────────────────┐   ┌─────────────────────────────────────┐ │
│  │ SQLiteConversationRepository│   │  MedicalChatbotProvider             │ │
│  │                             │   │  (OpenAI + LangGraph)               │ │
│  │  - save()                   │   │                                     │ │
│  │  - get_by_id()              │   │  Uses internally:                   │ │
│  │  - delete()                 │   │  ┌─────────────────────────────┐   │ │
│  │  - list_all()               │   │  │   AsyncSqliteSaver          │   │ │
│  │                             │   │  │   (LangGraph Checkpointer)  │   │ │
│  └─────────────────────────────┘   │  └─────────────────────────────┘   │ │
│              │                     └─────────────────────────────────────┘ │
│              ▼                                    │                          │
│     ┌─────────────────┐                  ┌─────────────────┐                │
│     │conversations.db │                  │ checkpoints.db  │                │
│     │                 │                  │                 │                │
│     │ - id            │                  │ - thread_id     │                │
│     │ - title         │                  │ - checkpoint    │                │
│     │ - messages JSON │                  │ - metadata      │                │
│     │ - created_at    │                  │ - parent_ts     │                │
│     │ - updated_at    │                  │                 │                │
│     └─────────────────┘                  └─────────────────┘                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Conversation Repository (Application State)

### Purpose
Stores the **user-facing conversation history** - what the user sees in the chat interface.

### Interface (`domain/interfaces.py`)
```python
class IConversationRepository(ABC):
    async def save(self, conversation: Conversation) -> None
    async def get_by_id(self, conversation_id: UUID) -> Optional[Conversation]
    async def delete(self, conversation_id: UUID) -> bool
    async def list_all(self) -> List[Conversation]
```

### Implementations

#### 1. InMemoryConversationRepository
- **Storage**: Python dictionary in memory
- **Persistence**: None (lost on restart)
- **Use case**: Development/testing

#### 2. SQLiteConversationRepository
- **Storage**: `conversations.db` SQLite file
- **Persistence**: Survives server restarts
- **Use case**: Production

### Data Model

**Conversation Entity** (`domain/entities.py`):
```python
class Conversation(BaseModel):
    id: UUID                    # Primary key
    title: Optional[str]        # Auto-generated from first message
    messages: List[Message]     # All messages in conversation
    created_at: datetime
    updated_at: datetime
```

**Message Entity**:
```python
class Message(BaseModel):
    id: UUID
    role: "user" | "assistant" | "system"
    content: str
    timestamp: datetime
```

### Database Schema
```sql
CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    messages TEXT NOT NULL,      -- JSON array of messages
    created_at TEXT NOT NULL,    -- ISO format
    updated_at TEXT NOT NULL     -- ISO format
);

CREATE INDEX idx_conversations_updated_at ON conversations(updated_at DESC);
```

### When Data is Saved

| Event | What's Saved |
|-------|--------------|
| User sends message | User message added to conversation |
| AI responds (streaming complete) | Assistant message added |
| AI asks clarification (interrupt) | Clarification question saved as assistant message |
| User answers clarification | User's answer saved as user message |

---

## LangGraph Checkpointer (Workflow State)

### Purpose
Stores the **internal workflow state** of the LangGraph graph execution. This enables:
- **Human-in-the-loop interrupts**: Pause graph, wait for user input, resume
- **State recovery**: Resume interrupted workflows after server restart
- **Multi-turn conversations**: Track where we are in the diagnostic flow

### Implementation
Both LLM providers use `AsyncSqliteSaver` from LangGraph:

```python
# In MedicalChatbotProvider
async with AsyncSqliteSaver.from_conn_string(self.db_path) as checkpointer:
    graph = self._build_graph(checkpointer)
    result = await graph.ainvoke(state, config={"configurable": {"thread_id": thread_id}})
```

### What Gets Checkpointed

**MedicalChatbotProvider State**:
```python
class MedicalChatState(TypedDict):
    messages: list[BaseMessage]           # LangChain message history
    intent: "non_medical" | "symptom_checking" | "other_medical" | "ambiguous" | None
    symptom_history: list[str]            # Gathered symptom information
    has_enough_info: bool                 # Ready for final answer?
    unclear_count: int                    # Consecutive unclear responses
    is_early_exit: bool                   # User frustrated/exiting early
```



### Thread ID Linking

The **thread_id** is the key that links the two persistence systems:

```python
# In SendMessageUseCase.execute_stream()
thread_id = conversation.get_thread_id()  # Returns str(conversation.id)
```

This means:
- `conversation.id` (UUID) = Repository primary key
- `thread_id` (string of same UUID) = Checkpointer thread identifier

---

## Data Flow Diagrams

### Flow 1: New Conversation (No Interrupt)

```
User sends "I have a headache"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  SendMessageUseCase.execute_stream()                            │
│                                                                 │
│  1. Create new Conversation (generates UUID)                    │
│  2. Add user Message to Conversation                            │
│  3. Save to Repository ──────────────────────► conversations.db │
│  4. Yield conversation_id to frontend                           │
│                                                                 │
│  5. Call llm_provider.generate_response_stream()                │
│     │                                                           │
│     ▼                                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MedicalChatbotProvider                                   │  │
│  │                                                           │  │
│  │  - Create AsyncSqliteSaver ──────────► checkpoints.db    │  │
│  │  - Build graph with checkpointer                          │  │
│  │  - Invoke graph with thread_id = conversation.id          │  │
│  │  - Graph runs: intent_detector → ... → final_answer       │  │
│  │  - Checkpoints saved at each node ────► checkpoints.db   │  │
│  │  - Return final AI response                               │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  6. Add assistant Message to Conversation                       │
│  7. Save to Repository ──────────────────────► conversations.db │
└─────────────────────────────────────────────────────────────────┘
```

### Flow 2: Conversation with Interrupt (Clarification Needed)

```
User sends "help"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  SendMessageUseCase.execute_stream()                            │
│                                                                 │
│  1. Create Conversation, add user message                       │
│  2. Save to Repository ──────────────────────► conversations.db │
│                                                                 │
│  3. Call llm_provider.generate_response_stream()                │
│     │                                                           │
│     ▼                                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MedicalChatbotProvider                                   │  │
│  │                                                           │  │
│  │  - Graph runs: intent_detector → clarification_node       │  │
│  │  - Node calls interrupt("What can I help you with?")      │  │
│  │  - Graph PAUSES, state saved ─────────► checkpoints.db   │  │
│  │  - Returns {"type": "interrupt", "question": "...",       │  │
│  │             "thread_id": "..."}                           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  4. Yield interrupt JSON to frontend (NOT saved to repo yet)    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
    Frontend shows clarification UI
         │
User selects "Describe my symptoms"
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  ResumeConversationUseCase.execute()                            │
│                                                                 │
│  1. Load Conversation from Repository ◄────── conversations.db │
│  2. Add user's answer as Message                                │
│  3. Save to Repository ──────────────────────► conversations.db │
│                                                                 │
│  4. Call llm_provider.resume(thread_id, user_input)             │
│     │                                                           │
│     ▼                                                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  MedicalChatbotProvider.resume()                          │  │
│  │                                                           │  │
│  │  - Load checkpoint from ◄─────────────── checkpoints.db  │  │
│  │  - Resume graph with Command(resume=user_input)           │  │
│  │  - Graph continues: wait_for_clarification → intent_det.. │  │
│  │  - May interrupt again OR complete                        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  5. Add AI response as Message                                  │
│  6. Save to Repository ──────────────────────► conversations.db │
└─────────────────────────────────────────────────────────────────┘
```

---

## How They Work Together

### The Coordination Problem

The two databases store **different views of the same conversation**:

| Aspect | conversations.db | checkpoints.db |
|--------|------------------|----------------|
| **Messages** | User-facing text only | LangChain message objects with metadata |
| **State** | None | Full workflow state (intent, symptoms, counts) |
| **Purpose** | Display history | Resume interrupted workflows |
| **Lifetime** | Permanent | Can be cleared without losing chat history |

### The thread_id Bridge

```python
# conversation.id (UUID) is used as thread_id (string)
thread_id = str(conversation.id)

# This links:
# - conversations.db row WHERE id = conversation.id
# - checkpoints.db rows WHERE thread_id = str(conversation.id)
```

### Message Duplication

Messages exist in **both** databases but in different formats:

**conversations.db** (via Repository):
```json
{
  "id": "msg-uuid",
  "role": "user",
  "content": "I have a headache",
  "timestamp": "2024-01-15T10:30:00"
}
```

**checkpoints.db** (via LangGraph):
```python
HumanMessage(content="I have a headache", id="msg-uuid", ...)
```

This duplication is intentional:
- Repository messages are the **source of truth** for the UI
- Checkpointer messages are needed for **graph execution context**

### Synchronization Points

| Event | Repository Action | Checkpointer Action |
|-------|-------------------|---------------------|
| User sends message | Save user message | Included in initial state |
| Graph node executes | - | Auto-checkpoint |
| Interrupt occurs | - | Save paused state |
| User resumes | Save user's answer | Resume from checkpoint |
| Graph completes | Save AI response | Final checkpoint |

---

## Database Files

### conversations.db

**Location**: `backend/conversations.db` (configurable)

**Tables**:
- `conversations` - Main conversation storage

**Sample Query**:
```sql
SELECT id, title, json_extract(messages, '$[0].content') as first_msg
FROM conversations
ORDER BY updated_at DESC
LIMIT 10;
```

### checkpoints.db

**Location**: `backend/checkpoints.db` (configurable)

**Tables** (managed by LangGraph):
- `checkpoints` - Serialized graph state
- `checkpoint_blobs` - Large binary data
- `checkpoint_writes` - Pending writes

**Note**: This database is managed entirely by LangGraph's `AsyncSqliteSaver`. You should not modify it directly.

---

## Configuration

### Environment Variables

```bash
# .env file
STORAGE_TYPE=sqlite          # Options: "memory", "sqlite"
```

### Code Configuration

**Repository** (`dependencies.py`):
```python
def _create_conversation_repository():
    if settings.storage_type == "sqlite":
        return SQLiteConversationRepository(db_path="conversations.db")
    return InMemoryConversationRepository()
```

**Checkpointer** (`medical_chatbot_provider.py`):
```python
def __init__(self, api_key: str, db_path: str = "checkpoints.db"):
    self.db_path = db_path
```

### Switching Storage

To use in-memory storage (data lost on restart):
```bash
STORAGE_TYPE=memory
```

To use SQLite (persistent):
```bash
STORAGE_TYPE=sqlite
```

**Note**: The checkpointer always uses SQLite (`checkpoints.db`) regardless of the `STORAGE_TYPE` setting. This is because LangGraph's interrupt/resume functionality requires persistent state.

---

## Summary

| Question | Answer |
|----------|--------|
| Where are chat messages stored? | `conversations.db` via `SQLiteConversationRepository` |
| Where is workflow state stored? | `checkpoints.db` via LangGraph's `AsyncSqliteSaver` |
| How are they linked? | `conversation.id` (UUID) = `thread_id` (string) |
| Can I delete checkpoints.db? | Yes, but interrupted conversations can't be resumed |
| Can I delete conversations.db? | Yes, but all chat history is lost |
| Are messages duplicated? | Yes, in different formats for different purposes |
