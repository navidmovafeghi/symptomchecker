# Implementation Plan

- [x] 1. Create Pydantic models for structured outputs





  - [x] 1.1 Create Question model with question, purpose, and options fields


    - Define Field descriptions for LLM guidance
    - Options field should specify "2-4 contextually relevant answer options"
    - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - [x] 1.2 Create PreliminaryQuestions model containing list of Question

    - _Requirements: 1.1_
  - [x] 1.3 Create Diagnosis model with condition, probability, reasoning, severity

    - Severity should be Literal type with valid values
    - _Requirements: 2.2, 2.3_

  - [x] 1.4 Create DifferentialDiagnosis model with differential list and disclaimer

    - _Requirements: 2.1, 2.4_
  - [x] 1.5 Create QAPair and ExtractedAnswers models for answer extraction

    - _Requirements: 1.5_


  - [x] 1.6 Create RefinementQuestion model with question, purpose, and options

    - _Requirements: 3.1, 3.2_
  - [x] 1.7 Create FinalSummary model with top_diagnosis, probability, explanation, disclaimer

    - _Requirements: 4.3_
  - [x] 1.8 Write property tests for Pydantic model validation


    - **Property 3: Question structure completeness**
    - **Property 5: DDX structure validity**
    - **Validates: Requirements 1.3, 1.4, 2.2, 2.3**

- [x] 2. Implement graph state and node functions





  - [x] 2.1 Define SymptomCheckerState TypedDict with all state fields
    - Include messages, symptom_input, preliminary_questions, qa_pairs, differential_diagnosis

    - Include refinement_qa_pairs, current_refinement_question, refined_ddx, refinement_count, final_summary
    - _Requirements: 7.3_
  - [x] 2.2 Implement generate_questions node function

    - Extract symptom from last user message
    - Use structured output to generate PreliminaryQuestions
    - _Requirements: 1.1, 1.2, 1.3, 1.4_


  - [x] 2.3 Write property test for question generation
    - **Property 1: Question count bounds**


    - **Property 2: Single question validation**
    - **Validates: Requirements 1.1, 1.2**
  - [x] 2.4 Implement collect_answers node function with interrupt

    - Use LangGraph interrupt() to pause for user input
    - Ask questions one at a time with options
    - Store QA pairs in state
    - _Requirements: 1.5, 5.2_
  - [x] 2.5 Implement generate_ddx node function
    - Build context from symptom and QA pairs
    - Use structured output to generate DifferentialDiagnosis
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [x] 2.6 Write property test for DDX generation



    - **Property 6: DDX ranking order**
    - **Property 7: DDX disclaimer presence**
    - **Validates: Requirements 2.1, 2.4**

- [x] 3. Implement refinement loop nodes



  - [x] 3.1 Implement generate_refinement_question node function


    - Build context from all QA pairs and current DDX
    - Use structured output to generate RefinementQuestion with options
    - _Requirements: 3.1, 3.2_
  - [x] 3.2 Implement collect_refinement_answer node function with interrupt

    - Use interrupt() to pause for user input
    - Append to refinement_qa_pairs
    - _Requirements: 3.3_

  - [x] 3.3 Implement refine_ddx node function
    - Update DDX based on new QA pair
    - Increment refinement_count

    - _Requirements: 3.3, 3.4_
  - [x] 3.4 Implement should_continue_refinement routing function
    - Check life-threatening probability sum < 0.10
    - Check top diagnosis probability > 0.50
    - Check refinement_count < 5
    - _Requirements: 4.1, 4.2_
  - [x] 3.5 Write property tests for refinement stop conditions


    - **Property 8: Refinement stop condition - confidence**
    - **Property 9: Refinement stop condition - max iterations**
    - **Validates: Requirements 4.1, 4.2**

  - [x] 3.6 Implement generate_final_summary node function
    - Use structured output to generate FinalSummary
    - _Requirements: 4.3_
  - [x] 3.7 Write property test for final summary



    - **Property 10: Final summary completeness**
    - **Validates: Requirements 4.3**

- [x] 4. Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Build and compile the LangGraph





  - [x] 5.1 Create graph builder with all nodes


    - Add generate_questions, collect_answers, generate_ddx nodes
    - Add generate_refinement_question, collect_refinement_answer, refine_ddx nodes
    - Add generate_final_summary node
    - _Requirements: 5.1_

  - [x] 5.2 Define graph edges and conditional routing

    - START → generate_questions → collect_answers → generate_ddx
    - generate_ddx → generate_refinement_question
    - Conditional edge from generate_refinement_question
    - collect_refinement_answer → refine_ddx → generate_refinement_question
    - generate_final_summary → END
    - _Requirements: 3.4, 4.1, 4.2_

  - [x] 5.3 Configure SQLite checkpointer for state persistence

    - Use SqliteSaver instead of InMemorySaver
    - _Requirements: 5.4, 7.1_

- [x] 6. Implement SymptomCheckerProvider class




  - [x] 6.1 Create provider class implementing ILLMProvider interface

    - Initialize with api_key and checkpoint_db_path
    - Set up model with structured output bindings
    - _Requirements: 5.1, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 6.2 Implement generate_response method
    - Invoke graph and return final summary content
    - _Requirements: 5.1, 5.3_

  - [x] 6.3 Implement generate_response_stream method
    - Handle interrupts and encode with __OPTIONS__ format
    - Yield response chunks
    - _Requirements: 5.1, 5.2_
  - [x] 6.4 Write property test for options encoding


    - **Property 11: Options encoding format**

    - **Validates: Requirements 5.2**
  - [x] 6.5 Implement resume method for interrupt handling
    - Load checkpoint and continue execution
    - Return interrupt or complete response
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 6.6 Write property test for checkpoint round-trip


    - **Property 12: Checkpoint round-trip preservation**
    - **Validates: Requirements 7.2, 7.3**

- [x] 7. Integrate with existing application





  - [x] 7.1 Update dependencies.py to use SymptomCheckerProvider


    - Replace MedicalChatbotV2Provider instantiation
    - Pass checkpoint_db_path configuration
    - _Requirements: 5.1_

  - [x] 7.2 Update config.py if new environment variables needed

    - _Requirements: 5.4_

  - [x] 7.3 Verify frontend compatibility with new interrupt format

    - Test __OPTIONS__ encoding works with existing frontend
    - _Requirements: 5.2_

- [x] 8. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
