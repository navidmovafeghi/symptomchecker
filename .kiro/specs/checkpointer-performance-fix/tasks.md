# Implementation Plan

- [x] 1. Refactor build_symptom_checker_graph to accept checkpointer as parameter
  - [x] 1.1 Modify function signature to accept optional checkpointer parameter
    - Remove checkpointer creation from the function
    - Accept checkpointer as a parameter instead of checkpoint_db_path
    - Return only the compiled graph (not a tuple)
    - _Requirements: 2.1, 2.3_
  - [x] 1.2 Update function to compile graph with provided checkpointer
    - Pass checkpointer to builder.compile()
    - _Requirements: 2.3, 3.1_

- [x] 2. Implement lazy initialization in SymptomCheckerProvider
  - [x] 2.1 Add instance variables for lazy initialization state
    - Add _graph, _checkpointer, _initialized, _lock attributes
    - Initialize them to None/False in __init__
    - _Requirements: 1.1, 3.1_
  - [x] 2.2 Implement _ensure_initialized async method
    - Check if already initialized (fast path)
    - Use asyncio.Lock for thread-safe initialization
    - Create AsyncSqliteSaver and call __aenter__
    - Build and compile graph with the checkpointer
    - Set _initialized to True
    - _Requirements: 1.1, 2.1, 2.2, 2.3_
  - [x] 2.3 Implement cleanup async method
    - Call __aexit__ on checkpointer if initialized
    - Reset state variables
    - _Requirements: 1.3_
  - [x] 2.4 Write property test for connection reuse
    - **Property 1: Connection reuse across requests**
    - **Validates: Requirements 1.1, 1.2, 2.3**
  - [x] 2.5 Write property test for graph instance reuse
    - **Property 2: Graph instance reuse**
    - **Validates: Requirements 3.1, 3.2**

- [x] 3. Update provider methods to use lazy initialization





  - [x] 3.1 Update generate_response_stream to call _ensure_initialized


    - Add await self._ensure_initialized() at start
    - Use self._graph instead of building new graph
    - _Requirements: 1.2, 3.2_

  - [x] 3.2 Update resume method to call _ensure_initialized

    - Add await self._ensure_initialized() at start
    - Use self._graph for resume operations
    - _Requirements: 1.2, 3.2, 4.2_
  - [x] 3.3 Update delete_checkpoint to use initialized checkpointer


    - Add await self._ensure_initialized() at start
    - Use self._checkpointer for deletion
    - _Requirements: 4.3_
  - [x] 3.4 Write property test for functional correctness






    - **Property 3: Functional correctness after reuse**
    - **Validates: Requirements 3.3, 4.1**

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integration and cleanup






  - [x] 5.1 Add cleanup hook to FastAPI application lifecycle

    - Register cleanup method with app shutdown event
    - Ensure proper resource cleanup on server stop
    - _Requirements: 1.3_

  - [x] 5.2 Verify existing tests still pass

    - Run full test suite
    - Fix any regressions
    - _Requirements: 4.4_

- [x] 6. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

