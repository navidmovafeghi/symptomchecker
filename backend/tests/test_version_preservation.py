"""Property-based tests for version preservation in conversations.

**Feature: data-persistence-fix, Property 4: Version increment on update**
**Validates: Requirements 2.3**
"""
import pytest
from hypothesis import given, strategies as st, settings
from datetime import datetime
from uuid import uuid4

from src.domain.entities import Conversation, Message


# Strategies for generating test data
message_role_strategy = st.sampled_from(["user", "assistant", "system"])
message_content_strategy = st.text(min_size=1, max_size=500)
version_strategy = st.integers(min_value=1, max_value=1000)


@st.composite
def message_strategy(draw):
    """Generate a valid Message."""
    return Message(
        id=uuid4(),
        role=draw(message_role_strategy),
        content=draw(message_content_strategy),
        timestamp=datetime.utcnow()
    )


@st.composite
def conversation_strategy(draw):
    """Generate a valid Conversation with a specific version."""
    version = draw(version_strategy)
    messages = draw(st.lists(message_strategy(), min_size=0, max_size=5))
    return Conversation(
        id=uuid4(),
        title=draw(st.text(min_size=0, max_size=50) | st.none()),
        messages=messages,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
        version=version,
        has_pending_response=draw(st.booleans())
    )


@settings(max_examples=100)
@given(conversation=conversation_strategy(), new_message=message_strategy())
def test_add_message_preserves_version(conversation: Conversation, new_message: Message):
    """
    **Feature: data-persistence-fix, Property 4: Version increment on update**
    **Validates: Requirements 2.3**
    
    Property: When adding a message via add_message(), the version number
    SHALL be preserved (not incremented). Version increment only happens on save.
    
    This tests that add_message() correctly preserves the version, which is
    a prerequisite for the repository to properly increment it on save.
    """
    original_version = conversation.version
    
    # Add a message
    updated_conversation = conversation.add_message(new_message)
    
    # Version should be preserved (not incremented) - increment happens on save
    assert updated_conversation.version == original_version, (
        f"add_message() should preserve version. "
        f"Expected {original_version}, got {updated_conversation.version}"
    )


@settings(max_examples=100)
@given(conversation=conversation_strategy(), messages=st.lists(message_strategy(), min_size=1, max_size=10))
def test_multiple_add_messages_preserve_version(conversation: Conversation, messages: list):
    """
    **Feature: data-persistence-fix, Property 4: Version increment on update**
    **Validates: Requirements 2.3**
    
    Property: When adding multiple messages sequentially via add_message(),
    the version number SHALL remain unchanged throughout all additions.
    """
    original_version = conversation.version
    current_conversation = conversation
    
    # Add multiple messages
    for msg in messages:
        current_conversation = current_conversation.add_message(msg)
    
    # Version should still be the original
    assert current_conversation.version == original_version, (
        f"Version should be preserved after {len(messages)} message additions. "
        f"Expected {original_version}, got {current_conversation.version}"
    )


@settings(max_examples=100)
@given(version=version_strategy)
def test_conversation_initializes_with_correct_version(version: int):
    """
    **Feature: data-persistence-fix, Property 4: Version increment on update**
    **Validates: Requirements 2.3**
    
    Property: A conversation initialized with a specific version SHALL
    retain that exact version value.
    """
    conversation = Conversation(
        id=uuid4(),
        version=version
    )
    
    assert conversation.version == version, (
        f"Conversation should initialize with version {version}, got {conversation.version}"
    )


@settings(max_examples=100)
@given(st.integers(min_value=1, max_value=1000))
def test_default_version_is_one(initial_version: int):
    """
    **Feature: data-persistence-fix, Property 4: Version increment on update**
    **Validates: Requirements 2.3**
    
    Property: A new conversation without explicit version SHALL default to version 1.
    """
    conversation = Conversation(id=uuid4())
    
    assert conversation.version == 1, (
        f"Default version should be 1, got {conversation.version}"
    )
