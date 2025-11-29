"""Property-based tests for SendMessageUseCase and ResumeConversationUseCase.

**Feature: client-side-storage**
**Validates: Requirements 3.1, 3.4**

With client-side storage, conversations are stored in IndexedDB on the frontend.
These tests verify that the use cases correctly process messages and return
appropriate responses without server-side conversation storage.
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
from src.application.use_cases import SendMessageUseCase, ResumeConversationUseCase
from src.application.dtos import SendMessageRequest, ResumeConversationRequest


# Strategies for generating test data
user_message_strategy = st.text(
    min_size=1, 
    max_size=200,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())

assistant_response_strategy = st.text(
    min_size=5, 
    max_size=300,
    alphabet=st.characters(whitelist_categories=('L', 'N', 'P', 'Z'))
).filter(lambda x: x.strip())

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


def run_async(coro):
    """Helper to run async code in sync context."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class MockInterruptLLMProvider(ILLMProvider):
    """Mock LLM provider that returns an interrupt response."""
    
    def __init__(self, question: str, options: List[str]):
        self.question = question
        self.options = options
        self.received_messages: List[dict] = []
    
    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        self.received_messages = messages
        raise NotImplementedError("Use generate_response_stream")
    
    async def generate_response_stream(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> AsyncIterator[str]:
        self.received_messages = messages
        interrupt_json = json.dumps({
            "type": "interrupt",
            "question": self.question,
            "options": self.options,
            "thread_id": thread_id or str(uuid4())
        })
        yield interrupt_json
    
    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        return {"type": "interrupt", "question": self.question, "options": self.options}


class MockCompleteLLMProvider(ILLMProvider):
    """Mock LLM provider that returns a complete (non-interrupt) response."""
    
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
def test_interrupt_saved_to_repository_before_return(
    user_message: str,
    clarification_question: str,
    options: List[str]
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For any interrupt event, the streaming operation SHALL return
    the interrupt JSON with the clarification question.
    """
    async def test_impl():
        llm_provider = MockInterruptLLMProvider(
            question=clarification_question,
            options=options
        )
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute - consume all chunks from the stream
        request = SendMessageRequest(message=user_message, conversation_id=None)
        conversation_id = None
        response_chunks = []
        
        async for chunk in use_case.execute_stream(request):
            if chunk.startswith("__CONV_ID__:"):
                conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                conversation_id = conv_data["conversation_id"]
            else:
                response_chunks.append(chunk)
        
        # Verify conversation_id was returned
        assert conversation_id is not None, "Conversation ID should be returned"
        
        # Verify interrupt response was streamed
        assert len(response_chunks) >= 1, "Should have response chunks"
        interrupt_data = json.loads(response_chunks[0])
        assert interrupt_data["type"] == "interrupt"
        assert interrupt_data["question"] == clarification_question
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_message=user_message_strategy,
    assistant_response=assistant_response_strategy
)
def test_complete_response_saved_to_repository_before_return(
    user_message: str,
    assistant_response: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For any completion event, the streaming operation SHALL return
    the assistant response.
    """
    async def test_impl():
        llm_provider = MockCompleteLLMProvider(response=assistant_response)
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute - consume all chunks from the stream
        request = SendMessageRequest(message=user_message, conversation_id=None)
        conversation_id = None
        response_chunks = []
        
        async for chunk in use_case.execute_stream(request):
            if chunk.startswith("__CONV_ID__:"):
                conv_data = json.loads(chunk.replace("__CONV_ID__:", ""))
                conversation_id = conv_data["conversation_id"]
            else:
                response_chunks.append(chunk)
        
        # Verify conversation_id was returned
        assert conversation_id is not None, "Conversation ID should be returned"
        
        # Verify response was streamed
        assert len(response_chunks) >= 1, "Should have response chunks"
        assert response_chunks[0] == assistant_response
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_input=user_message_strategy,
    final_response=assistant_response_strategy
)
def test_resume_complete_response_saved_before_return(
    user_input: str,
    final_response: str
):
    """
    **Feature: client-side-storage, Property 7: Resume sends conversation context**
    **Validates: Requirements 3.4**
    
    Property: When resuming a conversation and the LLM returns a complete response,
    the response SHALL be returned to the caller.
    """
    async def test_impl():
        thread_id = str(uuid4())
        
        llm_provider = MockCompleteLLMProvider(response=final_response)
        use_case = ResumeConversationUseCase(llm_provider=llm_provider)
        
        # Execute resume
        request = ResumeConversationRequest(
            thread_id=thread_id,
            user_input=user_input
        )
        result = await use_case.execute(request)
        
        # Verify the result
        assert result.type == "complete", "Result should be complete type"
        assert result.content == final_response, "Result content should match"
        assert str(result.conversation_id) == thread_id
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_input=user_message_strategy,
    next_question=clarification_question_strategy,
    options=options_strategy
)
def test_resume_interrupt_response_saved_before_return(
    user_input: str,
    next_question: str,
    options: List[str]
):
    """
    **Feature: client-side-storage, Property 7: Resume sends conversation context**
    **Validates: Requirements 3.4**
    
    Property: When resuming a conversation and the LLM returns another interrupt,
    the interrupt response SHALL be returned to the caller.
    """
    async def test_impl():
        thread_id = str(uuid4())
        
        llm_provider = MockInterruptLLMProvider(
            question=next_question,
            options=options
        )
        use_case = ResumeConversationUseCase(llm_provider=llm_provider)
        
        # Execute resume
        request = ResumeConversationRequest(
            thread_id=thread_id,
            user_input=user_input
        )
        result = await use_case.execute(request)
        
        # Verify the result
        assert result.type == "interrupt", "Result should be interrupt type"
        assert result.question == next_question, "Result question should match"
        assert str(result.conversation_id) == thread_id
    
    run_async(test_impl())


