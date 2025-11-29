# Implementation Plan

- [x] 1. Create IndexedDB storage service





  - [x] 1.1 Create storage service interface and types


    - Create `frontend/services/storage/types.ts` with IStorageService interface
    - Define StoredConversation and StoredMessage types
    - Define StorageError class with error codes
    - _Requirements: 5.1, 6.1_
  - [x] 1.2 Implement IndexedDBStorageService


    - Create `frontend/services/storage/indexedDBStorage.ts`
    - Implement database initialization with schema
    - Implement saveConversation, getConversation, deleteConversation, listConversations
    - Add indexes for updated_at and is_interrupted
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.3_
  - [x] 1.3 Write property test for conversation round-trip


    - **Property 1: Conversation persistence round-trip**
    - **Validates: Requirements 1.1, 1.2, 6.1**
  - [x] 1.4 Implement data validation on load


    - Validate required fields (id, messages, timestamps) before returning
    - Log and skip corrupted conversations
    - _Requirements: 6.2, 6.3_
  - [x] 1.5 Write property test for data validation


    - **Property 8: Data structure validation**
    - **Validates: Requirements 6.2**
  - [x] 1.6 Implement schema migration support


    - Add version field to stored conversations
    - Implement migrateIfNeeded() for future schema changes
    - _Requirements: 6.4_
  - [x] 1.7 Write property test for schema migration


    - **Property 9: Schema migration preserves data**
    - **Validates: Requirements 6.4**

- [x] 2. Implement storage error handling





  - [x] 2.1 Add IndexedDB availability check


    - Implement isAvailable() method
    - Check for IndexedDB support on initialization
    - _Requirements: 1.4, 5.3_
  - [x] 2.2 Handle quota exceeded errors


    - Catch QuotaExceededError during save operations
    - Return appropriate StorageError with QUOTA_EXCEEDED code
    - _Requirements: 2.4_
  - [x] 2.3 Create storage service factory


    - Create `frontend/services/storage/index.ts` as entry point
    - Export singleton instance of IndexedDBStorageService
    - _Requirements: 5.1, 5.2_

- [x] 3. Checkpoint - Ensure storage service tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Update ViewModel to use client storage





  - [x] 4.1 Add storage service integration to ViewModel


    - Import and initialize storage service in useChatViewModel
    - Add storageError, isStorageAvailable, checkpointExpired, and checkpointExpiredMessage state
    - Load conversations from IndexedDB on initialization
    - _Requirements: 1.2, 1.4_
  - [x] 4.2 Update sendMessage to save to IndexedDB


    - Save conversation to IndexedDB after user message
    - Save conversation to IndexedDB after AI response
    - Handle storage errors gracefully
    - _Requirements: 1.1, 1.3, 3.2_


  - [x] 4.3 Write property test for immediate persistence

    - **Property 2: Immediate persistence on update**
    - **Validates: Requirements 1.3, 3.2**
  - [x] 4.4 Update interrupt handling to save to IndexedDB

    - Save clarification question and options to IndexedDB
    - Set is_interrupted flag on conversation
    - _Requirements: 3.3, 4.1_

  - [x] 4.5 Write property test for interrupt persistence

    - **Property 6: Interrupt state persisted**
    - **Validates: Requirements 3.3, 4.1**

  - [x] 4.6 Update conversation list to load from IndexedDB

    - Replace API call with IndexedDB query in loadConversations
    - _Requirements: 2.3_

  - [x] 4.7 Write property test for list conversations

    - **Property 4: List returns all conversations**
    - **Validates: Requirements 2.3**

  - [x] 4.8 Update delete to remove from IndexedDB and server

    - Delete from IndexedDB first
    - Then call API to delete server checkpoint
    - _Requirements: 2.1, 2.2_
  - [x] 4.9 Write property test for delete operations


    - **Property 3: Delete removes from storage**
    - **Property 10: Cascade delete to server checkpoint**
    - **Validates: Requirements 2.1, 2.2**

