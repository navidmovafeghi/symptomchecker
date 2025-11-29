# Requirements Document

## Introduction

This specification addresses critical data loss and inconsistency issues in the Medical Chatbot application's data persistence layer. The current implementation suffers from race conditions, missing message persistence during interrupts, and lack of error recovery during streaming operations. These fixes will ensure reliable conversation storage and consistent state between the conversation repository and LangGraph checkpointer.

## Glossary

- **Conversation**: A chat session containing multiple messages between user and assistant
- **Message**: A single communication unit with role (user/assistant), content, and timestamp
- **Interrupt**: A LangGraph workflow pause that requires user input before continuing
- **Checkpoint**: LangGraph's internal workflow state saved to checkpoints.db
- **Repository**: The data access layer responsible for persisting conversations to conversations.db
- **Thread ID**: A unique identifier linking a conversation to its LangGraph checkpoint state
- **Optimistic Locking**: A concurrency control method using version numbers to detect conflicts

## Requirements

### Requirement 1

**User Story:** As a user, I want my conversation messages to be reliably saved, so that I don't lose chat history when errors occur or when I refresh the page.

#### Acceptance Criteria

1. WHEN an interrupt occurs during conversation THEN the System SHALL save the clarification question as an assistant message to the conversation repository
2. WHEN a streaming response fails mid-way THEN the System SHALL preserve the user message and mark the conversation as having an incomplete response
3. WHEN a user refreshes the page after an interrupt THEN the System SHALL display the previously asked clarification question
4. WHEN saving a conversation fails THEN the System SHALL retry the save operation up to 3 times before reporting an error

### Requirement 2

**User Story:** As a user, I want my conversations to remain consistent even when multiple operations happen quickly, so that messages are never lost or overwritten.

#### Acceptance Criteria

1. WHEN multiple save operations occur on the same conversation THEN the System SHALL use optimistic locking to detect conflicts
2. WHEN a conflict is detected during save THEN the System SHALL reload the conversation and merge the new message before retrying
3. WHEN updating a conversation THEN the System SHALL increment a version number to track changes
4. WHEN a stale conversation object is used for saving THEN the System SHALL reject the save and require a fresh load

### Requirement 3

**User Story:** As a user, I want the conversation history and workflow state to stay synchronized, so that resuming interrupted conversations works correctly.

#### Acceptance Criteria

1. WHEN an interrupt is saved to the checkpoint THEN the System SHALL also save the corresponding question to the conversation repository
2. WHEN resuming a conversation THEN the System SHALL load the latest conversation state from the repository before processing
3. WHEN the LLM provider returns a response THEN the System SHALL save it to the conversation repository before returning to the caller
4. WHEN a conversation is deleted THEN the System SHALL also clean up associated checkpoint data

### Requirement 4

**User Story:** As a developer, I want atomic transaction support for conversation updates, so that partial failures don't leave the database in an inconsistent state.

#### Acceptance Criteria

1. WHEN adding multiple messages in a single operation THEN the System SHALL save them in a single database transaction
2. WHEN a transaction fails THEN the System SHALL rollback all changes from that transaction
3. WHEN the application restarts THEN the System SHALL recover any incomplete transactions
4. WHEN saving conversation state THEN the System SHALL use write-ahead logging for durability

### Requirement 5

**User Story:** As a user, I want to see accurate conversation state after any operation, so that I can trust the displayed information.

#### Acceptance Criteria

1. WHEN a message is saved THEN the System SHALL return the persisted message with its database-assigned metadata
2. WHEN loading a conversation THEN the System SHALL return all messages in chronological order
3. WHEN an error occurs during save THEN the System SHALL report the error to the user interface
4. WHEN the conversation list is requested THEN the System SHALL return accurate message counts for each conversation
