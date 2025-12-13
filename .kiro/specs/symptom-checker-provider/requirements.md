# Requirements Document

## Introduction

This feature replaces the current `MedicalChatbotV2Provider` with a new `SymptomCheckerProvider` based on the `simple_graph.py` LangGraph workflow. The new provider implements a more sophisticated medical triage system with structured screening questions, differential diagnosis generation, and an iterative refinement loop that continues until a confident diagnosis is reached or safety limits are met.

## Glossary

- **Symptom_Checker_System**: The new LangGraph-based medical chatbot provider that generates screening questions, collects answers, and produces differential diagnoses
- **Differential_Diagnosis (DDX)**: A ranked list of possible medical conditions with probabilities, reasoning, and severity classifications
- **Refinement_Loop**: An iterative process where additional questions are asked to narrow down the differential diagnosis
- **Human_In_The_Loop (HITL)**: A workflow pattern where execution pauses to collect user input via LangGraph's `interrupt()` mechanism
- **Preliminary_Questions**: Initial screening questions generated based on the patient's reported symptoms
- **Severity_Classification**: A categorization of conditions as "life_threatening", "serious", "moderate", or "mild"
- **QA_Pair**: A structured object containing a question and its corresponding answer

## Requirements

### Requirement 1

**User Story:** As a patient, I want to describe my symptoms and receive relevant screening questions, so that the system can gather enough information for an accurate assessment.

#### Acceptance Criteria

1. WHEN a user submits a symptom description THEN the Symptom_Checker_System SHALL generate 3-5 preliminary screening questions relevant to the reported symptoms
2. WHEN generating preliminary questions THEN the Symptom_Checker_System SHALL ensure each question is exactly one question without combining multiple questions
3. WHEN preliminary questions are generated THEN the Symptom_Checker_System SHALL include a purpose field explaining why each question helps with diagnosis
4. WHEN generating a question THEN the Symptom_Checker_System SHALL include 2-4 predefined answer options relevant to the question context
5. WHEN the user provides answers THEN the Symptom_Checker_System SHALL accept both option selection and free-text input

### Requirement 2

**User Story:** As a patient, I want to receive a differential diagnosis based on my symptoms and answers, so that I can understand possible conditions and their likelihood.

#### Acceptance Criteria

1. WHEN the Symptom_Checker_System has collected answers to preliminary questions THEN the Symptom_Checker_System SHALL generate a differential diagnosis with ranked conditions
2. WHEN generating a differential diagnosis THEN the Symptom_Checker_System SHALL include probability (0.0 to 1.0), reasoning, and severity classification for each condition
3. WHEN classifying severity THEN the Symptom_Checker_System SHALL use exactly one of: "life_threatening", "serious", "moderate", or "mild"
4. WHEN generating a differential diagnosis THEN the Symptom_Checker_System SHALL include a medical disclaimer stating the information is for educational purposes only

### Requirement 3

**User Story:** As a patient, I want the system to ask follow-up questions to refine the diagnosis, so that I can receive a more accurate assessment.

#### Acceptance Criteria

1. WHEN the initial differential diagnosis is generated THEN the Symptom_Checker_System SHALL generate a refinement question to narrow down the diagnosis
2. WHEN generating a refinement question THEN the Symptom_Checker_System SHALL ensure the question is exactly one question targeting differentiation between top conditions
3. WHEN the user answers a refinement question THEN the Symptom_Checker_System SHALL update the differential diagnosis based on the new information
4. WHILE the refinement loop is active THEN the Symptom_Checker_System SHALL continue asking refinement questions until stop conditions are met

### Requirement 4

**User Story:** As a patient, I want the refinement process to stop when a confident diagnosis is reached, so that I don't answer unnecessary questions.

#### Acceptance Criteria

1. WHEN the sum of life-threatening condition probabilities falls below 10% AND the top diagnosis probability exceeds 50% THEN the Symptom_Checker_System SHALL stop the refinement loop
2. WHEN the refinement loop reaches 5 iterations THEN the Symptom_Checker_System SHALL stop the refinement loop regardless of confidence levels
3. WHEN the refinement loop stops THEN the Symptom_Checker_System SHALL generate a final summary with the top diagnosis, probability, and patient-friendly explanation

### Requirement 5

**User Story:** As a developer, I want the new provider to implement the existing ILLMProvider interface, so that it integrates seamlessly with the current application architecture.

#### Acceptance Criteria

1. WHEN the Symptom_Checker_System is initialized THEN the Symptom_Checker_System SHALL implement the ILLMProvider interface methods: generate_response, generate_response_stream
2. WHEN the workflow reaches an interrupt point THEN the Symptom_Checker_System SHALL encode questions using the existing __OPTIONS__ delimiter format for frontend compatibility
3. WHEN the workflow completes THEN the Symptom_Checker_System SHALL return the final summary as the response content
4. WHEN checkpointing is required THEN the Symptom_Checker_System SHALL use SQLite-based checkpointing for workflow state persistence

### Requirement 6

**User Story:** As a developer, I want the provider to use structured outputs for all LLM calls, so that responses are predictable and type-safe.

#### Acceptance Criteria

1. WHEN generating preliminary questions THEN the Symptom_Checker_System SHALL use Pydantic models with structured output binding
2. WHEN generating differential diagnosis THEN the Symptom_Checker_System SHALL use Pydantic models with structured output binding
3. WHEN extracting answers from free-text THEN the Symptom_Checker_System SHALL use Pydantic models with structured output binding
4. WHEN generating refinement questions THEN the Symptom_Checker_System SHALL use Pydantic models with structured output binding
5. WHEN generating final summary THEN the Symptom_Checker_System SHALL use Pydantic models with structured output binding

### Requirement 7

**User Story:** As a patient, I want to be able to resume an interrupted conversation, so that I can continue from where I left off.

#### Acceptance Criteria

1. WHEN a conversation is interrupted for user input THEN the Symptom_Checker_System SHALL save the workflow state to the checkpoint database
2. WHEN a user provides input to resume THEN the Symptom_Checker_System SHALL load the checkpoint and continue execution from the interrupt point
3. WHEN resuming a conversation THEN the Symptom_Checker_System SHALL preserve all previously collected QA_Pairs and differential diagnosis state