- [x] 5. Checkpoint - Ensure ViewModel tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update API service for client-side storage





  - [x] 6.1 Modify sendMessageStream to include conversation history


    - Add conversation_history parameter to request
    - Send full message history with each request
    - _Requirements: 3.1_

  - [x] 6.2 Write property test for API request includes history

    - **Property 5: API requests include conversation history**
    - **Validates: Requirements 3.1**

  - [x] 6.3 Modify resumeConversation to handle checkpoint expiry

    - Create CheckpointExpiredError class
    - If 404 returned, throw CheckpointExpiredError instead of silently failing
    - _Requirements: 3.4, 4.2_

  - [x] 6.4 Write property test for resume operations

    - **Property 7: Resume sends conversation context**
    - **Validates: Requirements 3.4, 4.2, 4.4**

  - [x] 6.5 Write property test for checkpoint expiry handling

    - **Property 11: Checkpoint missing graceful degradation**
    - **Validates: Requirements 3.5, 4.3**

  - [x] 6.6 Add deleteCheckpoint API method

    - Create new method to delete only server checkpoint
    - Remove old deleteConversation method (no longer needed for full delete)
    - _Requirements: 2.2_

  - [x] 6.7 Remove server-side conversation endpoints from API service

    - Remove getConversation (now from IndexedDB)
    - Remove listConversations (now from IndexedDB)
    - Keep only: sendMessageStream, resumeConversation, deleteCheckpoint
    - _Requirements: 1.1, 2.3_

- [x] 7. Update backend to accept conversation history






  - [x] 7.1 Update SendMessageRequest DTO

    - Add optional conversation_history field to request
    - Update validation to accept history array
    - _Requirements: 3.1_

  - [x] 7.2 Update SendMessageUseCase to use provided history

    - If conversation_history provided, use it instead of loading from DB
    - Generate new conversation_id if not provided
    - _Requirements: 3.1_

  - [x] 7.3 Update ResumeConversationUseCase to return clear error on missing checkpoint

    - If checkpoint not found, return 404 with clear error message
    - Frontend will handle by showing checkpoint expiry UI
    - _Requirements: 3.5, 4.3_

  - [x] 7.4 Add checkpoint-only delete endpoint

    - Create DELETE /api/chat/checkpoints/{thread_id} endpoint
    - Only deletes from checkpoints.db, not conversations.db
    - _Requirements: 2.2_

- [x] 8. Checkpoint - Ensure backend changes work





  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Remove server-side conversation storage





  - [x] 9.1 Remove conversation repository usage from use cases


    - Update SendMessageUseCase to not save to repository
    - Update ResumeConversationUseCase to not save to repository
    - Keep checkpoint operations
    - _Requirements: 1.1_
  - [x] 9.2 Deprecate conversation list/get endpoints


    - Mark GET /api/chat/conversations as deprecated or remove
    - Mark GET /api/chat/conversations/{id} as deprecated or remove
    - Update DELETE to only handle checkpoint cleanup
    - _Requirements: 2.3_
  - [x] 9.3 Update dependencies.py


    - Remove conversation repository injection where no longer needed
    - Keep checkpoint manager injection
    - _Requirements: 1.1_

- [x] 10. Update frontend components





  - [x] 10.1 Update ChatPage for storage errors


    - Display storage error banner when storageError is set
    - Show warning if isStorageAvailable is false
    - _Requirements: 1.4, 2.4_
  - [x] 10.2 Update Sidebar for client-side data


    - Load conversation list from ViewModel (which uses IndexedDB)
    - No changes needed if already using ViewModel
    - _Requirements: 2.3_
  - [x] 10.3 Handle page reload with interrupted conversation


    - On load, check for is_interrupted conversations
    - Restore pending question and options from IndexedDB
    - _Requirements: 4.1_
  - [x] 10.4 Handle checkpoint expiry UI


    - Display checkpoint expiry message when checkpointExpired is true
    - Offer user options: start new conversation or continue with fresh workflow
    - Clear checkpointExpired state when user makes a choice
    - _Requirements: 3.5, 4.3_

- [x] 11. Add fast-check testing dependency





  - [x] 11.1 Install fast-check package


    - Add fast-check to devDependencies in package.json
    - _Requirements: Testing_

  - [x] 11.2 Create test utilities for IndexedDB

    - Set up fake-indexeddb for testing
    - Create conversation and message arbitraries for fast-check
    - _Requirements: Testing_

- [x] 12. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
