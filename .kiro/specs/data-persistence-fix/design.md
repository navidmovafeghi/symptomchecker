# Design Document: Data Persistence Fix

## Overview

This design addresses critical data loss and inconsistency issues in the Medical Chatbot's persistence layer. The solution introduces optimistic locking, atomic transactions, proper interrupt message persistence, and synchronization between the conversation repository and LangGraph checkpointer.

## Architecture

The fix maintains the existing clean architecture while adding:
1. **Version-based optimistic locking** in the repository layer
2. **Transaction wrapper** for atomic multi-message saves
3. **Interrupt persistence** in the use case layer
4. **Checkpoint cleanup** when conversations are deleted

```
┌─────────────────────────────────────────────────────────────────┐
│                      Application Layer                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Use Cases (with retry logic and interrupt persistence) │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │           Transaction Manager (NEW)                      │   │
│  │  - Atomic operations                                     │   │
│  │  - Retry with backoff                                    │   │
│  │  - Conflict resolution                                   │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                          │
│  ┌──────────────────────────┐  ┌────────────────────────────┐  │
│  │ SQLiteConversationRepo   │  │ MedicalChatbotProvider     │  │
│  │ (with optimistic locking)│  │ (with checkpoint cleanup)  │  │
│  │                          │  │                            │  │
│  │ + version column         │  │ + delete_checkpoint()      │  │
│  │ + conflict detection     │  │                            │  │
│  │ + WAL mode               │  │                            │  │
│  └──────────────────────────┘  └────────────────────────────┘  │
│              │                              │                   │
│              ▼                              ▼                   │
│     ┌─────────────────┐           ┌─────────────────┐          │
│     │conversations.db │           │ checkpoints.db  │          │
│     │ + version col   │           │                 │          │
│     │ + WAL mode      │           │                 │          │
│     └─────────────────┘           └─────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Enhanced Conversation Entity

```python
class Conversation(BaseModel):
    id: UUID
    title: Optional[str]
    messages: List[Message]
    created_at: datetime
    updated_at: datetime
    version: int = 1  # NEW: for optimistic locking
    has_pending_response: bool = False  # NEW: tracks incomplete responses
```

### 2. Enhanced Repository Interface

```python
class IConversationRepository(ABC):
    @abstractmethod
    async def save(self, conversation: Conversation) -> Conversation:
        """Save with optimistic locking. Returns updated conversation with new version."""
        pass
    
    @abstractmethod
    async def save_with_retry(self, conversation: Conversation, max_retries: int = 3) -> Conversation:
        """Save with automatic retry on conflict."""
        pass
    
    @abstractmethod
    async def get_by_id(self, conversation_id: UUID) -> Optional[Conversation]:
        pass
    
    @abstractmethod
    async def delete(self, conversation_id: UUID) -> bool:
        pass
    
    @abstractmethod
    async def list_all(self) -> List[Conversation]:
        pass
```

### 3. Checkpoint Cleanup Interface

```python
class ICheckpointManager(ABC):
    @abstractmethod
    async def delete_checkpoint(self, thread_id: str) -> bool:
        """Delete checkpoint data for a thread."""
        pass
```

### 4. Transaction Manager

```python
class ConversationTransactionManager:
    """Manages atomic conversation updates with retry logic."""
    
    async def execute_with_retry(
        self,
        operation: Callable,
        max_retries: int = 3,
        backoff_base: float = 0.1
    ) -> Any:
        """Execute operation with exponential backoff retry."""
        pass
    
    async def save_messages_atomically(
        self,
        conversation_id: UUID,
        messages: List[Message]
    ) -> Conversation:
        """Add multiple messages in a single transaction."""
        pass
```

## Data Models

### Updated Database Schema

```sql
-- Migration: Add version column and enable WAL
ALTER TABLE conversations ADD COLUMN version INTEGER DEFAULT 1;
ALTER TABLE conversations ADD COLUMN has_pending_response INTEGER DEFAULT 0;

-- Enable Write-Ahead Logging for better concurrency
PRAGMA journal_mode=WAL;

-- Updated table structure
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT,
    messages TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    has_pending_response INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
ON conversations(updated_at DESC);
```

### Optimistic Locking Save Query

```sql
-- Only update if version matches (optimistic lock)
UPDATE conversations 
SET title = ?, messages = ?, updated_at = ?, version = version + 1, has_pending_response = ?
WHERE id = ? AND version = ?;

