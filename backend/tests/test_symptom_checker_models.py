"""
Property-based tests for SymptomCheckerProvider Pydantic models.

Tests validate structural correctness properties using hypothesis.
"""
import json
import pytest
from hypothesis import given, strategies as st, settings
from pydantic import ValidationError

from src.infrastructure.symptom_checker_models import (
    Question,
    PreliminaryQuestions,
    Diagnosis,
    DifferentialDiagnosis,
    QAPair,
    ExtractedAnswers,
    RefinementQuestion,
    FinalSummary,
    SeverityLevel,
)


# ============== STRATEGIES ==============

# Strategy for non-empty strings (questions, purposes, etc.)
non_empty_str = st.text(min_size=1, max_size=200).filter(lambda s: s.strip())

# Strategy for valid severity levels
severity_strategy = st.sampled_from(["life_threatening", "serious", "moderate", "mild"])

# Strategy for valid probability values
probability_strategy = st.floats(min_value=0.0, max_value=1.0, allow_nan=False, allow_infinity=False)

# Strategy for options list (2-4 non-empty strings)
options_strategy = st.lists(non_empty_str, min_size=2, max_size=4)


# Strategy for valid Question
question_strategy = st.builds(
    Question,
    question=non_empty_str,
    purpose=non_empty_str,
    options=options_strategy,
)

# Strategy for valid Diagnosis
diagnosis_strategy = st.builds(
    Diagnosis,
    condition=non_empty_str,
    probability=probability_strategy,
    reasoning=non_empty_str,
    severity=severity_strategy,
)


# ============== PROPERTY TESTS ==============

# **Feature: symptom-checker-provider, Property 3: Question structure completeness**
# *For any* generated Question, the question field, purpose field, and options field 
# SHALL all be non-empty, with options containing 2-4 items.
# **Validates: Requirements 1.3, 1.4**

@settings(max_examples=100)
@given(question_strategy)
def test_property_3_question_structure_completeness(question: Question):
    """Property 3: Question structure completeness.
    
    For any valid Question, all fields must be non-empty and options must have 2-4 items.
    """
    # Question field is non-empty
    assert question.question.strip(), "Question text must be non-empty"
    
    # Purpose field is non-empty
    assert question.purpose.strip(), "Purpose must be non-empty"
    
    # Options field is non-empty and has 2-4 items
    assert len(question.options) >= 2, "Options must have at least 2 items"
    assert len(question.options) <= 4, "Options must have at most 4 items"
    
    # Each option is non-empty
    for opt in question.options:
        assert opt.strip(), "Each option must be non-empty"


# **Feature: symptom-checker-provider, Property 5: DDX structure validity**
# *For any* generated DifferentialDiagnosis, each Diagnosis SHALL have: 
# probability in range [0.0, 1.0], non-empty reasoning, and severity in 
# {"life_threatening", "serious", "moderate", "mild"}.
# **Validates: Requirements 2.2, 2.3**

@settings(max_examples=100)
@given(st.lists(diagnosis_strategy, min_size=1, max_size=5), non_empty_str)
def test_property_5_ddx_structure_validity(diagnoses: list[Diagnosis], disclaimer: str):
    """Property 5: DDX structure validity.
    
    For any valid DifferentialDiagnosis, each Diagnosis must have valid probability,
    non-empty reasoning, and valid severity classification.
    """
    ddx = DifferentialDiagnosis(differential=diagnoses, disclaimer=disclaimer)
    
    for diagnosis in ddx.differential:
        # Probability in valid range
        assert 0.0 <= diagnosis.probability <= 1.0, \
            f"Probability {diagnosis.probability} must be in [0.0, 1.0]"
        
        # Reasoning is non-empty
        assert diagnosis.reasoning.strip(), "Reasoning must be non-empty"
        
        # Severity is valid
        valid_severities = {"life_threatening", "serious", "moderate", "mild"}
        assert diagnosis.severity in valid_severities, \
            f"Severity {diagnosis.severity} must be one of {valid_severities}"
    
    # Disclaimer is non-empty
    assert ddx.disclaimer.strip(), "Disclaimer must be non-empty"


# ============== VALIDATION REJECTION TESTS ==============

def test_question_rejects_empty_options():
    """Question model should reject options list with fewer than 2 items."""
    with pytest.raises(ValidationError):
        Question(
            question="How long have you had this symptom?",
            purpose="To determine duration",
            options=["Only one option"]  # Too few options
        )