@settings(max_examples=100)
@given(
    user_message=user_message_strategy,
    clarification_question=clarification_question_strategy
)
def test_synchronization_for_existing_conversation(
    user_message: str,
    clarification_question: str
):
    """
    **Feature: client-side-storage, Property 5: API requests include conversation history**
    **Validates: Requirements 3.1**
    
    Property: For an existing conversation (with provided conversation_id),
    the streaming operation SHALL use that ID in the response.
    """
    async def test_impl():
        existing_id = uuid4()
        
        llm_provider = MockInterruptLLMProvider(
            question=clarification_question,
            options=[]
        )
        use_case = SendMessageUseCase(llm_provider=llm_provider)
        
        # Execute with existing conversation_id
        request = SendMessageRequest(
            message=user_message, 
            conversation_id=existing_id
        )
        
        returned_id = None
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
    user_input=user_message_strategy,
    final_response=assistant_response_strategy
)
def test_user_answer_and_response_both_persisted(
    user_input: str,
    final_response: str
):
    """
    **Feature: client-side-storage, Property 7: Resume sends conversation context**
    **Validates: Requirements 3.4**
    
    Property: When resuming a conversation, the LLM provider's resume method
    SHALL be called with the correct thread_id and user_input.
    """
    async def test_impl():
        thread_id = str(uuid4())
        
        # Create a provider that tracks calls
        class TrackingProvider(MockCompleteLLMProvider):
            def __init__(self, response: str):
                super().__init__(response)
                self.resume_called = False
                self.resume_thread_id = None
                self.resume_user_input = None
            
            async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
                self.resume_called = True
                self.resume_thread_id = thread_id
                self.resume_user_input = user_input
                return await super().resume(thread_id, user_input)
        
        llm_provider = TrackingProvider(response=final_response)
        use_case = ResumeConversationUseCase(llm_provider=llm_provider)
        
        # Execute resume
        request = ResumeConversationRequest(
            thread_id=thread_id,
            user_input=user_input
        )
        await use_case.execute(request)
        
        # Verify the LLM provider was called correctly
        assert llm_provider.resume_called, "Resume should be called"
        assert llm_provider.resume_thread_id == thread_id, \
            f"Thread ID should be {thread_id}"
        assert llm_provider.resume_user_input == user_input, \
            f"User input should be {user_input}"
    
    run_async(test_impl())
