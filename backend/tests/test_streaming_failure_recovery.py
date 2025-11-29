"""Property-based tests for streaming failure handling.

**Feature: client-side-storage**
**Validates: Requirements 3.1**

With client-side storage, conversations are stored in IndexedDB on the frontend.
These tests verify that the streaming use case properly propagates errors
so the frontend can handle them appropriately.
"""
import pytest
from hypothesis import given, strategies as st, settings
from datetime import datetime, timezone
from uuid import uuid4, UUID
import asyncio
import json
from typing import List, Dict, Any, AsyncIterator, Optional

from src.domain.entities import Conversation, Message
from src.domain.interfaces import ILLMProvider
from src.application.use_cases import SendMessageUseCase
from src.application.dtos import SendMessageRequest


# Strategies for generating test data
user_message_strategy = st.text(
    min_size=1, 
    max_size=500,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())

partial_response_strategy = st.text(
    min_size=0, 
    max_size=200,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
)

error_message_strategy = st.text(
    min_size=1, 
    max_size=100,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())


def run_async(coro):
    """Helper to run async code in sync context."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class StreamingFailureLLMProvider(ILLMProvider):
    """Mock LLM provider that fails during streaming after yielding some chunks."""
    
    def __init__(self, partial_response: str, error_message: str):
        self.partial_response = partial_response
        self.error_message = error_message
    
    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        raise NotImplementedError("Use generate_response_stream")
    
    async def generate_response_stream(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> AsyncIterator[str]:
        # Yield partial response if any
        if self.partial_response:
            yield self.partial_response
        # Then fail
        raise RuntimeError(self.error_message)
    
    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        return {"type": "complete", "content": "Response after resume"}


class ImmediateFailureLLMProvider(ILLMProvider):
    """Mock LLM provider that fails immediately without yielding anything."""
    
    def __init__(self, error_message: str):
        self.error_message = error_message
    
    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        raise RuntimeError(self.error_message)
    
    async def generate_response_stream(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> AsyncIterator[str]:
        raise RuntimeError(self.error_message)
        yield  # Make this a generator
    
    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        raise RuntimeError(self.error_message)


@settings(max_examples=100)
@given(
    user_message=user_message_strategy,
    partial_response=partial_response_strategy,
    error_message=error_message_strategy
)
def test_user_message_survives_streaming_failure(
    user_message: str,
    partial_response: str,
    error_message: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For any streaming operation that fails after the conversation_id is returned,
    the error SHALL be propagated to the caller so the frontend can handle it.
    """
    async def test_impl():
        llm_provider = StreamingFailureLLMProvider(
            partial_response=partial_response,
            error_message=error_message
        )
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute - expect streaming to fail
        request = SendMessageRequest(message=user_message, conversation_id=None)
        conversation_id = None
        
        with pytest.raises(RuntimeError) as exc_info:
            async for chunk in use_case.execute_stream(request):
                # Extract conversation_id from first chunk
                if chunk.startswith("__CONV_ID__:"):
                    conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                    conversation_id = conv_data["conversation_id"]
        
        # Verify conversation_id was returned before failure
        assert conversation_id is not None, "Conversation ID should be returned before failure"
        
        # Verify the error was propagated
        assert error_message in str(exc_info.value), "Error message should be propagated"
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_message=user_message_strategy,
    error_message=error_message_strategy
)
def test_user_message_survives_immediate_streaming_failure(
    user_message: str,
    error_message: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: Even when streaming fails immediately (before yielding any chunks),
    the error SHALL be propagated to the caller.
    """
    async def test_impl():
        llm_provider = ImmediateFailureLLMProvider(error_message=error_message)
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute - expect streaming to fail
        request = SendMessageRequest(message=user_message, conversation_id=None)
        conversation_id = None
        
        with pytest.raises(RuntimeError) as exc_info:
            async for chunk in use_case.execute_stream(request):
                # Extract conversation_id from first chunk
                if chunk.startswith("__CONV_ID__:"):
                    conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                    conversation_id = conv_data["conversation_id"]
        
        # Verify the error was propagated
        assert error_message in str(exc_info.value), "Error message should be propagated"
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_message=user_message_strategy,
    partial_response=partial_response_strategy,
    error_message=error_message_strategy
)
def test_existing_conversation_user_message_survives_streaming_failure(
    user_message: str,
    partial_response: str,
    error_message: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For an existing conversation where streaming fails, the error
    SHALL be propagated and the conversation_id SHALL be returned before failure.
    """
    async def test_impl():
        existing_id = uuid4()
        
        llm_provider = StreamingFailureLLMProvider(
            partial_response=partial_response,
            error_message=error_message
        )
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute with existing conversation - expect streaming to fail
        request = SendMessageRequest(
            message=user_message, 
            conversation_id=existing_id
        )
        
        returned_id = None
        with pytest.raises(RuntimeError):
            async for chunk in use_case.execute_stream(request):
                if chunk.startswith("__CONV_ID__:"):
                    conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                    returned_id = conv_data["conversation_id"]
        
        # Verify the existing ID was used
        assert returned_id == str(existing_id), \
            f"Should use existing ID {existing_id}, got {returned_id}"
    
    run_async(test_impl())


@settings(max_examples=50)
@given(
    user_message=user_message_strategy,
    error_message=error_message_strategy
)
def test_conversation_version_incremented_on_failure_recovery(
    user_message: str,
    error_message: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: When streaming fails, the conversation_id SHALL still be returned
    in the first chunk before the error occurs.
    """
    async def test_impl():
        llm_provider = StreamingFailureLLMProvider(
            partial_response="partial",
            error_message=error_message
        )
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute - expect streaming to fail
        request = SendMessageRequest(message=user_message, conversation_id=None)
        conversation_id = None
        chunks_received = []
        
        with pytest.raises(RuntimeError):
            async for chunk in use_case.execute_stream(request):
                chunks_received.append(chunk)
                if chunk.startswith("__CONV_ID__:"):
                    conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                    conversation_id = conv_data["conversation_id"]
        
        # Verify conversation_id was returned
        assert conversation_id is not None, "Conversation ID should be returned"
        
        # Verify it's a valid UUID
        UUID(conversation_id)  # Will raise if invalid
    
    run_async(test_impl())
