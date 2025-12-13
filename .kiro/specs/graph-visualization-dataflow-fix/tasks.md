# Implementation Plan

- [x] 1. Fix backend stage messages






  - [x] 1.1 Add distinct stage message for collect_refinement_answer

    - Update `stage_descriptions_en` in `symptom_checker_provider.py` to use "Collecting your response" for `collect_refinement_answer`
    - Update `stage_descriptions_fa` to use "در حال دریافت پاسخ شما" for `collect_refinement_answer`
    - Ensure `generate_refinement_question` keeps its existing message "Preparing follow-up question"
    - _Requirements: 2.1_
  - [x] 1.2 Write property test for stage message uniqueness


    - **Property 1: Stage message mapping uniqueness**
    - **Validates: Requirements 2.2**

- [x] 2. Fix frontend stage-to-node mapping





  - [x] 2.1 Update graphHelpers.ts with correct mappings


    - Add mapping for "Collecting your response" → `collect_refinement_answer`
    - Add mapping for "در حال دریافت پاسخ شما" → `collect_refinement_answer`
    - Verify existing mappings are correct and unambiguous
    - _Requirements: 1.1, 2.2_

  - [x] 2.2 Write property test for collect_refinement_answer mapping

    - **Property 2: collect_refinement_answer mapping correctness**
    - **Validates: Requirements 1.1**

  - [x] 2.3 Write property test for unknown stage handling





    - **Property 3: Unknown stage graceful handling**
    - **Validates: Requirements 2.3**

- [x] 3. Checkpoint - Ensure mapping tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Fix state reset in ViewModel






  - [x] 4.1 Clear stagesLiveData in newConversation

    - Update `newConversation()` in `useChatViewModel.ts` to reset `stagesLiveData` to empty object
    - Also reset `currentStage`, `currentStageMessage`, `currentStageData` to null
    - _Requirements: 3.1, 3.2_

  - [x] 4.2 Clear stagesLiveData in selectConversation

    - Update `selectConversation()` in `useChatViewModel.ts` to reset `stagesLiveData` to empty object
    - Ensure live data from previous conversation doesn't persist
    - _Requirements: 3.3_

  - [x] 4.3 Write property test for new conversation state reset

    - **Property 4: New conversation clears live data**
    - **Validates: Requirements 3.1, 3.2**

- [x] 5. Fix completed stages tracking in ChatPage





  - [x] 5.1 Fix stage transition to mark previous as completed


    - Update the `useEffect` in `ChatPage.tsx` that tracks `currentStageMessage`
    - Ensure when stage changes from A to B (including B being null), A is added to completedStages
    - Handle the case where currentStageMessage becomes null at end of processing
    - _Requirements: 4.1, 5.1_

  - [x] 5.2 Add loading end completion tracking

    - Add new `useEffect` that watches `isLoading` state
    - When `isLoading` transitions from true to false and there was an active stage, mark it completed
    - _Requirements: 4.3_

  - [x] 5.3 Write property test for stage transition completion

    - **Property 5: Stage transition marks previous as completed**
    - **Validates: Requirements 4.1, 5.1**

  - [x] 5.4 Write property test for loading end completion

    - **Property 6: Loading end marks last stage completed**
    - **Validates: Requirements 4.3**

- [x] 6. Update Persian localization

  - [x] 6.1 Add Persian translation for new stage message


    - Add "در حال دریافت پاسخ شما" to `fa.json` if needed for UI display
    - Verify all graph-related Persian translations are consistent
    - _Requirements: 2.1_

- [x] 7. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
