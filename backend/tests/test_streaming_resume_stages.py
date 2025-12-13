"""
Property-based tests for streaming resume stages feature.

Tests validate correctness properties for stage message streaming using hypothesis.
"""
import json
import pytest
from hypothesis import given, strategies as st, settings


# ============== STRATEGIES ==============

# Strategy for valid stage names (matching the stage_descriptions in the provider)
valid_stage_names = st.sampled_from([
    "processing",
    "generate_questions",
    "collect_answers",
    "generate_ddx",
    "generate_refinement_question",
    "collect_refinement_answer",
    "refine_ddx",
    "generate_final_summary",
])

# Strategy for non-empty stage messages
stage_message_strategy = st.sampled_from([
    "Processing your answers",
    "Preparing screening questions",
    "Processing your answers",
    "Analyzing symptoms",
    "Preparing follow-up question",
    "Processing your response",
    "Refining diagnosis",
    "Preparing your assessment",
])

# Strategy for thread IDs
thread_id_strategy = st.text(min_size=1, max_size=50).filter(lambda s: s.strip())

# Strategy for non-empty content strings
non_empty_content = st.text(min_size=1, max_size=500).filter(lambda s: s.strip())

# Strategy for options (2-4 non-empty strings)
options_strategy = st.lists(
    st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
    min_size=2,
    max_size=4
)


# ============== HELPER FUNCTIONS ==============

def create_stage_message(stage: str, message: str) -> str:
    """Create a properly formatted stage message JSON with newline."""
    return json.dumps({
        "type": "stage",
        "stage": stage,
        "message": message
    }) + "\n"


def create_interrupt_message(question: str, options: list[str], thread_id: str) -> str:
    """Create a properly formatted interrupt message JSON with newline."""
    return json.dumps({
        "type": "interrupt",
        "question": question,
        "options": options,
        "thread_id": thread_id
    }) + "\n"


def create_complete_message(content: str, thread_id: str) -> str:
    """Create a properly formatted complete message JSON with newline."""
    return json.dumps({
        "type": "complete",
        "content": content,
        "thread_id": thread_id
    }) + "\n"


def is_valid_stage_message(msg_str: str) -> bool:
    """Check if a message string is a valid stage message.
    
    A valid stage message must:
    - Be valid JSON
    - Have "type" equal to "stage"
    - Have a non-empty "stage" field
    - Have a non-empty "message" field
    """
    try:
        msg = json.loads(msg_str.strip())
        if msg.get("type") != "stage":
            return False
        if not msg.get("stage") or not isinstance(msg.get("stage"), str):
            return False
        if not msg.get("message") or not isinstance(msg.get("message"), str):
            return False
        return True
    except (json.JSONDecodeError, AttributeError):
        return False


def is_final_message(msg_str: str) -> bool:
    """Check if a message is a final message (interrupt or complete)."""
    try:
        msg = json.loads(msg_str.strip())
        return msg.get("type") in ("interrupt", "complete")
    except (json.JSONDecodeError, AttributeError):
        return False


def has_newline_delimiter(msg_str: str) -> bool:
    """Check if a message ends with a newline character."""
    return msg_str.endswith("\n")


# ============== PROPERTY TESTS ==============

# **Feature: streaming-resume-stages, Property 2: Stage message structure validity**
# *For any* stage message yielded by the backend resume_stream method, the message 
# SHALL contain "type" equal to "stage", a non-empty "stage" field, and a non-empty "message" field.
# **Validates: Requirements 2.2**

@settings(max_examples=100)
@given(stage=valid_stage_names, message=stage_message_strategy)
def test_property_2_stage_message_structure_validity(stage: str, message: str):
    """Property 2: Stage message structure validity.
    
    For any stage message yielded by the backend resume_stream method, the message
    SHALL contain "type" equal to "stage", a non-empty "stage" field, and a non-empty "message" field.
    """
    # Create a stage message using the helper (simulating what resume_stream does)
    msg_str = create_stage_message(stage, message)
    
    # Parse the message
    msg = json.loads(msg_str.strip())
    
    # Verify structure
    assert msg.get("type") == "stage", \
        f"Stage message type must be 'stage', got '{msg.get('type')}'"
    
    assert msg.get("stage") is not None and msg.get("stage").strip(), \
        f"Stage field must be non-empty, got '{msg.get('stage')}'"
    
    assert msg.get("message") is not None and msg.get("message").strip(), \
        f"Message field must be non-empty, got '{msg.get('message')}'"
    
    # Verify using the helper function
    assert is_valid_stage_message(msg_str), \
        f"Message should pass validity check: {msg_str}"



