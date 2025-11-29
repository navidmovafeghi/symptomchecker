# Design Document: Client-Side Storage

## Overview

This design migrates conversation storage from the backend SQLite database (`conversations.db`) to client-side IndexedDB in the browser. The LangGraph checkpointer remains on the server for workflow state management. This architecture improves privacy (medical conversations stay on user's device), reduces server storage costs, and provides faster read operations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER                                         │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         React Application                            │   │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │   │
│  │  │   ChatPage      │  │  useChatViewModel │  │   ApiService     │   │   │
│  │  │   (View)        │◄─┤  (ViewModel)      │◄─┤   (HTTP calls)   │   │   │
│  │  └─────────────────┘  └────────┬─────────┘  └──────────────────┘   │   │
│  │                                │                      │              │   │
│  │                                ▼                      │              │   │
│  │                    ┌──────────────────────┐           │              │   │
│  │                    │  StorageService      │           │              │   │
│  │                    │  (NEW - IndexedDB)   │           │              │   │
│  │                    └──────────┬───────────┘           │              │   │
│  │                               │                       │              │   │
│  └───────────────────────────────┼───────────────────────┼──────────────┘   │
│                                  ▼                       │                   │
│                    ┌──────────────────────┐              │                   │
│                    │     IndexedDB        │              │                   │
│                    │  - conversations     │              │                   │
│                    │  - messages          │              │                   │
│                    └──────────────────────┘              │                   │
└──────────────────────────────────────────────────────────┼───────────────────┘
                                                           │ HTTP
                                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER                                          │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         FastAPI Backend                              │   │
│  │  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │   │
│  │  │   Routes        │  │  Use Cases       │  │  LLM Provider    │   │   │
│  │  │   (Simplified)  │──┤  (No repo calls) │──┤  (LangGraph)     │   │   │
│  │  └─────────────────┘  └──────────────────┘  └────────┬─────────┘   │   │
│  │                                                       │             │   │
│  │                                             ┌─────────▼─────────┐   │   │
│  │                                             │  checkpoints.db   │   │   │
│  │                                             │  (LangGraph only) │   │   │
│  │                                             └───────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. StorageService Interface (Frontend)

```typescript
// frontend/services/storage.ts

interface IStorageService {
  // Conversation operations
  saveConversation(conversation: Conversation): Promise<void>;
  getConversation(id: string): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<boolean>;
  listConversations(): Promise<ConversationSummary[]>;
  
  // Initialization
  initialize(): Promise<void>;
  isAvailable(): boolean;
  
  // Schema migration
  migrateIfNeeded(): Promise<void>;
}
```

### 2. IndexedDBStorageService Implementation

```typescript
// frontend/services/indexedDBStorage.ts

class IndexedDBStorageService implements IStorageService {
  private db: IDBDatabase | null = null;
  private readonly DB_NAME = 'medical-chatbot';
  private readonly DB_VERSION = 1;
  private readonly STORE_NAME = 'conversations';
  
  async initialize(): Promise<void>;
  async saveConversation(conversation: Conversation): Promise<void>;
  async getConversation(id: string): Promise<Conversation | null>;
  async deleteConversation(id: string): Promise<boolean>;
  async listConversations(): Promise<ConversationSummary[]>;
  isAvailable(): boolean;
  async migrateIfNeeded(): Promise<void>;
}
```

### 3. Updated API Service

The API service will be modified to:
- Send conversation history with message requests
- Remove conversation CRUD endpoints (except checkpoint deletion)
- Handle checkpoint-not-found gracefully

```typescript
// frontend/services/api.ts (modified)

interface SendMessageRequest {
  message: string;
  conversation_id?: string;
  conversation_history?: Message[];  // NEW: Send history for context
}

class ApiService {
  // Modified: Include conversation history
  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: string) => void
  ): Promise<StreamResult>;
  
  // Modified: Send history for context
  async resumeConversation(
    threadId: string,
    userInput: string,
    conversationHistory?: Message[]  // NEW: Fallback if checkpoint missing
  ): Promise<ResumeResult>;
  
  // NEW: Only deletes server checkpoint
  async deleteCheckpoint(conversationId: string): Promise<void>;
  
  // REMOVED: getConversation, listConversations (now client-side)
}
```

### 4. Updated ViewModel

```typescript
// frontend/viewmodels/useChatViewModel.ts (modified)

interface ChatState {
  // ... existing state ...
  storageError: string | null;       // NEW: Storage-specific errors
  isStorageAvailable: boolean;       // NEW: IndexedDB availability
  checkpointExpired: boolean;        // NEW: Server checkpoint missing
  checkpointExpiredMessage: string | null;  // NEW: User-facing message
}

// Key changes:
// - Load conversations from IndexedDB on init
// - Save to IndexedDB after each message
// - Send conversation history with API requests
// - Handle checkpoint expiry gracefully with user notification
```

## Data Models

### IndexedDB Schema

```typescript
// Database: 'medical-chatbot'
// Version: 1

// Object Store: 'conversations'
interface StoredConversation {
  id: string;              // Primary key
  title: string | null;
  messages: StoredMessage[];
  created_at: string;      // ISO timestamp
  updated_at: string;      // ISO timestamp
  version: number;         // For future migrations
  thread_id: string;       // Links to server checkpoint
  is_interrupted: boolean; // Has pending clarification
  pending_question?: string;
  pending_options?: string[];
}

interface StoredMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  options?: string[];      // For clarification questions
  isQuestion?: boolean;
}

// Indexes:
// - 'by-updated': updated_at (for sorting)
// - 'by-interrupted': is_interrupted (for finding pending conversations)
```

### API Request/Response Changes

```typescript
// Modified SendMessageRequest
interface SendMessageRequest {
  message: string;
  conversation_id?: string;
  // NEW: Full history for LLM context (server doesn't store)
  conversation_history?: Array<{
    role: string;
    content: string;
  }>;
}

// Modified ResumeRequest  
interface ResumeConversationRequest {
  thread_id: string;
  user_input: string;
  // NEW: Fallback history if checkpoint expired
  conversation_history?: Array<{
    role: string;
    content: string;
  }>;
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Conversation persistence round-trip
*For any* valid conversation object, saving to IndexedDB and then loading should return an equivalent conversation with all messages preserved.
**Validates: Requirements 1.1, 1.2, 6.1**

### Property 2: Immediate persistence on update
*For any* conversation update (new message added), the IndexedDB should contain the updated conversation immediately after the save operation completes.
**Validates: Requirements 1.3, 3.2**

### Property 3: Delete removes from storage
*For any* conversation that exists in IndexedDB, calling delete should result in the conversation no longer being retrievable.
**Validates: Requirements 2.1**

### Property 4: List returns all conversations
*For any* set of conversations stored in IndexedDB, listing should return all of them with correct summary information.
**Validates: Requirements 2.3**

### Property 5: API requests include conversation history
*For any* message sent to the AI, the API request should include the full conversation history from IndexedDB.
**Validates: Requirements 3.1**

### Property 6: Interrupt state persisted
*For any* interrupt response from the server, the clarification question and options should be saved to IndexedDB before the UI displays them.
**Validates: Requirements 3.3, 4.1**

### Property 7: Resume sends conversation context
*For any* resume operation, the API request should include the conversation_id. After a successful resume, the AI response should be saved to IndexedDB before being displayed.
**Validates: Requirements 3.4, 4.2, 4.4**

### Property 11: Checkpoint missing graceful degradation
*For any* resume operation where the server checkpoint is missing, the system should notify the user that the conversation cannot be resumed from the exact workflow state and offer to start a new conversation with the previous context as background.
**Validates: Requirements 3.5, 4.3**

### Property 8: Data structure validation
*For any* data loaded from IndexedDB, the system should validate it has required fields (id, messages, timestamps) before use.
**Validates: Requirements 6.2**

### Property 9: Schema migration preserves data
*For any* conversation stored in an older schema version, migration should preserve all message content and metadata.
**Validates: Requirements 6.4**

### Property 10: Cascade delete to server checkpoint
*For any* conversation deletion, the system should also request deletion of the associated server checkpoint.
**Validates: Requirements 2.2**

## Error Handling

### Storage Errors

```typescript
class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: 'UNAVAILABLE' | 'QUOTA_EXCEEDED' | 'CORRUPTION' | 'UNKNOWN'
  ) {
    super(message);
  }
}