-- Check rows affected: if 0, conflict detected
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Interrupt messages are persisted
*For any* conversation where an interrupt occurs, the clarification question SHALL exist as an assistant message in the conversation repository immediately after the interrupt is triggered.
**Validates: Requirements 1.1**

### Property 2: User messages survive streaming failures
*For any* streaming operation that fails after the user message is sent, the user message SHALL remain in the conversation repository and the conversation SHALL be marked with `has_pending_response = true`.
**Validates: Requirements 1.2**

### Property 3: Save retry on failure
*For any* save operation that fails due to a transient error, the system SHALL retry up to 3 times with exponential backoff before propagating the error.
**Validates: Requirements 1.4**

### Property 4: Version increment on update
*For any* successful conversation update, the version number SHALL be exactly one greater than the previous version.
**Validates: Requirements 2.3**

### Property 5: Stale write rejection
*For any* save operation using a conversation object with a version lower than the current database version, the save SHALL be rejected with a conflict error.
**Validates: Requirements 2.1, 2.4**

### Property 6: Conflict resolution via reload and merge
*For any* detected version conflict, the system SHALL reload the current conversation state, append the new message(s), and retry the save.
**Validates: Requirements 2.2**

### Property 7: Checkpoint-conversation synchronization
*For any* interrupt or completion event, the conversation repository SHALL contain the corresponding message before the operation returns to the caller.
**Validates: Requirements 3.1, 3.3**

### Property 8: Fresh state on resume
*For any* conversation resume operation, the system SHALL load the latest conversation state from the repository before invoking the LLM provider.
**Validates: Requirements 3.2**

### Property 9: Cascade delete to checkpoints
*For any* conversation deletion, the associated checkpoint data SHALL also be deleted from checkpoints.db.
**Validates: Requirements 3.4**

### Property 10: Transaction atomicity
*For any* multi-message save operation, either all messages SHALL be persisted or none SHALL be persisted.
**Validates: Requirements 4.1, 4.2**

### Property 11: Message chronological ordering
*For any* loaded conversation, messages SHALL be returned in ascending timestamp order.
**Validates: Requirements 5.2**

### Property 12: Accurate message count
*For any* conversation in the list response, the message_count SHALL equal the actual number of messages in that conversation.
**Validates: Requirements 5.4**

## Error Handling

### Conflict Resolution Strategy

```python
async def save_with_conflict_resolution(self, conversation: Conversation, new_message: Message) -> Conversation:
    max_retries = 3
    for attempt in range(max_retries):
        try:
            updated = conversation.add_message(new_message)
            return await self.repository.save(updated)
        except OptimisticLockError:
            if attempt == max_retries - 1:
                raise
            # Reload and retry
            conversation = await self.repository.get_by_id(conversation.id)
            await asyncio.sleep(0.1 * (2 ** attempt))  # Exponential backoff
    raise SaveFailedError("Max retries exceeded")
```

### Error Types

```python
class OptimisticLockError(Exception):
    """Raised when a version conflict is detected during save."""
    pass

class SaveFailedError(Exception):
    """Raised when save fails after all retries."""
    pass

class CheckpointCleanupError(Exception):
    """Raised when checkpoint deletion fails."""
    pass
```

## Testing Strategy

### Unit Testing

- Test optimistic locking with simulated concurrent updates
- Test retry logic with mock failures
- Test transaction rollback on partial failures
- Test version increment behavior

### Property-Based Testing

We will use **Hypothesis** (Python PBT library) to verify correctness properties.

Each property-based test MUST:
- Run a minimum of 100 iterations
- Be tagged with a comment referencing the correctness property: `**Feature: data-persistence-fix, Property {number}: {property_text}**`
- Generate random but valid test data using Hypothesis strategies

Example test structure:
```python
from hypothesis import given, strategies as st, settings

@settings(max_examples=100)
@given(st.text(min_size=1), st.integers(min_value=1, max_value=100))
def test_version_increment_on_update(message_content, initial_version):
    """
    **Feature: data-persistence-fix, Property 4: Version increment on update**
    **Validates: Requirements 2.3**
    """
    # Test implementation
    pass
```

### Integration Testing

- Test full flow: send message → interrupt → resume → complete
- Test page refresh after interrupt preserves state
- Test concurrent message sends to same conversation
- Test conversation deletion cleans up checkpoints
