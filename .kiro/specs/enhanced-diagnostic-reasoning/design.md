# Design Document: Enhanced Diagnostic Reasoning

## Overview

This design enhances the SymptomCheckerProvider's diagnostic reasoning flow by introducing comparative reasoning about top diagnoses, explicit probability gap analysis, and intelligent assessment of whether additional questions can improve diagnostic confidence.

The key insight is that this enhanced flow can be achieved through **prompt modifications and minimal schema changes** without altering the graph structure, adding new nodes, or changing APIs.

## Architecture

The existing LangGraph workflow remains unchanged:

```
START → generate_questions → collect_answers → generate_ddx
      → generate_refinement_question → (conditional) → collect_refinement_answer 
      → refine_ddx → generate_refinement_question (loop) OR generate_final_summary → END
```

The enhancement is achieved by:
1. Modifying prompts to include gap analysis and question utility reasoning
2. Adding one boolean field to `RefinementQuestion` model
3. Updating the routing function to check the new field

## Components and Interfaces

### Modified Components

| Component | File | Change Type |
|-----------|------|-------------|
| `DDX_GENERATOR_PROMPT` | `symptom_checker_graph.py` | Prompt modification |
| `REFINEMENT_QUESTION_PROMPT` | `symptom_checker_graph.py` | Prompt modification |
| `FINAL_SUMMARY_PROMPT` | `symptom_checker_graph.py` | Prompt modification |
| `RefinementQuestion` | `symptom_checker_models.py` | Add `question_useful` field |
| `should_continue_refinement` | `symptom_checker_graph.py` | Logic update |

### Unchanged Components

- All graph nodes (no additions or removals)
- State schema (`SymptomCheckerState`)
- Provider class (`SymptomCheckerProvider`)
- API routes and DTOs
- Frontend components

## Data Models

### RefinementQuestion Model (Modified)

```python
class RefinementQuestion(BaseModel):
    """A follow-up question to narrow down the differential diagnosis.
    
    Enhanced to include question utility assessment for the comparative
    reasoning flow.
    """
    question: str = Field(
        description="The refinement question text. Must be exactly one question targeting differentiation between top conditions."
    )
    purpose: str = Field(
        description="Why this question helps narrow down the diagnosis, OR if question_useful is False, what would help (tests, imaging, etc.)."
    )
    options: list[str] = Field(
        description="2-4 contextually relevant answer options for the patient to choose from.",
        min_length=2,
        max_length=4
    )
    question_useful: bool = Field(
        default=True,
        description="Whether a history question can meaningfully differentiate between the top diagnoses. Set to False when tests/imaging are needed."
    )
```

### Existing Models (Unchanged)

- `DifferentialDiagnosis` - Already supports probability values
- `FinalSummary` - Already includes disclaimer field
- `SymptomCheckerState` - No changes needed

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Probability gap triggers routing to end
*For any* graph state where the top diagnosis probability exceeds the second diagnosis probability by more than 15 percentage points, the routing function should return "end"
**Validates: Requirements 2.2, 2.3, 5.2**

### Property 2: Question utility flag triggers routing to end
*For any* graph state where `current_refinement_question.question_useful` is `False`, the routing function should return "end"
**Validates: Requirements 3.3, 5.1**

### Property 3: Max iterations triggers routing to end
*For any* graph state where `refinement_count` is greater than or equal to 5, the routing function should return "end"
**Validates: Requirements 5.3**

### Property 4: Continue when no stop conditions met
*For any* graph state where probability gap ≤ 15%, `question_useful` is `True`, and `refinement_count` < 5, the routing function should return "continue"
**Validates: Requirements 5.4**

### Property 5: Purpose field populated when question not useful
*For any* `RefinementQuestion` where `question_useful` is `False`, the `purpose` field should be non-empty
**Validates: Requirements 3.4, 8.3**

### Property 6: All fields populated when question is useful
*For any* `RefinementQuestion` where `question_useful` is `True`, the `question` field should be non-empty and `options` should have at least 2 items
**Validates: Requirements 3.5, 8.4**