// Error handling in ViewModel
try {
  await storageService.saveConversation(conversation);
} catch (error) {
  if (error instanceof StorageError) {
    switch (error.code) {
      case 'UNAVAILABLE':
        set({ storageError: 'Browser storage is not available. Your conversations will not be saved.' });
        break;
      case 'QUOTA_EXCEEDED':
        set({ storageError: 'Storage is full. Please delete some old conversations.' });
        break;
      case 'CORRUPTION':
        console.error('Data corruption detected:', error);
        // Skip corrupted data, continue with valid data
        break;
    }
  }
}
```

### Checkpoint Not Found Handling

When a server checkpoint is missing (expired or deleted), the LangGraph workflow state cannot be restored. The conversation history alone is insufficient to resume from the exact workflow step because:
- The graph needs checkpoint data to know which node it was on
- Pending interrupt state (clarification questions) is stored in the checkpoint
- Simply sending history would restart the workflow from the beginning

**Design Decision:** Rather than silently starting a fresh workflow (which could confuse users), we notify the user and offer options:

```typescript
// In ApiService.resumeConversation
async resumeConversation(threadId: string, userInput: string) {
  try {
    return await this.doResume(threadId, userInput);
  } catch (error) {
    if (error.status === 404) {
      // Checkpoint expired - cannot restore workflow state
      throw new CheckpointExpiredError(
        'This conversation cannot be resumed. The server session has expired.'
      );
    }
    throw error;
  }
}

