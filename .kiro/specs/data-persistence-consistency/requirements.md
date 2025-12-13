# Requirements Document

## Introduction

This specification addresses data persistence and consistency issues in the medical chatbot's conversation storage system. The current implementation has several architectural problems:

1. **Fire-and-Forget Saves**: The `saveToStorage` helper is defined locally in each action method and doesn't await completion, leading to potential data loss
2. **No Graph State Persistence**: The `buildStoredConversation` helper doesn't include `graph_state`, so visualization state is lost on reload
3. **Duplicated Code**: The `saveToStorage` helper is copy-pasted across `sendMessage`, `selectOption`, `resumeConversation`, and `submitMultipleAnswers`
4. **Race Conditions**: Multiple rapid saves can conflict without a queue mechanism
5. **No Retry Logic**: Failed saves are logged but not retried
6. **Inconsistent State**: UI can show messages that were never persisted

This feature will refactor the persistence layer into a centralized, reliable service that ensures data consistency across all operations.

## Glossary

- **IndexedDB**: Browser-based NoSQL database used for client-side conversation storage
- **Conversation**: A chat session containing messages, metadata, interrupt state, and graph state
- **Graph State**: The visualization state tracking completed stages (`completedStages`), waiting nodes (`waitingNodeId`), and accumulated live data (`stagesLiveData`)
- **Interrupt State**: The state when the AI is waiting for user input, including `is_interrupted`, `pending_question`, `pending_options`, and `pending_questions`
- **Fire-and-Forget**: An async operation that is started but not awaited for completion
- **Race Condition**: A situation where multiple operations compete and may produce inconsistent results
- **Optimistic Update**: Updating the UI immediately before confirming the operation succeeded
- **Save Queue**: A sequential queue ensuring saves are processed in order
- **Persistence Service**: A centralized service responsible for all storage operations with retry and queue logic
- **ViewModel**: The Zustand store (`useChatViewModel`) that manages chat state and business logic

## Requirements

### Requirement 1

**User Story:** As a developer, I want a centralized persistence service, so that all storage operations go through a single, well-tested code path.

#### Acceptance Criteria

1. THE Persistence_Service SHALL provide a single `saveConversation` method that handles all conversation persistence
2. THE Persistence_Service SHALL accept the complete conversation state including messages, interrupt state, and graph state
3. THE Persistence_Service SHALL be the only code path that writes to IndexedDB for conversations
4. WHEN the ViewModel needs to save THEN the ViewModel SHALL call the Persistence_Service instead of inline storage operations

### Requirement 2

**User Story:** As a user, I want my conversation messages to be reliably saved, so that I don't lose my chat history due to storage failures.

#### Acceptance Criteria

1. WHEN a save operation fails THEN the Persistence_Service SHALL retry the operation up to 3 times with exponential backoff (100ms, 200ms, 400ms delays)
2. WHEN all retry attempts fail THEN the Persistence_Service SHALL emit an error event that the ViewModel can handle
3. WHEN a save operation succeeds after retry THEN the Persistence_Service SHALL clear any pending error state for that conversation
4. WHEN a QuotaExceededError occurs THEN the Persistence_Service SHALL emit a specific quota error event without retrying

### Requirement 3

**User Story:** As a user, I want my conversations to be saved in the correct order, so that my chat history remains consistent and accurate.

#### Acceptance Criteria

1. WHEN multiple save operations are triggered for the same conversation THEN the Persistence_Service SHALL process saves sequentially using a per-conversation queue
2. WHEN a new save is queued while another is in progress for the same conversation THEN the Persistence_Service SHALL wait for the current save to complete
3. WHEN a queued save contains newer data than a pending save for the same conversation THEN the Persistence_Service SHALL replace the pending save to avoid redundant writes
4. WHEN saves are queued for different conversations THEN the Persistence_Service SHALL process them in parallel

### Requirement 4

**User Story:** As a user, I want my graph visualization state to be saved with my conversation, so that when I return to a conversation, I see the correct progress indicators.

#### Acceptance Criteria

1. WHEN a conversation is saved THEN the Persistence_Service SHALL include the graph state with `completed_stages`, `waiting_node_id`, and `stages_live_data` fields
2. WHEN a conversation is loaded THEN the ViewModel SHALL restore the graph state from storage to the UI state
3. WHEN a conversation has no stored graph state (legacy data) THEN the ViewModel SHALL derive graph state from message history using the existing `migrateConversationGraphState` method
4. WHEN graph state is restored THEN the ViewModel SHALL validate that `completed_stages` is an array and `waiting_node_id` is a string or null

### Requirement 5

**User Story:** As a user, I want to know when my conversation is being saved, so that I can wait before closing the browser if needed.

#### Acceptance Criteria

1. WHEN a save operation is in progress THEN the Persistence_Service SHALL expose an `isSaving` state for each conversation
2. WHEN all pending saves complete for a conversation THEN the Persistence_Service SHALL set `isSaving` to false
3. WHEN the user attempts to close the browser with any pending saves THEN the application SHALL trigger a beforeunload warning
4. THE ViewModel SHALL expose a global `hasPendingSaves` state derived from the Persistence_Service

### Requirement 6

**User Story:** As a user, I want my interrupt state to be reliably persisted, so that I can resume answering questions even after refreshing the page.

#### Acceptance Criteria

1. WHEN an interrupt occurs (AI asks a question) THEN the ViewModel SHALL await the save completion before setting `isWaitingForInput` to true
2. WHEN the user provides an answer to an interrupt THEN the ViewModel SHALL save the updated state with `is_interrupted` set to false
3. WHEN the application loads with a stored interrupt state THEN the ViewModel SHALL restore `pendingQuestion`, `pendingOptions`, `pendingQuestions`, and `threadId`
4. WHEN a checkpoint expires on the server THEN the ViewModel SHALL save the conversation with cleared interrupt state

### Requirement 7

**User Story:** As a developer, I want the persistence service to emit events, so that the ViewModel can react to save success and failure.

#### Acceptance Criteria

1. THE Persistence_Service SHALL emit a `saveStarted` event when a save operation begins
2. THE Persistence_Service SHALL emit a `saveCompleted` event when a save operation succeeds
3. THE Persistence_Service SHALL emit a `saveFailed` event when a save operation fails after all retries
4. THE Persistence_Service SHALL emit a `queueUpdated` event when the save queue changes

### Requirement 8

**User Story:** As a developer, I want comprehensive logging for storage operations, so that I can diagnose persistence issues in production.

#### Acceptance Criteria

1. WHEN a save operation starts THEN the Persistence_Service SHALL log the conversation ID, message count, and whether graph state is included
2. WHEN a save operation fails THEN the Persistence_Service SHALL log the error type, message, and retry attempt number
3. WHEN a save operation succeeds THEN the Persistence_Service SHALL log the conversation ID and operation duration in milliseconds
4. WHEN the save queue state changes THEN the Persistence_Service SHALL log the queue depth for each conversation with pending saves