### Property 7: All diagnoses have probability values
*For any* `DifferentialDiagnosis`, every diagnosis in the `differential` list should have a probability value between 0.0 and 1.0
**Validates: Requirements 1.2**

### Property 8: Final summary includes disclaimer
*For any* `FinalSummary`, the `disclaimer` field should be non-empty
**Validates: Requirements 6.4**

## Error Handling

### Edge Cases

| Scenario | Handling |
|----------|----------|
| DDX has fewer than 3 conditions | Analyze all available conditions |
| DDX has only 1 condition | Skip gap analysis, proceed to final summary |
| All top conditions have equal probability | LLM determines if question can help |
| `question_useful` is False but options provided | Routing still respects `question_useful` flag |

### Validation

- Pydantic validation ensures `RefinementQuestion.options` has 2-4 items when `question_useful` is True
- Routing function handles None/missing `current_refinement_question` gracefully
- Probability values are constrained to [0.0, 1.0] by Pydantic

## Testing Strategy

### Property-Based Testing

The implementation will use **Hypothesis** (Python's property-based testing library) to verify correctness properties.

Each property-based test will:
- Run a minimum of 100 iterations
- Be tagged with the format: `**Feature: enhanced-diagnostic-reasoning, Property {number}: {property_text}**`
- Generate random valid inputs within the domain constraints

### Unit Tests

Unit tests will cover:
- Routing function behavior with various state combinations
- Model validation for `RefinementQuestion` with new field
- Prompt template rendering (verify prompts contain expected instructions)

### Integration Tests (Optional)

- End-to-end flow with mocked LLM responses
- Verify interrupt/resume behavior unchanged

## Implementation Details

### DDX_GENERATOR_PROMPT Changes

Add instructions to:
1. Focus analysis on top 3 conditions
2. Include explicit probability gap analysis
3. Note when top diagnosis clearly stands out

### REFINEMENT_QUESTION_PROMPT Changes

Add three-step reasoning process:
1. **Probability Gap Analysis**: Analyze if top diagnosis stands out
2. **Question Utility Analysis**: Determine if history question can help
3. **Question Selection**: If useful, select maximum-discrimination question

Include instruction to set `question_useful: false` when tests/imaging needed.

### FINAL_SUMMARY_PROMPT Changes

Add instructions to:
1. Acknowledge uncertainty when diagnoses remain close
2. Include recommendations for tests/imaging when identified
3. Maintain appropriate confidence based on gap analysis

### Routing Function Changes

```python
def should_continue_refinement(state: SymptomCheckerState) -> str:
    # Check max iterations (existing)
    if state.get("refinement_count", 0) >= 5:
        return "end"
    
    # NEW: Check if LLM determined no question is useful
    current_question = state.get("current_refinement_question")
    if current_question and not current_question.question_useful:
        return "end"
    
    # Check probability gap (enhanced)
    current_ddx = state.get("refined_ddx") or state.get("differential_diagnosis")
    if current_ddx and len(current_ddx.differential) >= 2:
        top = current_ddx.differential[0].probability
        second = current_ddx.differential[1].probability
        if top - second > 0.15:  # 15% gap threshold
            return "end"
    
    return "continue"
```

## Sequence Diagram

```
User                    Graph                           LLM
  |                       |                              |
  |-- Symptom ----------->|                              |
  |                       |-- generate_questions ------->|
  |                       |<-- PreliminaryQuestions -----|
  |<-- Questions ---------|                              |
  |-- Answers ----------->|                              |
  |                       |-- generate_ddx ------------->|
  |                       |<-- DDX (with gap analysis) --|
  |                       |                              |
  |                       |-- generate_refinement_q ---->|
  |                       |<-- RefinementQuestion -------|
  |                       |     (question_useful=T/F)    |
  |                       |                              |
  |                       |-- routing check -------------|
  |                       |   if question_useful=False   |
  |                       |   OR gap > 15%               |
  |                       |   → generate_final_summary   |
  |                       |   else → collect_answer      |
  |                       |                              |
```