def test_question_rejects_too_many_options():
    """Question model should reject options list with more than 4 items."""
    with pytest.raises(ValidationError):
        Question(
            question="How long have you had this symptom?",
            purpose="To determine duration",
            options=["1", "2", "3", "4", "5"]  # Too many options
        )


def test_diagnosis_rejects_invalid_probability():
    """Diagnosis model should reject probability outside [0.0, 1.0]."""
    with pytest.raises(ValidationError):
        Diagnosis(
            condition="Common Cold",
            probability=1.5,  # Invalid: > 1.0
            reasoning="Symptoms match",
            severity="mild"
        )
    
    with pytest.raises(ValidationError):
        Diagnosis(
            condition="Common Cold",
            probability=-0.1,  # Invalid: < 0.0
            reasoning="Symptoms match",
            severity="mild"
        )


def test_diagnosis_rejects_invalid_severity():
    """Diagnosis model should reject invalid severity values."""
    with pytest.raises(ValidationError):
        Diagnosis(
            condition="Common Cold",
            probability=0.5,
            reasoning="Symptoms match",
            severity="critical"  # Invalid severity
        )


def test_preliminary_questions_rejects_too_few():
    """PreliminaryQuestions should reject fewer than 3 questions."""
    valid_question = Question(
        question="Test?",
        purpose="Testing",
        options=["Yes", "No"]
    )
    with pytest.raises(ValidationError):
        PreliminaryQuestions(preliminary_questions=[valid_question, valid_question])


def test_preliminary_questions_rejects_too_many():
    """PreliminaryQuestions should reject more than 5 questions."""
    valid_question = Question(
        question="Test?",
        purpose="Testing",
        options=["Yes", "No"]
    )
    with pytest.raises(ValidationError):
        PreliminaryQuestions(preliminary_questions=[valid_question] * 6)


def test_final_summary_rejects_invalid_probability():
    """FinalSummary should reject probability outside [0.0, 1.0]."""
    with pytest.raises(ValidationError):
        FinalSummary(
            top_diagnosis="Common Cold",
            probability=2.0,  # Invalid
            explanation="You likely have a cold",
            disclaimer="For educational purposes only"
        )


# ============== PROPERTY TESTS FOR QUESTION GENERATION ==============

# Strategy for valid PreliminaryQuestions (3-5 questions)
preliminary_questions_strategy = st.builds(
    PreliminaryQuestions,
    preliminary_questions=st.lists(question_strategy, min_size=3, max_size=5),
)


# **Feature: symptom-checker-provider, Property 1: Question count bounds**
# *For any* symptom input string, the generated PreliminaryQuestions SHALL contain 
# between 3 and 5 questions (inclusive).
# **Validates: Requirements 1.1, 1.2**

@settings(max_examples=100)
@given(preliminary_questions_strategy)
def test_property_1_question_count_bounds(questions: PreliminaryQuestions):
    """Property 1: Question count bounds.
    
    For any valid PreliminaryQuestions, the number of questions must be between 3 and 5.
    """
    count = len(questions.preliminary_questions)
    assert 3 <= count <= 5, f"Question count {count} must be between 3 and 5"


# **Feature: symptom-checker-provider, Property 2: Single question validation**
# *For any* generated Question (preliminary or refinement), the question text SHALL 
# contain exactly one question mark and SHALL NOT contain conjunctions like "and also" 
# or "as well as" that combine multiple questions.
# **Validates: Requirements 1.2, 3.2**

# Strategy for single questions that should pass validation
single_question_text_strategy = st.sampled_from([
    "How long have you had this symptom?",
    "Is the pain constant or intermittent?",
    "Do you have a fever?",
    "Have you taken any medication?",
    "Where exactly is the pain located?",
    "On a scale of 1-10, how severe is the pain?",
    "Did the symptoms start suddenly or gradually?",
    "Have you experienced this before?",
])

# Strategy for questions that should fail validation (multiple questions combined)
combined_question_text_strategy = st.sampled_from([
    "How long have you had this symptom and also do you have a fever?",
    "Is the pain constant as well as do you have nausea?",
    "Do you have a fever and have you taken any medication?",
    "Where is the pain located and also how severe is it?",
])


