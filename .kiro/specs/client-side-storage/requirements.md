# Requirements Document

## Introduction

This specification defines the migration of conversation storage from the backend SQLite database to client-side browser storage using IndexedDB. Currently, conversations are persisted in `conversations.db` on the server. This change will store conversation data in the user's browser, improving privacy (sensitive medical conversations stay on user's device), reducing server storage requirements, and providing faster read operations.

The LangGraph checkpointer (`checkpoints.db`) will remain on the server as it's required for workflow state management and interrupt/resume functionality. The conversation ID serves as the thread_id to link client conversations with server checkpoints.

### Trade-offs Accepted
- No multi-device sync (conversations are device-specific)
- Data loss if user clears browser data
- Larger API payloads (conversation history sent with requests)

### Future Considerations
- **PostgreSQL Migration**: Current SQLite is sufficient for ~2000 users with client-side storage (server only stores checkpoints). Consider migrating to PostgreSQL if scaling beyond 5000 users, deploying multiple server instances, or adding server-side features like user accounts.

## Glossary

- **IndexedDB**: Browser-based NoSQL database with large storage capacity and asynchronous API
- **Conversation**: A chat session containing multiple messages between user and assistant
- **Message**: A single communication unit with role (user/assistant), content, and timestamp
- **thread_id**: Unique identifier linking a client conversation to its server checkpoint
- **Checkpoint**: LangGraph's workflow state stored on server for interrupt/resume functionality
- **Hydration**: Loading persisted data from IndexedDB when the application initializes

## Requirements

### Requirement 1

**User Story:** As a user, I want my conversations stored in my browser using IndexedDB, so that my medical chat history is private and doesn't require server storage.

#### Acceptance Criteria

1. WHEN a user sends a message THEN the System SHALL save the conversation to IndexedDB instead of the backend database
2. WHEN a user opens the application THEN the System SHALL load existing conversations from IndexedDB
3. WHEN a conversation is updated THEN the System SHALL persist the changes to IndexedDB immediately
4. WHEN IndexedDB is unavailable THEN the System SHALL display an error message indicating storage is not available

### Requirement 2

**User Story:** As a user, I want to manage my locally stored conversations, so that I can delete old chats and free up browser storage.

#### Acceptance Criteria

1. WHEN a user deletes a conversation THEN the System SHALL remove the conversation from IndexedDB
2. WHEN a user deletes a conversation THEN the System SHALL also request deletion of the associated server checkpoint
3. WHEN a user requests the conversation list THEN the System SHALL retrieve all conversations from IndexedDB
4. WHEN browser storage exceeds capacity THEN the System SHALL notify the user and suggest deleting old conversations

### Requirement 3

**User Story:** As a user, I want my conversations to work with the backend AI, so that I can have meaningful medical consultations.

#### Acceptance Criteria

1. WHEN sending a message to the AI THEN the System SHALL include conversation history from IndexedDB in the API request
2. WHEN the AI responds THEN the System SHALL save the response to IndexedDB before displaying
3. WHEN an interrupt occurs THEN the System SHALL save the clarification question to IndexedDB immediately
4. WHEN resuming a conversation THEN the System SHALL send the conversation_id and user response to the backend
5. WHEN the server checkpoint is missing THEN the System SHALL send full conversation history to allow the AI to continue

### Requirement 4

**User Story:** As a user, I want to resume interrupted conversations even after closing my browser, so that I don't lose progress in medical consultations.

#### Acceptance Criteria

1. WHEN a user returns to an interrupted conversation THEN the System SHALL display the last clarification question from IndexedDB
2. WHEN a user answers a clarification question THEN the System SHALL send the conversation_id to resume from server checkpoint
3. WHEN the server checkpoint has expired THEN the System SHALL send conversation history to start a fresh workflow
4. WHEN resuming succeeds THEN the System SHALL save the AI response to IndexedDB

### Requirement 5

**User Story:** As a developer, I want the storage layer to be abstracted, so that the storage mechanism can be changed without affecting the rest of the application.

#### Acceptance Criteria

1. WHEN implementing client storage THEN the System SHALL use a storage service interface that abstracts IndexedDB operations
2. WHEN the storage mechanism changes THEN the System SHALL require changes only in the storage service implementation
3. WHEN initializing the application THEN the System SHALL verify IndexedDB availability before proceeding

### Requirement 6

**User Story:** As a user, I want my conversation data to be structured consistently, so that it works reliably across browser sessions.

#### Acceptance Criteria

1. WHEN saving a conversation THEN the System SHALL store data with id, title, messages array, timestamps, and version fields
2. WHEN loading a conversation THEN the System SHALL validate the data structure before use
3. WHEN data corruption is detected THEN the System SHALL log the error and skip the corrupted conversation
4. WHEN the data schema changes THEN the System SHALL migrate existing data to the new format