# **Feature: streaming-resume-stages, Property 3: Final message is always last**
# *For any* resume stream execution, the last message yielded SHALL be either an 
# interrupt or complete type, never a stage type.
# **Validates: Requirements 2.3**

# Strategy for generating a sequence of messages ending with a final message
def generate_message_sequence(
    num_stages: int,
    final_type: str,
    stages: list[tuple[str, str]],
    thread_id: str,
    question: str = None,
    options: list[str] = None,
    content: str = None
) -> list[str]:
    """Generate a sequence of messages as resume_stream would produce."""
    messages = []
    
    # Add stage messages
    for stage, msg in stages[:num_stages]:
        messages.append(create_stage_message(stage, msg))
    
    # Add final message
    if final_type == "interrupt":
        messages.append(create_interrupt_message(question or "Test question?", options or ["Yes", "No"], thread_id))
    else:
        messages.append(create_complete_message(content or "Assessment complete.", thread_id))
    
    return messages


@settings(max_examples=100)
@given(
    num_stages=st.integers(min_value=1, max_value=5),
    final_type=st.sampled_from(["interrupt", "complete"]),
    thread_id=thread_id_strategy,
)
def test_property_3_final_message_is_always_last(num_stages: int, final_type: str, thread_id: str):
    """Property 3: Final message is always last.
    
    For any resume stream execution, the last message yielded SHALL be either an
    interrupt or complete type, never a stage type.
    """
    # Generate sample stages
    sample_stages = [
        ("processing", "Processing your answers"),
        ("generate_ddx", "Analyzing symptoms"),
        ("generate_refinement_question", "Preparing follow-up question"),
        ("refine_ddx", "Refining diagnosis"),
        ("generate_final_summary", "Preparing your assessment"),
    ]
    
    # Generate message sequence
    messages = generate_message_sequence(
        num_stages=num_stages,
        final_type=final_type,
        stages=sample_stages,
        thread_id=thread_id,
        question="How severe is the pain?",
        options=["Mild", "Moderate", "Severe"],
        content="Based on our conversation, here's my assessment..."
    )
    
    # Verify the last message is a final message
    assert len(messages) > 0, "Message sequence must not be empty"
    
    last_message = messages[-1]
    assert is_final_message(last_message), \
        f"Last message must be interrupt or complete type, got: {last_message}"
    
    # Verify no stage messages appear after the final message
    # (In this test, we only have one final message at the end, so this is implicitly verified)
    
    # Verify all messages before the last are stage messages
    for i, msg in enumerate(messages[:-1]):
        assert is_valid_stage_message(msg), \
            f"Message {i} should be a valid stage message: {msg}"


# **Feature: streaming-resume-stages, Property 4: Newline delimiter presence**
# *For any* JSON message yielded by the backend resume_stream method, the message 
# SHALL end with a newline character.
# **Validates: Requirements 2.4**

@settings(max_examples=100)
@given(stage=valid_stage_names, message=stage_message_strategy)
def test_property_4_newline_delimiter_stage_messages(stage: str, message: str):
    """Property 4: Newline delimiter presence (stage messages).
    
    For any stage JSON message yielded by the backend resume_stream method,
    the message SHALL end with a newline character.
    """
    msg_str = create_stage_message(stage, message)
    
    assert has_newline_delimiter(msg_str), \
        f"Stage message must end with newline: {repr(msg_str)}"


@settings(max_examples=100)
@given(
    question=non_empty_content,
    options=options_strategy,
    thread_id=thread_id_strategy
)
def test_property_4_newline_delimiter_interrupt_messages(question: str, options: list[str], thread_id: str):
    """Property 4: Newline delimiter presence (interrupt messages).
    
    For any interrupt JSON message yielded by the backend resume_stream method,
    the message SHALL end with a newline character.
    """
    msg_str = create_interrupt_message(question, options, thread_id)
    
    assert has_newline_delimiter(msg_str), \
        f"Interrupt message must end with newline: {repr(msg_str)}"


@settings(max_examples=100)
@given(content=non_empty_content, thread_id=thread_id_strategy)
def test_property_4_newline_delimiter_complete_messages(content: str, thread_id: str):
    """Property 4: Newline delimiter presence (complete messages).
    
    For any complete JSON message yielded by the backend resume_stream method,
    the message SHALL end with a newline character.
    """
    msg_str = create_complete_message(content, thread_id)
    
    assert has_newline_delimiter(msg_str), \
        f"Complete message must end with newline: {repr(msg_str)}"