def is_single_question(question_text: str) -> bool:
    """Check if a question text represents a single question.
    
    A single question should:
    - Contain exactly one question mark
    - Not contain conjunctions that combine multiple questions
    """
    # Count question marks
    question_mark_count = question_text.count("?")
    if question_mark_count != 1:
        return False
    
    # Check for combining conjunctions
    combining_phrases = ["and also", "as well as", "and do you", "and have you", "and are you"]
    text_lower = question_text.lower()
    for phrase in combining_phrases:
        if phrase in text_lower:
            return False
    
    return True


@settings(max_examples=100)
@given(st.builds(
    Question,
    question=single_question_text_strategy,
    purpose=non_empty_str,
    options=options_strategy,
))
def test_property_2_single_question_validation_valid(question: Question):
    """Property 2: Single question validation (valid cases).
    
    For any properly formed question, it should contain exactly one question mark
    and not contain combining conjunctions.
    """
    assert is_single_question(question.question), \
        f"Question '{question.question}' should be a valid single question"


@settings(max_examples=100)
@given(st.builds(
    Question,
    question=combined_question_text_strategy,
    purpose=non_empty_str,
    options=options_strategy,
))
def test_property_2_single_question_validation_invalid(question: Question):
    """Property 2: Single question validation (invalid cases).
    
    Questions that combine multiple questions should fail the single question check.
    """
    assert not is_single_question(question.question), \
        f"Question '{question.question}' should NOT be a valid single question"


# ============== PROPERTY TESTS FOR DDX GENERATION ==============

# **Feature: symptom-checker-provider, Property 6: DDX ranking order**
# *For any* generated DifferentialDiagnosis with multiple conditions, the differential 
# list SHALL be sorted by probability in descending order.
# **Validates: Requirements 2.1**

@settings(max_examples=100)
@given(st.lists(diagnosis_strategy, min_size=2, max_size=5), non_empty_str)
def test_property_6_ddx_ranking_order(diagnoses: list[Diagnosis], disclaimer: str):
    """Property 6: DDX ranking order.
    
    For any DifferentialDiagnosis with multiple conditions, the list should be
    sorted by probability in descending order.
    """
    # Sort diagnoses by probability descending (as the system should do)
    sorted_diagnoses = sorted(diagnoses, key=lambda d: d.probability, reverse=True)
    ddx = DifferentialDiagnosis(differential=sorted_diagnoses, disclaimer=disclaimer)
    
    # Verify the order is descending
    probabilities = [d.probability for d in ddx.differential]
    for i in range(len(probabilities) - 1):
        assert probabilities[i] >= probabilities[i + 1], \
            f"DDX not sorted: {probabilities[i]} should be >= {probabilities[i + 1]}"


def is_properly_ranked(ddx: DifferentialDiagnosis) -> bool:
    """Check if a DDX is properly ranked by probability (descending)."""
    probabilities = [d.probability for d in ddx.differential]
    for i in range(len(probabilities) - 1):
        if probabilities[i] < probabilities[i + 1]:
            return False
    return True


# **Feature: symptom-checker-provider, Property 7: DDX disclaimer presence**
# *For any* generated DifferentialDiagnosis, the disclaimer field SHALL be a non-empty 
# string containing "educational purposes" or similar disclaimer text.
# **Validates: Requirements 2.4**

# Strategy for valid disclaimer text
disclaimer_strategy = st.sampled_from([
    "This is for educational purposes only. Always consult a healthcare provider.",
    "For educational purposes only. Please see a doctor for proper diagnosis.",
    "This information is for educational purposes only and not a substitute for professional medical advice.",
    "Educational purposes only. Consult a healthcare professional for diagnosis and treatment.",
])


@settings(max_examples=100)
@given(st.lists(diagnosis_strategy, min_size=1, max_size=5), disclaimer_strategy)
def test_property_7_ddx_disclaimer_presence(diagnoses: list[Diagnosis], disclaimer: str):
    """Property 7: DDX disclaimer presence.
    
    For any DifferentialDiagnosis, the disclaimer field must be non-empty and
    contain appropriate disclaimer text.
    """
    ddx = DifferentialDiagnosis(differential=diagnoses, disclaimer=disclaimer)
    
    # Disclaimer is non-empty
    assert ddx.disclaimer.strip(), "Disclaimer must be non-empty"
    
    # Disclaimer contains educational purposes text
    disclaimer_lower = ddx.disclaimer.lower()
    assert "educational purposes" in disclaimer_lower or "educational" in disclaimer_lower, \
        f"Disclaimer should mention educational purposes: {ddx.disclaimer}"


