"""Application use cases - orchestrate domain logic.

With client-side storage migration, conversations are stored in IndexedDB on the frontend.
Server-side use cases handle LLM interactions and checkpoint operations only.
"""
from uuid import UUID
from ..domain.entities import Message, Conversation
from ..domain.interfaces import ILLMProvider, ICheckpointManager
from ..domain.exceptions import InvalidMessageException
from .dtos import (
    SendMessageRequest,
    SendMessageResponse,
    MessageResponse,
    ResumeConversationRequest,
    ResumeConversationResponse
)


class SendMessageUseCase:
    """Use case for sending a message and getting a response.
    
    With client-side storage, conversations are stored in IndexedDB on the frontend.
    This use case only processes messages and generates AI responses.
    Checkpoint operations remain on the server for interrupt/resume.
    """

    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider

    async def execute(self, request: SendMessageRequest) -> SendMessageResponse:
        """Execute the use case.
        
        Processes the message and generates an AI response.
        No server-side conversation storage - frontend handles persistence via IndexedDB.
        """
        from uuid import uuid4
        
        if not request.message.strip():
            raise InvalidMessageException("Message cannot be empty")

        conversation_id = request.conversation_id if request.conversation_id else uuid4()

        conversation = Conversation(id=conversation_id)
        if request.conversation_history:
            for hist_msg in request.conversation_history:
                msg = Message(role=hist_msg.role, content=hist_msg.content)
                conversation = conversation.add_message(msg)

        user_message = Message(role="user", content=request.message)
        temp_conversation = conversation.add_message(user_message)
        messages_for_llm = temp_conversation.get_messages_for_llm()
        
        assistant_content = await self.llm_provider.generate_response(
            messages_for_llm, language=request.language
        )
        assistant_message = Message(role="assistant", content=assistant_content)

        return SendMessageResponse(
            conversation_id=conversation_id,
            user_message=MessageResponse(
                id=user_message.id,
                role=user_message.role,
                content=user_message.content,
                timestamp=user_message.timestamp
            ),
            assistant_message=MessageResponse(
                id=assistant_message.id,
                role=assistant_message.role,
                content=assistant_message.content,
                timestamp=assistant_message.timestamp
            )
        )

    async def execute_stream(self, request: SendMessageRequest):
        """Execute the use case with streaming response.
        
        Yields:
            First chunk: JSON with conversation_id (prefixed with __CONV_ID__:)
            Subsequent chunks: LLM response text or interrupt JSON
        """
        import json
        from uuid import uuid4
        
        if not request.message.strip():
            raise InvalidMessageException("Message cannot be empty")

        conversation_id = request.conversation_id if request.conversation_id else uuid4()
        conversation = Conversation(id=conversation_id)
        
        if request.conversation_history:
            for hist_msg in request.conversation_history:
                msg = Message(role=hist_msg.role, content=hist_msg.content)
                conversation = conversation.add_message(msg)

        user_message = Message(role="user", content=request.message)
        conversation = conversation.add_message(user_message)
        
        yield f"__CONV_ID__:{json.dumps({'conversation_id': str(conversation.id)})}\n"

        messages_for_llm = conversation.get_messages_for_llm()
        thread_id = conversation.get_thread_id()

        async for chunk in self.llm_provider.generate_response_stream(
            messages_for_llm, thread_id=thread_id, language=request.language
        ):
            yield chunk


class DeleteCheckpointUseCase:
    """Use case for deleting only the server checkpoint.
    
    Used when conversations are stored client-side (IndexedDB) and
    we only need to clean up the server checkpoint data.
    """

    def __init__(self, checkpoint_manager: ICheckpointManager):
        self.checkpoint_manager = checkpoint_manager

    async def execute(self, thread_id: str) -> bool:
        """Delete only the checkpoint for a thread.
        
        Args:
            thread_id: The thread ID (same as conversation_id) to delete checkpoint for.
            
        Returns:
            True if the checkpoint was deleted, False if it didn't exist.
        """
        return await self.checkpoint_manager.delete_checkpoint(thread_id)


class ResumeConversationUseCase:
    """Use case for resuming an interrupted conversation.
    
    Handles the LLM resume operation using the server checkpoint.
    No server-side conversation storage - frontend handles persistence.
    """

    def __init__(self, llm_provider: ILLMProvider):
        self.llm_provider = llm_provider

    async def execute_stream(self, request: ResumeConversationRequest):
        """Execute resume with streaming response for stage indicators.
        
        Yields:
            Stage and result chunks from the provider's resume_stream method
        """
        if not request.user_input.strip():
            raise InvalidMessageException("User input cannot be empty")

        async for chunk in self.llm_provider.resume_stream(
            request.thread_id, request.user_input, language=request.language
        ):
            yield chunk

    async def execute(self, request: ResumeConversationRequest) -> ResumeConversationResponse:
        """Resume an interrupted conversation with user's clarification.
        
        Uses the server checkpoint to resume the LangGraph workflow.
        """
        if not request.user_input.strip():
            raise InvalidMessageException("User input cannot be empty")

        try:
            conversation_id = UUID(request.thread_id)
        except ValueError:
            raise InvalidMessageException(f"Invalid thread_id format: {request.thread_id}")

        result = await self.llm_provider.resume(
            request.thread_id, request.user_input, language=request.language
        )

        if result.get("type") == "interrupt":
            return ResumeConversationResponse(
                type="interrupt",
                question=result.get("question", ""),
                options=result.get("options", []),
                conversation_id=conversation_id
            )
        else:
            return ResumeConversationResponse(
                type="complete",
                content=result.get("content", ""),
                conversation_id=conversation_id
            )