// In ViewModel - handle the error
catch (error) {
  if (error instanceof CheckpointExpiredError) {
    set({ 
      checkpointExpired: true,
      checkpointExpiredMessage: 'Your session has expired. You can start a new conversation or continue chatting without the previous workflow context.'
    });
  }
}
```

**User Options When Checkpoint Expires:**
1. Start a new conversation (recommended)
2. Continue in the same conversation with a fresh workflow - the AI will have message history for context but won't be at the same workflow step

## Testing Strategy

### Unit Testing

- Test IndexedDB operations with fake-indexeddb library
- Test data validation logic
- Test error handling for various failure modes
- Test schema migration logic

### Property-Based Testing

We will use **fast-check** (TypeScript PBT library) to verify correctness properties.

Each property-based test MUST:
- Run a minimum of 100 iterations
- Be tagged with a comment referencing the correctness property: `**Feature: client-side-storage, Property {number}: {property_text}**`
- Generate random but valid test data using fast-check arbitraries

Example test structure:
```typescript
import fc from 'fast-check';

// **Feature: client-side-storage, Property 1: Conversation persistence round-trip**
// **Validates: Requirements 1.1, 1.2, 6.1**
test('conversation round-trip preserves all data', async () => {
  await fc.assert(
    fc.asyncProperty(
      conversationArbitrary,
      async (conversation) => {
        await storageService.saveConversation(conversation);
        const loaded = await storageService.getConversation(conversation.id);
        expect(loaded).toEqual(conversation);
      }
    ),
    { numRuns: 100 }
  );
});
```

### Integration Testing

- Test full flow: send message → save to IndexedDB → reload page → verify data
- Test interrupt flow: interrupt → save → reload → resume
- Test checkpoint expiry fallback
- Test concurrent operations