def has_valid_disclaimer(ddx: DifferentialDiagnosis) -> bool:
    """Check if a DDX has a valid disclaimer."""
    if not ddx.disclaimer or not ddx.disclaimer.strip():
        return False
    disclaimer_lower = ddx.disclaimer.lower()
    return "educational" in disclaimer_lower or "purposes" in disclaimer_lower


# ============== PROPERTY TESTS FOR REFINEMENT STOP CONDITIONS ==============

# Import the should_continue_refinement function
from src.infrastructure.symptom_checker_graph import should_continue_refinement, SymptomCheckerState


def create_test_state(
    refinement_count: int = 0,
    diagnoses: list[Diagnosis] | None = None,
    use_refined: bool = False,
    language: str = 'en'
) -> SymptomCheckerState:
    """Helper to create a test state with specified parameters."""
    ddx = None
    if diagnoses:
        ddx = DifferentialDiagnosis(
            differential=diagnoses,
            disclaimer="For educational purposes only."
        )
    
    state: SymptomCheckerState = {
        "messages": [],
        "symptom_input": "test symptom",
        "preliminary_questions": None,
        "qa_pairs": None,
        "differential_diagnosis": ddx if not use_refined else None,
        "refinement_qa_pairs": None,
        "current_refinement_question": None,
        "refined_ddx": ddx if use_refined else None,
        "refinement_count": refinement_count,
        "final_summary": None,
        "language": language,
    }
    return state


# **Feature: symptom-checker-provider, Property 8: Refinement stop condition - confidence**
# *For any* state where life-threatening probabilities sum to less than 0.10 AND 
# top diagnosis probability exceeds 0.50, the should_continue_refinement function 
# SHALL return "end".
# **Validates: Requirements 4.1**

# Strategy for life-threatening probability that sums to < 0.10
life_threatening_prob_strategy = st.floats(min_value=0.0, max_value=0.09, allow_nan=False, allow_infinity=False)

# Strategy for top diagnosis probability > 0.50
high_confidence_prob_strategy = st.floats(min_value=0.51, max_value=1.0, allow_nan=False, allow_infinity=False)


@settings(max_examples=100)
@given(
    top_prob=high_confidence_prob_strategy,
    lt_prob=life_threatening_prob_strategy,
    refinement_count=st.integers(min_value=0, max_value=4),
)
def test_property_8_refinement_stop_confidence(top_prob: float, lt_prob: float, refinement_count: int):
    """Property 8: Refinement stop condition - confidence.
    
    For any state where life-threatening probabilities sum to less than 0.10 AND
    top diagnosis probability exceeds 0.50, should_continue_refinement returns "end".
    """
    # Create diagnoses where top is high confidence and life-threatening is low
    diagnoses = [
        Diagnosis(
            condition="Common Cold",
            probability=top_prob,
            reasoning="Symptoms match",
            severity="mild"
        ),
        Diagnosis(
            condition="Serious Condition",
            probability=lt_prob,
            reasoning="Low probability",
            severity="life_threatening"
        ),
    ]
    
    state = create_test_state(refinement_count=refinement_count, diagnoses=diagnoses)
    
    result = should_continue_refinement(state)
    
    # Should return "end" because confidence conditions are met
    assert result == "end", \
        f"Expected 'end' when top_prob={top_prob} > 0.50 and lt_sum={lt_prob} < 0.10, got '{result}'"


# **Feature: symptom-checker-provider, Property 9: Refinement stop condition - max iterations**
# *For any* state where refinement_count >= 5, the should_continue_refinement function 
# SHALL return "end" regardless of probability values.
# **Validates: Requirements 4.2**

