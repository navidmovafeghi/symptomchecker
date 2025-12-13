# Implementation Plan

- [x] 1. Create GraphStateService module with core interfaces and types





  - [x] 1.1 Create graphStateService.ts with IGraphStateService interface and GraphState type


    - Define GraphState interface with currentStage, completedStages, waitingNodeId, stagesLiveData
    - Define INITIAL_GRAPH_STATE constant
    - Define GRAPH_NODE_ORDER array for completion tracking
    - Export IGraphStateService interface with all method signatures
    - _Requirements: 1.1, 12.1, 12.2_
  - [x] 1.2 Write property test for waiting node derivation


    - **Property 3: Waiting Node Derivation**
    - **Validates: Requirements 1.4, 4.1, 4.2**
  - [x] 1.3 Implement deriveWaitingNode method

    - Return 'collect_answers' when interrupt has questions array
    - Return 'collect_refinement_answer' when interrupt has single question
    - _Requirements: 4.1, 4.2_
  - [x] 1.4 Write property test for stage completion tracking


    - **Property 8: Stage Completion Tracking**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
  - [x] 1.5 Implement processStageEvent method

    - Mark previous stage as completed when transitioning
    - Update currentStage and stagesLiveData atomically
    - _Requirements: 1.3, 5.1, 9.2_
  - [x] 1.6 Implement processInterruptEvent method

    - Mark all nodes up to waiting node as completed
    - Set waitingNodeId based on interrupt type
    - _Requirements: 5.2_
  - [x] 1.7 Implement processCompleteEvent method

    - Mark all nodes including generate_final_summary as completed
    - Clear currentStage and waitingNodeId
    - _Requirements: 5.3_
  - [x] 1.8 Implement resetState method

    - Return INITIAL_GRAPH_STATE
    - _Requirements: 3.5, 10.2_

- [x] 2. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Extend storage schema for graph state persistence





  - [x] 3.1 Update StoredConversation type in types.ts


    - Add optional graph_state field with completed_stages, waiting_node_id, stages_live_data
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 3.2 Write property test for graph state persistence round-trip


    - **Property 6: Graph State Persistence Round-Trip**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 4.3, 4.4**
  - [x] 3.3 Update saveConversation in indexedDBStorage.ts


    - Include graph_state when saving conversations
    - _Requirements: 3.1, 3.2, 3.3, 4.3, 5.4_

  - [x] 3.4 Update getConversation in indexedDBStorage.ts

    - Return graph_state when loading conversations
    - _Requirements: 3.4, 4.4_
  - [x] 3.5 Write property test for backward compatibility migration


    - **Property 9: Backward Compatibility Migration**
    - **Validates: Requirements 8.1, 8.2, 8.3**
  - [x] 3.6 Implement deriveCompletedStagesFromMessages in GraphStateService


    - Derive completed stages from conversation message patterns
    - _Requirements: 8.1_
  - [x] 3.7 Implement migration logic for conversations without graph_state


    - Derive completedStages from messages
    - Derive waitingNodeId from is_interrupted flag
    - _Requirements: 8.1, 8.2, 8.3_

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Integrate GraphStateService with ViewModel







  - [x] 5.1 Add graphState to Zustand store in useChatViewModel.ts


    - Add graphState: GraphState field initialized to INITIAL_GRAPH_STATE
    - Add updateGraphState action for atomic updates
    - _Requirements: 1.1, 1.2_

  - [x] 5.2 Write property test for atomic state updates

    - **Property 2: Atomic State Updates**
    - **Validates: Requirements 1.3, 9.2**
  - [x] 5.3 Update stage callback in sendMessage to use GraphStateService


    - Call graphStateService.processStageEvent on stage events
    - Update Zustand store atomically
    - _Requirements: 1.3, 5.1_

  - [x] 5.4 Update interrupt handling to use GraphStateService

    - Call graphStateService.processInterruptEvent on interrupts
    - Derive and set waitingNodeId
    - _Requirements: 1.4, 4.1, 4.2, 5.2_

  - [x] 5.5 Update complete handling to use GraphStateService

    - Call graphStateService.processCompleteEvent on completion
    - _Requirements: 5.3_

  - [x] 5.6 Update selectConversation to restore graph state






    - Load graph_state from storage
    - Apply migration if graph_state is missing
    - Update Zustand store with restored state
    - _Requirements: 3.4, 4.4, 8.1, 8.2_
  - [x] 5.7 Write property test for graph state reset


    - **Property 7: Graph State Reset**
    - **Validates: Requirements 3.5, 10.1, 10.2**
  - [x] 5.8 Update newConversation to reset graph state

    - Call graphStateService.resetState()
    - _Requirements: 3.5, 10.2_
  - [x] 5.9 Update deleteConversation to clear graph state if active


    - Reset graph state when deleting active conversation
    - _Requirements: 10.3_
  - [x] 5.10 Write property test for sequential stage processing


    - **Property 10: Sequential Stage Processing**
    - **Validates: Requirements 9.1**