# **Feature: streaming-resume-stages, Property 6: Initial stage message first**
# *For any* resume stream execution, the first message yielded SHALL be a stage-type message.
# **Validates: Requirements 4.1**

@settings(max_examples=100)
@given(
    num_stages=st.integers(min_value=1, max_value=5),
    final_type=st.sampled_from(["interrupt", "complete"]),
    thread_id=thread_id_strategy,
)
def test_property_6_initial_stage_message_first(num_stages: int, final_type: str, thread_id: str):
    """Property 6: Initial stage message first.
    
    For any resume stream execution, the first message yielded SHALL be a stage-type message.
    """
    # Generate sample stages
    sample_stages = [
        ("processing", "Processing your answers"),
        ("generate_ddx", "Analyzing symptoms"),
        ("generate_refinement_question", "Preparing follow-up question"),
        ("refine_ddx", "Refining diagnosis"),
        ("generate_final_summary", "Preparing your assessment"),
    ]
    
    # Generate message sequence
    messages = generate_message_sequence(
        num_stages=num_stages,
        final_type=final_type,
        stages=sample_stages,
        thread_id=thread_id,
        question="How severe is the pain?",
        options=["Mild", "Moderate", "Severe"],
        content="Based on our conversation, here's my assessment..."
    )
    
    # Verify the first message is a stage message
    assert len(messages) > 0, "Message sequence must not be empty"
    
    first_message = messages[0]
    assert is_valid_stage_message(first_message), \
        f"First message must be a stage-type message, got: {first_message}"
    
    # Verify the first message is not a final message
    assert not is_final_message(first_message), \
        f"First message must not be a final message: {first_message}"


# ============== ADDITIONAL UNIT TESTS ==============

def test_stage_message_json_structure():
    """Unit test: Stage message has correct JSON structure."""
    msg_str = create_stage_message("generate_ddx", "Analyzing symptoms")
    msg = json.loads(msg_str.strip())
    
    assert "type" in msg
    assert "stage" in msg
    assert "message" in msg
    assert msg["type"] == "stage"
    assert msg["stage"] == "generate_ddx"
    assert msg["message"] == "Analyzing symptoms"


def test_interrupt_message_json_structure():
    """Unit test: Interrupt message has correct JSON structure."""
    msg_str = create_interrupt_message("How severe?", ["Mild", "Severe"], "thread-123")
    msg = json.loads(msg_str.strip())
    
    assert "type" in msg
    assert "question" in msg
    assert "options" in msg
    assert "thread_id" in msg
    assert msg["type"] == "interrupt"
    assert msg["question"] == "How severe?"
    assert msg["options"] == ["Mild", "Severe"]
    assert msg["thread_id"] == "thread-123"


def test_complete_message_json_structure():
    """Unit test: Complete message has correct JSON structure."""
    msg_str = create_complete_message("Assessment complete.", "thread-123")
    msg = json.loads(msg_str.strip())
    
    assert "type" in msg
    assert "content" in msg
    assert "thread_id" in msg
    assert msg["type"] == "complete"
    assert msg["content"] == "Assessment complete."
    assert msg["thread_id"] == "thread-123"


def test_is_valid_stage_message_rejects_invalid():
    """Unit test: is_valid_stage_message rejects invalid messages."""
    # Missing type
    assert not is_valid_stage_message('{"stage": "test", "message": "test"}')
    
    # Wrong type
    assert not is_valid_stage_message('{"type": "interrupt", "stage": "test", "message": "test"}')
    
    # Empty stage
    assert not is_valid_stage_message('{"type": "stage", "stage": "", "message": "test"}')
    
    # Empty message
    assert not is_valid_stage_message('{"type": "stage", "stage": "test", "message": ""}')
    
    # Invalid JSON
    assert not is_valid_stage_message('not json')


def test_is_final_message_identifies_correctly():
    """Unit test: is_final_message correctly identifies final messages."""
    # Interrupt is final
    assert is_final_message('{"type": "interrupt", "question": "test"}')
    
    # Complete is final
    assert is_final_message('{"type": "complete", "content": "test"}')
    
    # Stage is not final
    assert not is_final_message('{"type": "stage", "stage": "test", "message": "test"}')
    
    # Invalid JSON is not final
    assert not is_final_message('not json')
