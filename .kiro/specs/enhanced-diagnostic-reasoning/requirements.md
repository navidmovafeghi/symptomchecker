# Requirements Document

## Introduction

This specification defines enhancements to the SymptomCheckerProvider's diagnostic reasoning flow. The current system uses simple probability thresholds to determine when to stop asking refinement questions. The enhanced system introduces comparative reasoning about the top diagnoses, explicit gap analysis, and intelligent determination of whether additional questions can meaningfully improve diagnostic confidence.

The goal is to create a more clinically realistic diagnostic flow that:
1. Focuses reasoning on the top 3 most likely diagnoses
2. Explicitly analyzes probability gaps between candidates
3. Recognizes when history questions cannot further differentiate (e.g., when tests/imaging are needed)
4. Selects refinement questions that maximize diagnostic separation

## Glossary

- **Differential Diagnosis (DDX)**: A ranked list of possible medical conditions with associated probabilities
- **Top Three**: The three most likely diagnoses from the differential diagnosis
- **Probability Gap**: The difference in probability between adjacent diagnoses in the ranked list
- **Discriminating Question**: A question whose answer would maximally increase the probability distance between the top diagnosis and alternatives
- **Question Utility**: Whether a history-based question can meaningfully change the probability distribution
- **Sentinel Value**: A special value (e.g., "NO_QUESTION_NEEDED") used to signal a decision through data rather than control flow

## Requirements

### Requirement 1: Top Three Focus in Differential Diagnosis

**User Story:** As a medical triage system, I want to focus diagnostic reasoning on the top 3 most likely conditions, so that the analysis remains focused and clinically relevant.

#### Acceptance Criteria

1. WHEN the system generates a differential diagnosis THEN the System SHALL emphasize the top 3 most likely conditions in its analysis
2. WHEN presenting the differential diagnosis THEN the System SHALL include explicit probability values for at least the top 3 conditions
3. WHEN the differential diagnosis contains fewer than 3 conditions THEN the System SHALL analyze all available conditions

### Requirement 2: Probability Gap Analysis

**User Story:** As a medical triage system, I want to analyze the probability gaps between top diagnoses, so that I can determine if the leading diagnosis clearly stands out.

#### Acceptance Criteria

1. WHEN generating a refinement question THEN the System SHALL first analyze the probability gap between the top diagnosis and the second most likely diagnosis
2. WHEN the top diagnosis probability exceeds the second by more than 15 percentage points THEN the System SHALL consider the top diagnosis as "standing out"
3. WHEN the top diagnosis stands out THEN the System SHALL proceed to final summary without asking additional questions
4. WHEN analyzing probability gaps THEN the System SHALL include explicit reasoning about whether the gaps are clinically significant

### Requirement 3: Question Utility Assessment

**User Story:** As a medical triage system, I want to assess whether a history question can help differentiate between close diagnoses, so that I avoid asking unhelpful questions when tests or imaging are needed.

#### Acceptance Criteria

1. WHEN the top diagnoses are close in probability THEN the System SHALL reason about whether a history question can meaningfully differentiate them
2. WHEN conditions can only be distinguished by tests, imaging, or physical examination THEN the System SHALL indicate that no further questions are useful
3. WHEN no question is useful THEN the System SHALL set the `question_useful` field to `False` in the RefinementQuestion output
4. WHEN no question is useful THEN the System SHALL explain in the purpose field what would help differentiate (e.g., "Blood test needed to distinguish bacterial vs viral infection")
5. WHEN a question can help differentiate THEN the System SHALL set `question_useful` to `True` and generate the question

### Requirement 4: Maximum Discrimination Question Selection

**User Story:** As a medical triage system, I want to select refinement questions that maximize the probability distance toward the top diagnosis, so that each question provides maximum diagnostic value.

#### Acceptance Criteria

1. WHEN generating a refinement question THEN the System SHALL select the question whose answer would create the maximum probability separation
2. WHEN generating a refinement question THEN the System SHALL explain which conditions the question differentiates between
3. WHEN generating a refinement question THEN the System SHALL describe how each answer option would shift the probabilities
4. WHEN multiple questions could help THEN the System SHALL select the one with highest expected information gain

### Requirement 5: Enhanced Routing Logic

**User Story:** As a medical triage system, I want the routing logic to respect the LLM's assessment of question utility, so that the system stops appropriately when questions cannot help.

#### Acceptance Criteria

1. WHEN the refinement question has `question_useful` set to `False` THEN the System SHALL route to the final summary node
2. WHEN the probability gap analysis indicates the top diagnosis stands out THEN the System SHALL route to the final summary node
3. WHEN the maximum refinement iterations (5) are reached THEN the System SHALL route to the final summary node
4. WHEN none of the stop conditions are met THEN the System SHALL continue the refinement loop

### Requirement 6: Final Summary with Uncertainty Acknowledgment

**User Story:** As a patient, I want the final summary to acknowledge when diagnoses are close and explain what would help clarify, so that I understand the limitations of history-based assessment.

#### Acceptance Criteria

1. WHEN the final summary is generated after "NO_QUESTION_NEEDED" THEN the System SHALL acknowledge that multiple conditions remain similarly likely
2. WHEN tests or imaging were identified as needed THEN the System SHALL include this recommendation in the final summary
3. WHEN the top diagnosis clearly stands out THEN the System SHALL present it with appropriate confidence
4. WHEN presenting the final summary THEN the System SHALL always include the medical disclaimer

### Requirement 7: Backward Compatibility

**User Story:** As a system maintainer, I want the enhanced flow to work within the existing graph structure, so that no API changes or frontend modifications are required.

#### Acceptance Criteria

1. WHEN implementing the enhanced flow THEN the System SHALL use only existing graph nodes without adding new ones
2. WHEN implementing the enhanced flow THEN the System SHALL maintain the existing state schema with minimal additions
3. WHEN implementing the enhanced flow THEN the System SHALL preserve all existing API contracts
4. WHEN implementing the enhanced flow THEN the System SHALL require no frontend code changes

### Requirement 8: Schema Enhancement for Question Utility

**User Story:** As a system developer, I want the RefinementQuestion model to explicitly indicate question utility, so that the routing logic can make clear decisions.

#### Acceptance Criteria

1. WHEN defining the RefinementQuestion model THEN the System SHALL include a `question_useful` boolean field with default value `True`
2. WHEN the LLM determines a question cannot help THEN the System SHALL set `question_useful` to `False`
3. WHEN `question_useful` is `False` THEN the System SHALL still populate the `purpose` field with explanation of what would help
4. WHEN `question_useful` is `True` THEN the System SHALL populate all fields including question, options, and purpose