- [x] 6. Checkpoint - Ensure all tests pass




  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Fix backend stage event consistency





  - [x] 7.1 Write property test for backend stage name consistency


    - **Property 4: Backend Stage Name Consistency**
    - **Validates: Requirements 2.1, 2.2, 2.3, 11.1**
  - [x] 7.2 Update resume_stream in symptom_checker_provider.py


    - Remove "processing" pseudo-stage from initial yield
    - Use actual node name from first event instead
    - _Requirements: 2.2_
  - [x] 7.3 Write property test for refinement count in stage data


    - **Property 5: Refinement Count in Stage Data**
    - **Validates: Requirements 2.4, 6.1, 6.2**
  - [x] 7.4 Ensure refinement_round is included in stage data


    - Add refinement_round to collect_refinement_answer and refine_ddx stage events
    - _Requirements: 2.4_


- [x] 8. Update GraphVisualization component




  - [x] 8.1 Update GraphVisualization to read from Zustand store


    - Use Zustand selectors for graphState
    - Remove any local React state for graph data
    - _Requirements: 1.2_


  - [x] 8.2 Write property test for direct stage mapping
    - **Property 11: Direct Stage Mapping**
    - **Validates: Requirements 11.2, 11.3**
  - [x] 8.3 Update stage mapping to use stage field directly


    - Remove reverse lookup from message to stage
    - Use stage field as GraphNodeId directly
    - _Requirements: 11.2, 11.3_

  - [x] 8.4 Display refinement iteration number in UI

    - Show "Round X of 5" when in refinement loop
    - Indicate final round when iteration is 5
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 8.5 Remove debug console.log statements

    - Remove all console.log calls from GraphVisualization
    - Keep error logging with appropriate sanitization
    - _Requirements: 7.1, 7.2, 7.3_


- [x] 9. Checkpoint - Ensure all tests pass




  - Ensure all tests pass, ask the user if questions arise.



- [x] 10. Update ChatPage to use Zustand graph state



  - [x] 10.1 Remove local graph state from ChatPage


    - Remove useState for currentStage, completedStages, etc.
    - Use Zustand selectors instead
    - _Requirements: 1.2_
  - [x] 10.2 Update GraphVisualization props to use Zustand state


    - Pass graphState from Zustand to GraphVisualization
    - _Requirements: 1.1, 1.2_
  - [x] 10.3 Write property test for conversation delete cleanup


    - **Property 12: Conversation Delete Cleanup**
    - **Validates: Requirements 10.3**


- [x] 11. Final Checkpoint - Ensure all tests pass




  - Ensure all tests pass, ask the user if questions arise.


- [x] 12. Create implementation summary documentation





  - [x] 12.1 Create CHANGELOG.md documenting the graph visualization fixes

    - Document all changes made to frontend and backend
    - List new files created (graphStateService.ts)
    - List modified files and what changed
    - Include migration notes for existing conversations
    - _Requirements: All_