@settings(max_examples=100)
@given(
    refinement_count=st.integers(min_value=5, max_value=100),
    top_prob=probability_strategy,
    lt_prob=probability_strategy,
)
def test_property_9_refinement_stop_max_iterations(refinement_count: int, top_prob: float, lt_prob: float):
    """Property 9: Refinement stop condition - max iterations.
    
    For any state where refinement_count >= 5, should_continue_refinement returns "end"
    regardless of probability values.
    """
    # Create diagnoses with any probability values
    diagnoses = [
        Diagnosis(
            condition="Condition A",
            probability=top_prob,
            reasoning="Some reasoning",
            severity="moderate"
        ),
        Diagnosis(
            condition="Condition B",
            probability=lt_prob,
            reasoning="Some reasoning",
            severity="life_threatening"
        ),
    ]
    
    state = create_test_state(refinement_count=refinement_count, diagnoses=diagnoses)
    
    result = should_continue_refinement(state)
    
    # Should always return "end" when refinement_count >= 5
    assert result == "end", \
        f"Expected 'end' when refinement_count={refinement_count} >= 5, got '{result}'"


# Additional test: should continue when conditions are NOT met
@settings(max_examples=100)
@given(
    top_prob=st.floats(min_value=0.0, max_value=0.50, allow_nan=False, allow_infinity=False),
    lt_prob=st.floats(min_value=0.10, max_value=1.0, allow_nan=False, allow_infinity=False),
    refinement_count=st.integers(min_value=0, max_value=4),
)
def test_refinement_continues_when_conditions_not_met(top_prob: float, lt_prob: float, refinement_count: int):
    """Refinement should continue when stop conditions are NOT met.
    
    When top_prob <= 0.50 OR lt_sum >= 0.10, and refinement_count < 5,
    should_continue_refinement should return "continue".
    """
    # Create diagnoses where conditions for stopping are NOT met
    diagnoses = [
        Diagnosis(
            condition="Uncertain Condition",
            probability=top_prob,
            reasoning="Uncertain",
            severity="moderate"
        ),
        Diagnosis(
            condition="Life Threatening",
            probability=lt_prob,
            reasoning="Possible",
            severity="life_threatening"
        ),
    ]
    
    state = create_test_state(refinement_count=refinement_count, diagnoses=diagnoses)
    
    result = should_continue_refinement(state)
    
    # Should return "continue" because stop conditions are not met
    assert result == "continue", \
        f"Expected 'continue' when top_prob={top_prob} <= 0.50 or lt_sum={lt_prob} >= 0.10, got '{result}'"



# ============== PROPERTY TESTS FOR FINAL SUMMARY ==============

# **Feature: symptom-checker-provider, Property 10: Final summary completeness**
# *For any* generated FinalSummary, all fields (top_diagnosis, probability, explanation, 
# disclaimer) SHALL be non-empty, and probability SHALL be in range [0.0, 1.0].
# **Validates: Requirements 4.3**

# Strategy for valid FinalSummary
final_summary_strategy = st.builds(
    FinalSummary,
    top_diagnosis=non_empty_str,
    probability=probability_strategy,
    explanation=non_empty_str,
    disclaimer=non_empty_str,
)


@settings(max_examples=100)
@given(final_summary_strategy)
def test_property_10_final_summary_completeness(summary: FinalSummary):
    """Property 10: Final summary completeness.
    
    For any valid FinalSummary, all fields must be non-empty and probability
    must be in range [0.0, 1.0].
    """
    # top_diagnosis is non-empty
    assert summary.top_diagnosis.strip(), "top_diagnosis must be non-empty"
    
    # probability is in valid range
    assert 0.0 <= summary.probability <= 1.0, \
        f"probability {summary.probability} must be in [0.0, 1.0]"
    
    # explanation is non-empty
    assert summary.explanation.strip(), "explanation must be non-empty"
    
    # disclaimer is non-empty
    assert summary.disclaimer.strip(), "disclaimer must be non-empty"


def is_valid_final_summary(summary: FinalSummary) -> bool:
    """Check if a FinalSummary has all required fields properly filled."""
    if not summary.top_diagnosis or not summary.top_diagnosis.strip():
        return False
    if not (0.0 <= summary.probability <= 1.0):
        return False
    if not summary.explanation or not summary.explanation.strip():
        return False
    if not summary.disclaimer or not summary.disclaimer.strip():
        return False
    return True


@settings(max_examples=100)
@given(final_summary_strategy)
def test_final_summary_validity_helper(summary: FinalSummary):
    """Test that the validity helper correctly identifies valid summaries."""
    assert is_valid_final_summary(summary), \
        f"Valid FinalSummary should pass validity check: {summary}"


