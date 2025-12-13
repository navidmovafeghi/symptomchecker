# Implementation Plan

- [x] 1. Create PersistenceService core infrastructure






  - [x] 1.1 Create PersistenceService types and interfaces

    - Create `frontend/services/persistence/types.ts` with `SaveRequest`, `PersistenceEvents`, and `IPersistenceService` interfaces
    - Define event types for `saveStarted`, `saveCompleted`, `saveFailed`, `queueUpdated`
    - _Requirements: 1.1, 1.2, 7.1, 7.2, 7.3, 7.4_
  - [x] 1.2 Implement PersistenceService class with queue and retry logic


    - Create `frontend/services/persistence/persistenceService.ts`
    - Implement per-conversation queue with `Map<string, SaveRequest[]>`
    - Implement retry logic with exponential backoff (100ms, 200ms, 400ms)
    - Implement event emitter pattern for lifecycle events
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4_
  - [x] 1.3 Implement buildStoredConversation with graph state

    - Move helper functions from ViewModel to PersistenceService
    - Ensure `graph_state` is always populated with `completed_stages`, `waiting_node_id`, `stages_live_data`
    - _Requirements: 4.1_

  - [x] 1.4 Create PersistenceService index and singleton

    - Create `frontend/services/persistence/index.ts` with singleton export
    - Export `getPersistenceService()` function
    - _Requirements: 1.3_
  - [x] 1.5 Write property test for round-trip data preservation


    - **Property 1: Round-trip data preservation**
    - **Validates: Requirements 1.2, 4.1, 4.2, 6.3**

- [x] 2. Implement queue and retry behavior



  - [x] 2.1 Implement queue optimization (newer replaces pending)


    - When a new save is queued, replace any pending save for the same conversation
    - Emit `queueUpdated` event when queue changes
    - _Requirements: 3.3, 7.4_

  - [x] 2.2 Implement parallel saves for different conversations

    - Ensure saves to different conversations don't block each other
    - Use separate processing flags per conversation
    - _Requirements: 3.4_

  - [x] 2.3 Write property test for retry with exponential backoff

    - **Property 2: Retry with exponential backoff**
    - **Validates: Requirements 2.1**
  - [x] 2.4 Write property test for sequential queue processing

    - **Property 3: Sequential queue processing**
    - **Validates: Requirements 3.1, 3.2**

  - [x] 2.5 Write property test for queue optimization
    - **Property 4: Queue optimization (newer replaces pending)**

    - **Validates: Requirements 3.3**
  - [x] 2.6 Write property test for parallel saves

    - **Property 5: Parallel saves for different conversations**
    - **Validates: Requirements 3.4**

- [x] 3. Checkpoint - Ensure all tests pass


  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement isSaving state and events








  - [x] 4.1 Implement isSaving and hasPendingSaves methods

    - Track which conversations have saves in progress
    - Expose `isSaving(conversationId)` and `hasPendingSaves()` methods
    - _Requirements: 5.1, 5.2, 5.4_

  - [x] 4.2 Implement event emission for save lifecycle

    - Emit `saveStarted` with conversationId, messageCount, hasGraphState
    - Emit `saveCompleted` with conversationId, durationMs
    - Emit `saveFailed` with conversationId, error, errorCode
    - _Requirements: 7.1, 7.2, 7.3, 8.1, 8.2, 8.3_

  - [x] 4.3 Write property test for isSaving state consistency

    - **Property 6: isSaving state consistency**
    - **Validates: Requirements 5.1, 5.2**

  - [x] 4.4 Write property test for event emission lifecycle





    - **Property 7: Event emission lifecycle**
    - **Validates: Requirements 7.1, 7.2, 7.3**


- [x] 5. Integrate PersistenceService with ViewModel






  - [x] 5.1 Refactor sendMessage to use PersistenceService


    - Remove inline `saveToStorage` helper
    - Call `persistenceService.saveConversation()` with complete state including graphState
    - Await save completion for interrupt state before setting `isWaitingForInput`
    - _Requirements: 1.4, 4.1, 6.1_

  - [x] 5.2 Refactor selectOption to use PersistenceService

    - Remove inline `saveToStorage` helper
    - Call `persistenceService.saveConversation()` with complete state including graphState
    - Await save completion for interrupt state
    - _Requirements: 1.4, 4.1, 6.1_
  - [x] 5.3 Refactor resumeConversation to use PersistenceService


    - Remove inline `saveToStorage` helper
    - Call `persistenceService.saveConversation()` with complete state including graphState
    - Await save completion for interrupt state
    - _Requirements: 1.4, 4.1, 6.1_


  - [x] 5.4 Refactor submitMultipleAnswers to use PersistenceService
    - Remove inline `saveToStorage` helper
    - Call `persistenceService.saveConversation()` with complete state including graphState
    - Await save completion for interrupt state

    - _Requirements: 1.4, 4.1, 6.1_
  - [x] 5.5 Update selectConversation to restore graph state

    - Ensure graph state is restored from `conversation.graph_state`
    - Apply migration for legacy conversations without graph_state
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 5.6 Write property test for interrupt save ordering

    - **Property 8: Interrupt save ordering**
    - **Validates: Requirements 6.1**

- [x] 6. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Add ViewModel state for persistence status
  - [x] 7.1 Add hasPendingSaves state to ViewModel
    - Add `hasPendingSaves: boolean` to ChatState interface
    - Subscribe to PersistenceService events to update state
    - _Requirements: 5.4_
  - [x] 7.2 Subscribe to PersistenceService error events
    - Handle `saveFailed` events and update `storageError` state
    - Handle quota exceeded errors with specific message
    - _Requirements: 2.2, 2.4_
  - [x] 7.3 Implement beforeunload warning
    - Register beforeunload handler when `hasPendingSaves` is true
    - Warn user about unsaved changes
    - _Requirements: 5.3_
  - [x] 7.4 Write unit tests for ViewModel persistence integration
    - Test error event handling
    - Test hasPendingSaves state updates
    - Test beforeunload warning registration
    - _Requirements: 5.3, 5.4, 2.2_

- [x] 8. Update checkpoint expiry handling
  - [x] 8.1 Update checkpoint expiry to save cleared interrupt state
    - When CheckpointExpiredError is caught, save conversation with `is_interrupted: false`
    - Clear `pending_question`, `pending_options`, `pending_questions` in storage
    - _Requirements: 6.4_
  - [x] 8.2 Write unit test for checkpoint expiry handling
    - Test that interrupt state is cleared in storage on checkpoint expiry
    - _Requirements: 6.4_

- [x] 9. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
