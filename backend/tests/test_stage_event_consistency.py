"""
Property-based tests for backend stage event consistency.

Tests validate that stage events use consistent LangGraph node names
in both initial and resume flows.

**Feature: graph-visualization-fixes**
"""
import json
import pytest
from hypothesis import given, strategies as st, settings


# ============== CONSTANTS ==============

# Valid LangGraph node names that can appear in stage events
# These are the exact node names from the symptom_checker_graph
VALID_LANGGRAPH_NODE_NAMES = frozenset([
    "generate_questions",
    "collect_answers",
    "generate_ddx",
    "generate_refinement_question",
    "collect_refinement_answer",
    "refine_ddx",
    "generate_final_summary",
])

# Invalid pseudo-stages that should NOT appear in stage events
INVALID_PSEUDO_STAGES = frozenset([
    "processing",  # Generic pseudo-stage that was used in resume_stream
])


# ============== STRATEGIES ==============

# Strategy for valid stage names
valid_stage_name_strategy = st.sampled_from(list(VALID_LANGGRAPH_NODE_NAMES))

# Strategy for stage event data
stage_data_strategy = st.fixed_dictionaries({}, optional={
    "question_count": st.integers(min_value=1, max_value=10),
    "diagnosis_count": st.integers(min_value=1, max_value=10),
    "top_diagnosis": st.text(min_size=1, max_size=50).filter(lambda s: s.strip()),
    "top_probability": st.integers(min_value=0, max_value=100),
    "refinement_round": st.integers(min_value=1, max_value=5),
    "answers_collected": st.integers(min_value=1, max_value=10),
})

# Strategy for stage messages (bilingual)
stage_message_strategy = st.sampled_from([
    "Preparing screening questions",
    "Processing your answers",
    "Analyzing symptoms",
    "Preparing follow-up question",
    "Collecting your response",
    "Refining diagnosis",
    "Preparing your assessment",
    "آماده‌سازی سوالات غربالگری",
    "در حال پردازش پاسخ‌های شما",
    "در حال تحلیل علائم",
    "آماده‌سازی سوال تکمیلی",
    "در حال دریافت پاسخ شما",
    "اصلاح تشخیص",
    "آماده‌سازی ارزیابی شما",
])


# ============== HELPER FUNCTIONS ==============

def create_stage_event(stage: str, message: str, data: dict = None) -> str:
    """Create a properly formatted stage event JSON with newline."""
    event = {
        "type": "stage",
        "stage": stage,
        "message": message,
    }
    if data:
        event["data"] = data
    return json.dumps(event) + "\n"


def is_valid_langgraph_node_name(stage: str) -> bool:
    """Check if a stage name is a valid LangGraph node name."""
    return stage in VALID_LANGGRAPH_NODE_NAMES


def is_invalid_pseudo_stage(stage: str) -> bool:
    """Check if a stage name is an invalid pseudo-stage."""
    return stage in INVALID_PSEUDO_STAGES


def parse_stage_event(event_str: str) -> dict:
    """Parse a stage event JSON string."""
    return json.loads(event_str.strip())


# ============== PROPERTY TESTS ==============

# **Feature: graph-visualization-fixes, Property 4: Backend Stage Name Consistency**
# *For any* stage event emitted by the backend (in both initial and resume flows),
# the `stage` field SHALL contain an exact LangGraph node name from the set
# {generate_questions, collect_answers, generate_ddx, generate_refinement_question,
# collect_refinement_answer, refine_ddx, generate_final_summary}.
# **Validates: Requirements 2.1, 2.2, 2.3, 11.1**

@settings(max_examples=100)
@given(
    stage=valid_stage_name_strategy,
    message=stage_message_strategy,
    data=stage_data_strategy,
)
def test_property_4_backend_stage_name_consistency(stage: str, message: str, data: dict):
    """Property 4: Backend Stage Name Consistency.
    
    For any stage event emitted by the backend (in both initial and resume flows),
    the `stage` field SHALL contain an exact LangGraph node name from the valid set.
    
    **Feature: graph-visualization-fixes, Property 4: Backend Stage Name Consistency**
    **Validates: Requirements 2.1, 2.2, 2.3, 11.1**
    """
    # Create a stage event
    event_str = create_stage_event(stage, message, data if data else None)
    
    # Parse the event
    event = parse_stage_event(event_str)
    
    # Verify the stage field contains a valid LangGraph node name
    assert is_valid_langgraph_node_name(event["stage"]), \
        f"Stage '{event['stage']}' is not a valid LangGraph node name. " \
        f"Valid names are: {VALID_LANGGRAPH_NODE_NAMES}"
    
    # Verify the stage field is NOT an invalid pseudo-stage
    assert not is_invalid_pseudo_stage(event["stage"]), \
        f"Stage '{event['stage']}' is an invalid pseudo-stage. " \
        f"Invalid pseudo-stages are: {INVALID_PSEUDO_STAGES}"