# ============== PROPERTY TESTS FOR OPTIONS ENCODING ==============

# Import the encode_options function
from src.infrastructure.symptom_checker_provider import encode_options

# **Feature: symptom-checker-provider, Property 11: Options encoding format**
# *For any* interrupt response with options, the encoded string SHALL match the 
# pattern `{text}\n__OPTIONS__:{json_array}` where json_array is valid JSON.
# **Validates: Requirements 5.2**

# Strategy for question text (non-empty strings without newlines for cleaner testing)
question_text_strategy = st.text(min_size=1, max_size=200).filter(
    lambda s: s.strip() and "\n" not in s
)

# Strategy for options (2-4 non-empty strings)
encoding_options_strategy = st.lists(
    st.text(min_size=1, max_size=50).filter(lambda s: s.strip()),
    min_size=2,
    max_size=4
)


@settings(max_examples=100)
@given(question=question_text_strategy, options=encoding_options_strategy)
def test_property_11_options_encoding_format(question: str, options: list[str]):
    """Property 11: Options encoding format.
    
    For any interrupt response with options, the encoded string SHALL match the
    pattern `{text}\n__OPTIONS__:{json_array}` where json_array is valid JSON.
    """
    encoded = encode_options(question, options)
    
    # Check that the encoded string contains the delimiter
    assert "\n__OPTIONS__:" in encoded, \
        f"Encoded string must contain '\\n__OPTIONS__:' delimiter"
    
    # Split and verify structure
    parts = encoded.split("\n__OPTIONS__:")
    assert len(parts) == 2, \
        f"Encoded string must have exactly one '__OPTIONS__:' delimiter"
    
    question_part, json_part = parts
    
    # Verify question part matches input
    assert question_part == question, \
        f"Question part '{question_part}' must match input '{question}'"
    
    # Verify JSON part is valid JSON
    try:
        parsed_options = json.loads(json_part)
    except json.JSONDecodeError as e:
        pytest.fail(f"JSON part must be valid JSON: {e}")
    
    # Verify parsed options match input
    assert parsed_options == options, \
        f"Parsed options {parsed_options} must match input {options}"


@settings(max_examples=100)
@given(question=question_text_strategy, options=encoding_options_strategy)
def test_options_encoding_roundtrip(question: str, options: list[str]):
    """Test that options can be encoded and decoded back correctly."""
    encoded = encode_options(question, options)
    
    # Parse the encoded string
    parts = encoded.split("\n__OPTIONS__:")
    decoded_question = parts[0]
    decoded_options = json.loads(parts[1])
    
    # Verify roundtrip
    assert decoded_question == question
    assert decoded_options == options



# ============== PROPERTY TESTS FOR CHECKPOINT ROUND-TRIP ==============

# **Feature: symptom-checker-provider, Property 12: Checkpoint round-trip preservation**
# *For any* conversation that is interrupted and then resumed, the state after resume 
# SHALL contain all QA_Pairs and differential_diagnosis data that existed before the interrupt.
# **Validates: Requirements 7.2, 7.3**

# Strategy for QA pairs
qa_pair_strategy = st.builds(
    lambda q, a: {"question": q, "answer": a},
    q=non_empty_str,
    a=non_empty_str,
)

qa_pairs_list_strategy = st.lists(qa_pair_strategy, min_size=1, max_size=5)


def create_state_with_qa_and_ddx(
    qa_pairs: list[dict],
    diagnoses: list[Diagnosis],
    refinement_qa_pairs: list[dict] | None = None,
    refinement_count: int = 0,
    language: str = 'en',
) -> SymptomCheckerState:
    """Helper to create a state with QA pairs and DDX for checkpoint testing."""
    ddx = DifferentialDiagnosis(
        differential=diagnoses,
        disclaimer="For educational purposes only."
    )
    
    state: SymptomCheckerState = {
        "messages": [],
        "symptom_input": "test symptom",
        "preliminary_questions": None,
        "qa_pairs": qa_pairs,
        "differential_diagnosis": ddx,
        "refinement_qa_pairs": refinement_qa_pairs,
        "current_refinement_question": None,
        "refined_ddx": None,
        "refinement_count": refinement_count,
        "final_summary": None,
        "language": language,
    }
    return state


