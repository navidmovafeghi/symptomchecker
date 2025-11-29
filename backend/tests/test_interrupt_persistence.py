"""Property-based tests for SendMessageUseCase streaming.

**Feature: client-side-storage, Property 5: API requests include conversation history**
**Validates: Requirements 3.1**

With client-side storage, conversations are stored in IndexedDB on the frontend.
The SendMessageUseCase processes messages and generates AI responses without
server-side conversation storage. Frontend handles persistence.
"""
import pytest
from hypothesis import given, strategies as st, settings
from datetime import datetime, timezone
from uuid import uuid4
import asyncio
import json
from typing import List, Dict, Any, AsyncIterator, Optional
from unittest.mock import AsyncMock

from src.domain.entities import Conversation, Message
from src.domain.interfaces import ILLMProvider
from src.application.use_cases import SendMessageUseCase
from src.application.dtos import SendMessageRequest, HistoryMessage


# Strategies for generating test data
clarification_question_strategy = st.text(
    min_size=5, 
    max_size=200,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())

options_strategy = st.lists(
    st.text(min_size=1, max_size=50, alphabet=st.characters(whitelist_categories=('L', 'N'))).filter(lambda x: x.strip()),
    min_size=0,
    max_size=5
)

user_message_strategy = st.text(
    min_size=1, 
    max_size=500,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())


def run_async(coro):
    """Helper to run async code in sync context."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class MockInterruptLLMProvider(ILLMProvider):
    """Mock LLM provider that always returns an interrupt response."""
    
    def __init__(self, question: str, options: List[str]):
        self.question = question
        self.options = options
        self.thread_id = None
        self.received_messages: List[dict] = []
    
    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        self.received_messages = messages
        raise NotImplementedError("Use generate_response_stream")
    
    async def generate_response_stream(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> AsyncIterator[str]:
        self.thread_id = thread_id
        self.received_messages = messages
        # Yield interrupt JSON response
        interrupt_json = json.dumps({
            "type": "interrupt",
            "question": self.question,
            "options": self.options,
            "thread_id": thread_id or str(uuid4())
        })
        yield interrupt_json
    
    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        return {"type": "complete", "content": "Response after resume"}


class MockNormalLLMProvider(ILLMProvider):
    """Mock LLM provider that returns a normal (non-interrupt) response."""
    
    def __init__(self, response: str):
        self.response = response
        self.received_messages: List[dict] = []
    
    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        self.received_messages = messages
        return self.response
    
    async def generate_response_stream(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> AsyncIterator[str]:
        self.received_messages = messages
        yield self.response
    
    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        return {"type": "complete", "content": self.response}


@settings(max_examples=100)
@given(
    user_message=user_message_strategy,
    clarification_question=clarification_question_strategy,
    options=options_strategy
)
def test_stream_returns_conversation_id_and_interrupt(
    user_message: str,
    clarification_question: str,
    options: List[str]
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For any streaming message request, the system SHALL return
    a conversation_id in the first chunk and stream the LLM response.
    """
    async def test_impl():
        llm_provider = MockInterruptLLMProvider(
            question=clarification_question,
            options=options
        )
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute - consume all chunks from the stream
        request = SendMessageRequest(message=user_message, conversation_id=None)
        chunks = []
        conversation_id = None
        
        async for chunk in use_case.execute_stream(request):
            chunks.append(chunk)
            # Extract conversation_id from first chunk
            if chunk.startswith("__CONV_ID__:"):
                conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                conversation_id = conv_data["conversation_id"]
        
        # Verify conversation_id was returned
        assert conversation_id is not None, "Conversation ID should be returned"
        
        # Verify interrupt response was streamed
        response_chunks = [c for c in chunks if not c.startswith("__CONV_ID__:")]
        assert len(response_chunks) >= 1, "Should have response chunks"
        
        # Parse the interrupt response
        interrupt_data = json.loads(response_chunks[0])
        assert interrupt_data["type"] == "interrupt"
        assert interrupt_data["question"] == clarification_question
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_message=user_message_strategy,
    normal_response=st.text(min_size=5, max_size=200).filter(lambda x: x.strip())
)
def test_stream_includes_conversation_history(
    user_message: str,
    normal_response: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For any message request with conversation_history, the system
    SHALL include that history when calling the LLM provider.
    """
    async def test_impl():
        llm_provider = MockNormalLLMProvider(response=normal_response)
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Create conversation history
        history = [
            HistoryMessage(role="user", content="Previous question"),
            HistoryMessage(role="assistant", content="Previous answer")
        ]
        
        # Execute with history
        request = SendMessageRequest(
            message=user_message, 
            conversation_id=uuid4(),
            conversation_history=history
        )
        
        async for chunk in use_case.execute_stream(request):
            pass  # Consume all chunks
        
        # Verify LLM received the history plus new message
        assert len(llm_provider.received_messages) == 3, \
            f"LLM should receive 3 messages (2 history + 1 new), got {len(llm_provider.received_messages)}"
        
        # Verify history messages
        assert llm_provider.received_messages[0]["content"] == "Previous question"
        assert llm_provider.received_messages[1]["content"] == "Previous answer"
        assert llm_provider.received_messages[2]["content"] == user_message
    
    run_async(test_impl())


@settings(max_examples=50)
@given(
    user_message=user_message_strategy,
    normal_response=st.text(min_size=5, max_size=200).filter(lambda x: x.strip())
)
def test_stream_generates_new_conversation_id_when_not_provided(
    user_message: str,
    normal_response: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For any message request without a conversation_id, the system
    SHALL generate a new UUID for the conversation.
    """
    async def test_impl():
        llm_provider = MockNormalLLMProvider(response=normal_response)
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute without conversation_id
        request = SendMessageRequest(message=user_message, conversation_id=None)
        conversation_id = None
        
        async for chunk in use_case.execute_stream(request):
            if chunk.startswith("__CONV_ID__:"):
                conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                conversation_id = conv_data["conversation_id"]
        
        # Verify a valid UUID was generated
        assert conversation_id is not None, "Conversation ID should be generated"
        from uuid import UUID
        UUID(conversation_id)  # This will raise if not a valid UUID
    
    run_async(test_impl())


@settings(max_examples=50)
@given(
    user_message=user_message_strategy,
    normal_response=st.text(min_size=5, max_size=200).filter(lambda x: x.strip())
)
def test_stream_uses_provided_conversation_id(
    user_message: str,
    normal_response: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For any message request with a conversation_id, the system
    SHALL use that ID in the response.
    """
    async def test_impl():
        llm_provider = MockNormalLLMProvider(response=normal_response)
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute with specific conversation_id
        provided_id = uuid4()
        request = SendMessageRequest(message=user_message, conversation_id=provided_id)
        returned_id = None
        
        async for chunk in use_case.execute_stream(request):
            if chunk.startswith("__CONV_ID__:"):
                conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                returned_id = conv_data["conversation_id"]
        
        # Verify the provided ID was used
        assert returned_id == str(provided_id), \
            f"Should use provided ID {provided_id}, got {returned_id}"
    
    run_async(test_impl())