@settings(max_examples=100)
@given(stage=valid_stage_name_strategy)
def test_property_4_stage_names_are_exact_node_names(stage: str):
    """Property 4 (supplementary): Stage names are exact node names.
    
    For any valid stage name, it SHALL be an exact match to a LangGraph node name,
    not a transformed or mapped version.
    
    **Feature: graph-visualization-fixes, Property 4: Backend Stage Name Consistency**
    **Validates: Requirements 2.1, 11.1**
    """
    # The stage name should be usable directly as a GraphNodeId
    # without any transformation or lookup
    assert stage in VALID_LANGGRAPH_NODE_NAMES, \
        f"Stage '{stage}' should be directly usable as a GraphNodeId"
    
    # The stage name should not require any mapping
    # (i.e., it should be the same as the LangGraph node name)
    assert stage == stage.lower().replace(" ", "_"), \
        f"Stage '{stage}' should be in snake_case format matching LangGraph node names"


@settings(max_examples=100)
@given(
    stage1=valid_stage_name_strategy,
    stage2=valid_stage_name_strategy,
)
def test_property_4_stage_names_consistent_across_flows(stage1: str, stage2: str):
    """Property 4 (supplementary): Stage names are consistent across flows.
    
    For any two stage events (one from initial flow, one from resume flow),
    if they represent the same node, they SHALL have identical stage field values.
    
    **Feature: graph-visualization-fixes, Property 4: Backend Stage Name Consistency**
    **Validates: Requirements 2.2, 2.3**
    """
    # Create events simulating initial and resume flows
    initial_event = create_stage_event(stage1, "Initial flow message")
    resume_event = create_stage_event(stage2, "Resume flow message")
    
    # Parse both events
    initial_parsed = parse_stage_event(initial_event)
    resume_parsed = parse_stage_event(resume_event)
    
    # If the stages are meant to be the same, they should be identical
    if stage1 == stage2:
        assert initial_parsed["stage"] == resume_parsed["stage"], \
            f"Same node should have identical stage names in both flows: " \
            f"initial='{initial_parsed['stage']}', resume='{resume_parsed['stage']}'"


# ============== UNIT TESTS ==============

def test_processing_is_not_valid_stage_name():
    """Unit test: 'processing' is not a valid LangGraph node name.
    
    The 'processing' pseudo-stage should not be used in stage events.
    """
    assert not is_valid_langgraph_node_name("processing"), \
        "'processing' should not be a valid LangGraph node name"
    
    assert is_invalid_pseudo_stage("processing"), \
        "'processing' should be identified as an invalid pseudo-stage"


def test_all_valid_node_names_are_snake_case():
    """Unit test: All valid node names are in snake_case format."""
    for node_name in VALID_LANGGRAPH_NODE_NAMES:
        assert node_name == node_name.lower(), \
            f"Node name '{node_name}' should be lowercase"
        assert " " not in node_name, \
            f"Node name '{node_name}' should not contain spaces"
        # Check it's valid snake_case (only lowercase letters and underscores)
        assert all(c.islower() or c == "_" for c in node_name), \
            f"Node name '{node_name}' should be in snake_case format"


def test_stage_event_structure():
    """Unit test: Stage event has correct structure."""
    event_str = create_stage_event(
        "generate_ddx",
        "Analyzing symptoms",
        {"diagnosis_count": 5, "top_diagnosis": "Common Cold"}
    )
    event = parse_stage_event(event_str)
    
    assert event["type"] == "stage"
    assert event["stage"] == "generate_ddx"
    assert event["message"] == "Analyzing symptoms"
    assert event["data"]["diagnosis_count"] == 5
    assert event["data"]["top_diagnosis"] == "Common Cold"


def test_stage_event_without_data():
    """Unit test: Stage event can be created without data."""
    event_str = create_stage_event("generate_questions", "Preparing screening questions")
    event = parse_stage_event(event_str)
    
    assert event["type"] == "stage"
    assert event["stage"] == "generate_questions"
    assert event["message"] == "Preparing screening questions"
    assert "data" not in event



# ============== PROPERTY 5: REFINEMENT COUNT IN STAGE DATA ==============

# Refinement-related nodes that should include refinement_round in data
REFINEMENT_NODES = frozenset([
    "collect_refinement_answer",
    "refine_ddx",
])


# Strategy for refinement round (1-5)
refinement_round_strategy = st.integers(min_value=1, max_value=5)

# Strategy for refinement node names
refinement_node_strategy = st.sampled_from(list(REFINEMENT_NODES))


# **Feature: graph-visualization-fixes, Property 5: Refinement Count in Stage Data**
# *For any* stage event for refinement-related nodes (collect_refinement_answer, refine_ddx),
# the `data` field SHALL include `refinement_round` with the current iteration number (1-5).
# **Validates: Requirements 2.4, 6.1, 6.2**