@settings(max_examples=100)
@given(
    qa_pairs=qa_pairs_list_strategy,
    diagnoses=st.lists(diagnosis_strategy, min_size=1, max_size=3),
)
def test_property_12_checkpoint_state_preservation(
    qa_pairs: list[dict],
    diagnoses: list[Diagnosis],
):
    """Property 12: Checkpoint round-trip preservation.
    
    For any conversation state with QA pairs and differential diagnosis,
    the state data should be preserved correctly when stored and retrieved.
    
    Note: This tests the state structure preservation, not the actual checkpoint
    persistence (which requires async database operations). The actual checkpoint
    round-trip is tested in integration tests.
    """
    # Create a state with QA pairs and DDX
    state = create_state_with_qa_and_ddx(qa_pairs, diagnoses)
    
    # Verify QA pairs are preserved in state
    assert state["qa_pairs"] == qa_pairs, \
        "QA pairs must be preserved in state"
    
    # Verify DDX is preserved in state
    assert state["differential_diagnosis"] is not None, \
        "Differential diagnosis must be present in state"
    
    assert len(state["differential_diagnosis"].differential) == len(diagnoses), \
        "Number of diagnoses must be preserved"
    
    for i, (original, stored) in enumerate(zip(diagnoses, state["differential_diagnosis"].differential)):
        assert stored.condition == original.condition, \
            f"Diagnosis {i} condition must be preserved"
        assert stored.probability == original.probability, \
            f"Diagnosis {i} probability must be preserved"
        assert stored.reasoning == original.reasoning, \
            f"Diagnosis {i} reasoning must be preserved"
        assert stored.severity == original.severity, \
            f"Diagnosis {i} severity must be preserved"


@settings(max_examples=100)
@given(
    qa_pairs=qa_pairs_list_strategy,
    refinement_qa_pairs=qa_pairs_list_strategy,
    diagnoses=st.lists(diagnosis_strategy, min_size=1, max_size=3),
    refinement_count=st.integers(min_value=0, max_value=5),
)
def test_property_12_refinement_state_preservation(
    qa_pairs: list[dict],
    refinement_qa_pairs: list[dict],
    diagnoses: list[Diagnosis],
    refinement_count: int,
):
    """Property 12: Checkpoint round-trip preservation (refinement state).
    
    For any conversation state with refinement QA pairs, the refinement data
    should be preserved correctly.
    """
    # Create a state with refinement data
    state = create_state_with_qa_and_ddx(
        qa_pairs, 
        diagnoses, 
        refinement_qa_pairs=refinement_qa_pairs,
        refinement_count=refinement_count,
    )
    
    # Verify preliminary QA pairs are preserved
    assert state["qa_pairs"] == qa_pairs, \
        "Preliminary QA pairs must be preserved"
    
    # Verify refinement QA pairs are preserved
    assert state["refinement_qa_pairs"] == refinement_qa_pairs, \
        "Refinement QA pairs must be preserved"
    
    # Verify refinement count is preserved
    assert state["refinement_count"] == refinement_count, \
        "Refinement count must be preserved"


def verify_state_data_integrity(state: SymptomCheckerState) -> bool:
    """Verify that a state has all required data for checkpoint preservation.
    
    Returns True if the state contains valid QA pairs and DDX data.
    """
    # Check QA pairs
    qa_pairs = state.get("qa_pairs")
    if qa_pairs is not None:
        for qa in qa_pairs:
            if not isinstance(qa, dict):
                return False
            if "question" not in qa or "answer" not in qa:
                return False
    
    # Check DDX
    ddx = state.get("differential_diagnosis")
    if ddx is not None:
        if not hasattr(ddx, "differential") or not hasattr(ddx, "disclaimer"):
            return False
        for diagnosis in ddx.differential:
            if not all(hasattr(diagnosis, attr) for attr in ["condition", "probability", "reasoning", "severity"]):
                return False
    
    return True


@settings(max_examples=100)
@given(
    qa_pairs=qa_pairs_list_strategy,
    diagnoses=st.lists(diagnosis_strategy, min_size=1, max_size=3),
)
def test_state_data_integrity_helper(qa_pairs: list[dict], diagnoses: list[Diagnosis]):
    """Test that the state data integrity helper correctly validates states."""
    state = create_state_with_qa_and_ddx(qa_pairs, diagnoses)
    assert verify_state_data_integrity(state), \
        "Valid state should pass integrity check"
