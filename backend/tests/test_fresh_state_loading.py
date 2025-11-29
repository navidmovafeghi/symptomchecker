"""Property-based tests for resume conversation use case.

**Feature: client-side-storage, Property 7: Resume sends conversation context**
**Validates: Requirements 3.4, 4.2, 4.4**

With client-side storage, conversations are stored in IndexedDB on the frontend.
The ResumeConversationUseCase only handles the LLM resume operation using server checkpoints.
No server-side conversation storage - frontend handles persistence.
"""
import pytest
from hypothesis import given, strategies as st, settings
from datetime import datetime, timezone
from uuid import uuid4, UUID
import asyncio
from typing import List, Dict, Any, Optional

from src.domain.entities import Conversation, Message
from src.domain.interfaces import ILLMProvider
from src.application.use_cases import ResumeConversationUseCase
from src.application.dtos import ResumeConversationRequest


# Strategies for generating test data
user_input_strategy = st.text(
    min_size=1, 
    max_size=200,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())

assistant_response_strategy = st.text(
    min_size=5, 
    max_size=300,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())


def run_async(coro):
    """Helper to run async code in sync context."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class StateCapturingLLMProvider(ILLMProvider):
    """Mock LLM provider that captures the resume call parameters."""
    
    def __init__(self, response: str, response_type: str = "complete"):
        self.response = response
        self.response_type = response_type
        self.captured_messages: List[dict] = []
        self.resume_called = False
        self.resume_thread_id: Optional[str] = None
        self.resume_user_input: Optional[str] = None
    
    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        self.captured_messages = messages
        return self.response
    
    async def generate_response_stream(self, messages: List[dict], thread_id: Optional[str] = None):
        self.captured_messages = messages
        yield self.response
    
    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        self.resume_called = True
        self.resume_thread_id = thread_id
        self.resume_user_input = user_input
        if self.response_type == "interrupt":
            return {"type": "interrupt", "question": self.response, "options": ["Option A", "Option B"]}
        return {"type": "complete", "content": self.response}


@settings(max_examples=100)
@given(
    user_input=user_input_strategy,
    final_response=assistant_response_strategy
)
def test_resume_calls_llm_provider_with_correct_params(
    user_input: str,
    final_response: str
):
    """
    **Feature: client-side-storage, Property 7: Resume sends conversation context**
    **Validates: Requirements 3.4, 4.2**
    
    Property: For any resume operation, the system SHALL call the LLM provider's
    resume method with the correct thread_id and user_input.
    """
    async def test_impl():
        thread_id = str(uuid4())
        
        llm_provider = StateCapturingLLMProvider(response=final_response)
        use_case = ResumeConversationUseCase(llm_provider=llm_provider)
        
        # Execute resume
        request = ResumeConversationRequest(
            thread_id=thread_id,
            user_input=user_input
        )
        result = await use_case.execute(request)
        
        # Verify the LLM provider's resume was called with correct params
        assert llm_provider.resume_called, "LLM provider resume should be called"
        assert llm_provider.resume_thread_id == thread_id, \
            f"Thread ID should be {thread_id}, got {llm_provider.resume_thread_id}"
        assert llm_provider.resume_user_input == user_input, \
            f"User input should be {user_input}, got {llm_provider.resume_user_input}"
        
        # Verify the response
        assert result.type == "complete"
        assert result.content == final_response
        assert str(result.conversation_id) == thread_id
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_input=user_input_strategy,
    question=assistant_response_strategy
)
def test_resume_handles_interrupt_response(
    user_input: str,
    question: str
):
    """
    **Feature: client-side-storage, Property 7: Resume sends conversation context**
    **Validates: Requirements 3.4, 4.4**
    
    Property: For any resume operation that results in another interrupt,
    the system SHALL return the interrupt response with question and options.
    """
    async def test_impl():
        thread_id = str(uuid4())
        
        llm_provider = StateCapturingLLMProvider(response=question, response_type="interrupt")
        use_case = ResumeConversationUseCase(llm_provider=llm_provider)
        
        # Execute resume
        request = ResumeConversationRequest(
            thread_id=thread_id,
            user_input=user_input
        )
        result = await use_case.execute(request)
        
        # Verify the interrupt response
        assert result.type == "interrupt"
        assert result.question == question
        assert result.options == ["Option A", "Option B"]
        assert str(result.conversation_id) == thread_id
    
    run_async(test_impl())


@settings(max_examples=50)
@given(
    user_input=user_input_strategy
)
def test_resume_validates_empty_input(user_input: str):
    """
    **Feature: client-side-storage, Property 7: Resume sends conversation context**
    **Validates: Requirements 3.4**
    
    Property: For any resume operation with empty user input,
    the system SHALL raise an InvalidMessageException.
    """
    async def test_impl():
        from src.domain.exceptions import InvalidMessageException
        
        thread_id = str(uuid4())
        llm_provider = StateCapturingLLMProvider(response="test")
        use_case = ResumeConversationUseCase(llm_provider=llm_provider)
        
        # Test with whitespace-only input
        request = ResumeConversationRequest(
            thread_id=thread_id,
            user_input="   "  # whitespace only
        )
        
        with pytest.raises(InvalidMessageException):
            await use_case.execute(request)
        
        # Verify LLM provider was not called
        assert not llm_provider.resume_called, "LLM provider should not be called for empty input"
    
    run_async(test_impl())