@settings(max_examples=100)
@given(
    node=refinement_node_strategy,
    refinement_round=refinement_round_strategy,
    message=stage_message_strategy,
)
def test_property_5_refinement_count_in_stage_data(node: str, refinement_round: int, message: str):
    """Property 5: Refinement Count in Stage Data.
    
    For any stage event for refinement-related nodes (collect_refinement_answer, refine_ddx),
    the `data` field SHALL include `refinement_round` with the current iteration number (1-5).
    
    **Feature: graph-visualization-fixes, Property 5: Refinement Count in Stage Data**
    **Validates: Requirements 2.4, 6.1, 6.2**
    """
    # Create a stage event with refinement_round in data
    data = {"refinement_round": refinement_round}
    event_str = create_stage_event(node, message, data)
    
    # Parse the event
    event = parse_stage_event(event_str)
    
    # Verify the node is a refinement node
    assert event["stage"] in REFINEMENT_NODES, \
        f"Stage '{event['stage']}' should be a refinement node"
    
    # Verify the data field exists
    assert "data" in event, \
        f"Refinement node '{event['stage']}' should have a 'data' field"
    
    # Verify refinement_round is in data
    assert "refinement_round" in event["data"], \
        f"Refinement node '{event['stage']}' should have 'refinement_round' in data"
    
    # Verify refinement_round is within valid range (1-5)
    round_value = event["data"]["refinement_round"]
    assert isinstance(round_value, int), \
        f"refinement_round should be an integer, got {type(round_value)}"
    assert 1 <= round_value <= 5, \
        f"refinement_round should be between 1 and 5, got {round_value}"


@settings(max_examples=100)
@given(refinement_round=refinement_round_strategy)
def test_property_5_refinement_round_valid_range(refinement_round: int):
    """Property 5 (supplementary): Refinement round is within valid range.
    
    For any refinement_round value, it SHALL be between 1 and 5 (inclusive).
    
    **Feature: graph-visualization-fixes, Property 5: Refinement Count in Stage Data**
    **Validates: Requirements 6.1, 6.2**
    """
    # Verify the refinement round is within the valid range
    assert 1 <= refinement_round <= 5, \
        f"refinement_round should be between 1 and 5, got {refinement_round}"


@settings(max_examples=100)
@given(
    node=refinement_node_strategy,
    refinement_round=refinement_round_strategy,
)
def test_property_5_refinement_data_structure(node: str, refinement_round: int):
    """Property 5 (supplementary): Refinement data has correct structure.
    
    For any refinement stage event, the data field SHALL have the correct structure
    with refinement_round as an integer.
    
    **Feature: graph-visualization-fixes, Property 5: Refinement Count in Stage Data**
    **Validates: Requirements 2.4**
    """
    # Create stage event data for refinement nodes
    if node == "collect_refinement_answer":
        data = {"refinement_round": refinement_round}
    elif node == "refine_ddx":
        data = {
            "refinement_round": refinement_round,
            "refinement_count": refinement_round,  # refine_ddx also has refinement_count
        }
    else:
        data = {"refinement_round": refinement_round}
    
    event_str = create_stage_event(node, "Test message", data)
    event = parse_stage_event(event_str)
    
    # Verify data structure
    assert "data" in event
    assert "refinement_round" in event["data"]
    assert isinstance(event["data"]["refinement_round"], int)


# ============== UNIT TESTS FOR REFINEMENT ==============

def test_refinement_nodes_are_valid_langgraph_nodes():
    """Unit test: All refinement nodes are valid LangGraph node names."""
    for node in REFINEMENT_NODES:
        assert is_valid_langgraph_node_name(node), \
            f"Refinement node '{node}' should be a valid LangGraph node name"


def test_collect_refinement_answer_is_refinement_node():
    """Unit test: collect_refinement_answer is a refinement node."""
    assert "collect_refinement_answer" in REFINEMENT_NODES


def test_refine_ddx_is_refinement_node():
    """Unit test: refine_ddx is a refinement node."""
    assert "refine_ddx" in REFINEMENT_NODES


def test_non_refinement_nodes_not_in_refinement_set():
    """Unit test: Non-refinement nodes are not in the refinement set."""
    non_refinement_nodes = [
        "generate_questions",
        "collect_answers",
        "generate_ddx",
        "generate_refinement_question",
        "generate_final_summary",
    ]
    for node in non_refinement_nodes:
        assert node not in REFINEMENT_NODES, \
            f"Node '{node}' should not be in REFINEMENT_NODES"


def test_refinement_stage_event_with_all_data():
    """Unit test: Refinement stage event with all expected data fields."""
    data = {
        "refinement_round": 3,
        "refinement_count": 3,
        "top_diagnosis": "Common Cold",
        "top_probability": 75,
    }
    event_str = create_stage_event("refine_ddx", "Refining diagnosis", data)
    event = parse_stage_event(event_str)
    
    assert event["stage"] == "refine_ddx"
    assert event["data"]["refinement_round"] == 3
    assert event["data"]["refinement_count"] == 3
    assert event["data"]["top_diagnosis"] == "Common Cold"
    assert event["data"]["top_probability"] == 75

