# Implementation Plan

- [x] 1. Update RefinementQuestion model with question_useful field





  - Add `question_useful: bool = Field(default=True, ...)` to RefinementQuestion class
  - Update the field description to explain its purpose
  - _Requirements: 8.1, 8.2_

- [x] 1.1 Write property test for RefinementQuestion validation


  - **Property 6: All fields populated when question is useful**
  - **Validates: Requirements 3.5, 8.4**

- [x] 1.2 Write property test for purpose field when question not useful


  - **Property 5: Purpose field populated when question not useful**
  - **Validates: Requirements 3.4, 8.3**

- [x] 2. Update DDX_GENERATOR_PROMPT for top-three focus





  - Modify prompt to emphasize analysis of top 3 conditions
  - Add instruction to include explicit probability gap analysis
  - Add instruction to note when top diagnosis clearly stands out
  - _Requirements: 1.1, 1.2, 2.4_


- [x] 3. Update REFINEMENT_QUESTION_PROMPT with three-step reasoning




  - Add Step 1: Probability Gap Analysis instructions
  - Add Step 2: Question Utility Analysis instructions (can history help vs need tests)
  - Add Step 3: Maximum discrimination question selection instructions
  - Add instruction to set `question_useful: false` when tests/imaging needed
  - Add instruction to explain what would help in purpose field when question not useful
  - _Requirements: 2.1, 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4_

- [x] 4. Update FINAL_SUMMARY_PROMPT for uncertainty acknowledgment





  - Add instruction to acknowledge when diagnoses remain close
  - Add instruction to include test/imaging recommendations when identified
  - Add instruction to present confidence appropriately based on gap analysis
  - _Requirements: 6.1, 6.2, 6.3_


- [x] 5. Update should_continue_refinement routing function




  - Add check for `question_useful` flag (return "end" if False)
  - Update probability gap check to use 15% threshold
  - Maintain existing max iterations check
  - Handle edge cases (None question, single diagnosis)
  - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 5.1 Write property test for routing with question_useful=False


  - **Property 2: Question utility flag triggers routing to end**
  - **Validates: Requirements 3.3, 5.1**

- [x] 5.2 Write property test for routing with probability gap > 15%

  - **Property 1: Probability gap triggers routing to end**
  - **Validates: Requirements 2.2, 2.3, 5.2**


- [x] 5.3 Write property test for routing with max iterations
  - **Property 3: Max iterations triggers routing to end**
  - **Validates: Requirements 5.3**


- [x] 5.4 Write property test for routing continue condition
  - **Property 4: Continue when no stop conditions met**
  - **Validates: Requirements 5.4**

- [x] 6. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.


- [x] 7. Write property test for DifferentialDiagnosis probabilities




  - **Property 7: All diagnoses have probability values**
  - **Validates: Requirements 1.2**


- [x] 8. Write property test for FinalSummary disclaimer




  - **Property 8: Final summary includes disclaimer**
  - **Validates: Requirements 6.4**


- [x] 9. Final Checkpoint - Ensure all tests pass




  - Ensure all tests pass, ask the user if questions arise.
