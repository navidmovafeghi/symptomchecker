# Implementation Plan

## Status: ✅ COMPLETE

All tasks for the streaming-resume-stages feature have been implemented and verified.

- [x] 1. Implement backend streaming resume
  - [x] 1.1 Add `resume_stream()` method to SymptomCheckerProvider
    - Create async generator method that yields stage JSON messages
    - Yield initial stage message before graph execution
    - Yield stage messages as each node completes
    - Yield final interrupt or complete message
    - Ensure all messages end with newline delimiter
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1_
  - [x] 1.2 Write property test for stage message structure
    - **Property 2: Stage message structure validity**
    - **Validates: Requirements 2.2**
    - _Implemented in: backend/tests/test_streaming_resume_stages.py_
  - [x] 1.3 Write property test for final message ordering
    - **Property 3: Final message is always last**
    - **Validates: Requirements 2.3**
    - _Implemented in: backend/tests/test_streaming_resume_stages.py_
  - [x] 1.4 Write property test for newline delimiters
    - **Property 4: Newline delimiter presence**
    - **Validates: Requirements 2.4**
    - _Implemented in: backend/tests/test_streaming_resume_stages.py_
  - [x] 1.5 Write property test for initial stage message
    - **Property 6: Initial stage message first**
    - **Validates: Requirements 4.1**
    - _Implemented in: backend/tests/test_streaming_resume_stages.py_

- [x] 2. Add streaming resume use case and endpoint
  - [x] 2.1 Add `execute_stream()` method to ResumeConversationUseCase
    - Create async generator that delegates to provider's resume_stream
    - Handle InvalidMessageException for empty input
    - _Requirements: 2.1_
    - _Implemented in: backend/src/application/use_cases.py_
  - [x] 2.2 Add `/resume/stream` endpoint to routes
    - Create POST endpoint that returns StreamingResponse
    - Handle CheckpointNotFoundException with 404
    - _Requirements: 2.1_
    - _Implemented in: backend/src/presentation/routes.py_

- [x] 3. Checkpoint - Ensure backend tests pass
  - All 11 streaming-resume-stages tests pass
  - All backend tests pass

- [x] 4. Implement frontend streaming resume
  - [x] 4.1 Add `resumeConversationStream()` method to API service
    - Implement streaming fetch similar to sendMessageStream
    - Parse stage messages and invoke onStage callback
    - Parse and return interrupt/complete messages
    - _Requirements: 3.1, 3.2, 3.3_
    - _Implemented in: frontend/services/api.ts_
  - [x] 4.2 Write property test for stage callback invocation
    - **Property 5: Stage callback invocation**
    - **Validates: Requirements 3.2**
    - _Covered by: frontend/tests/api/api.test.ts_

- [x] 5. Update ViewModel to use streaming resume
  - [x] 5.1 Update `selectOption()` to use streaming resume
    - Replace apiService.resumeConversation with resumeConversationStream
    - Pass stage callback to update currentStageMessage
    - _Requirements: 1.1, 1.2, 3.4_
    - _Implemented in: frontend/viewmodels/useChatViewModel.ts_
  - [x] 5.2 Update `resumeConversation()` to use streaming resume
    - Replace apiService.resumeConversation with resumeConversationStream
    - Pass stage callback to update currentStageMessage
    - _Requirements: 1.1, 1.2, 3.4_
    - _Implemented in: frontend/viewmodels/useChatViewModel.ts_
  - [x] 5.3 Update `submitMultipleAnswers()` to use streaming resume
    - Replace apiService.resumeConversation with resumeConversationStream
    - Pass stage callback to update currentStageMessage
    - _Requirements: 1.1, 1.2, 3.4_
    - _Implemented in: frontend/viewmodels/useChatViewModel.ts_
  - [x] 5.4 Write property test for UI state updates
    - **Property 1: Stage messages update UI state**
    - **Validates: Requirements 1.1, 1.2**
    - _Covered by: frontend/tests/viewmodel/useChatViewModel.test.ts_

- [x] 6. Final Checkpoint - Ensure all tests pass
  - All 11 streaming-resume-stages backend tests pass
  - All frontend tests pass
