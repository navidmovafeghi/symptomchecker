# Requirements Document

## Introduction

This feature addresses a performance issue in the `SymptomCheckerProvider` where the `AsyncSqliteSaver` checkpointer is not properly initialized, causing slow response times. The current implementation creates the checkpointer outside of an async context manager, which means the SQLite connection is not properly established at startup. This results in connection overhead on every graph operation, significantly degrading performance compared to running the LLM provider standalone.

The fix involves properly managing the checkpointer lifecycle using async context management and connection reuse patterns.

## Glossary

- **AsyncSqliteSaver**: LangGraph's asynchronous SQLite-based checkpointer for persisting workflow state
- **Checkpointer**: A component that saves and restores LangGraph workflow state for interrupt/resume functionality
- **Connection_Pool**: A pattern where database connections are reused rather than created per-request
- **Async_Context_Manager**: Python's `async with` pattern for managing async resource lifecycle
- **Graph_Compilation**: The process of building a LangGraph state machine from nodes and edges

## Requirements

### Requirement 1

**User Story:** As a user, I want the chatbot to respond quickly when I send a message, so that I have a smooth conversational experience.

#### Acceptance Criteria

1. WHEN the SymptomCheckerProvider is initialized THEN the Checkpointer SHALL establish a persistent database connection that remains open for the provider's lifetime
2. WHEN multiple requests are processed THEN the Checkpointer SHALL reuse the existing database connection rather than creating new connections per request
3. WHEN the application shuts down THEN the Checkpointer SHALL properly close the database connection to prevent resource leaks

### Requirement 2

**User Story:** As a developer, I want the checkpointer to be properly initialized following LangGraph best practices, so that the application performs optimally.

#### Acceptance Criteria

1. WHEN building the symptom checker graph THEN the System SHALL use proper async initialization for the AsyncSqliteSaver
2. WHEN the checkpointer is created THEN the System SHALL call the setup method to ensure database tables exist
3. WHEN the graph is compiled THEN the System SHALL use a single checkpointer instance across all graph operations

### Requirement 3

**User Story:** As a developer, I want the graph to be compiled once at startup, so that request processing does not incur graph compilation overhead.

#### Acceptance Criteria

1. WHEN the SymptomCheckerProvider is initialized THEN the System SHALL compile the graph once and reuse it for all requests
2. WHEN processing a request THEN the System SHALL NOT rebuild the graph or recreate the checkpointer
3. WHEN the provider instance is reused across requests THEN the compiled graph and checkpointer SHALL remain valid and functional

### Requirement 4

**User Story:** As a developer, I want the fix to maintain backward compatibility, so that existing functionality continues to work.

#### Acceptance Criteria

1. WHEN the fix is applied THEN the ILLMProvider interface methods SHALL continue to function identically
2. WHEN the fix is applied THEN the interrupt/resume workflow SHALL continue to work correctly
3. WHEN the fix is applied THEN the checkpoint deletion functionality SHALL continue to work correctly
4. WHEN the fix is applied THEN all existing tests SHALL continue to pass

