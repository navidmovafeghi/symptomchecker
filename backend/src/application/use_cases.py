"""Application use cases - orchestrate domain logic."""
from uuid import UUID
from ..domain.entities import Message, Conversation
from ..domain.interfaces import ILLMProvider, IConversationRepository
from ..domain.exceptions import (
    ConversationNotFoundException,
    InvalidMessageException
)
from .dtos import (
    SendMessageRequest,
    SendMessageResponse,
    ConversationResponse,
    ConversationListResponse,
    ConversationSummary,
    MessageResponse,
    ResumeConversationRequest,
    ResumeConversationResponse
)


class SendMessageUseCase:
    """Use case for sending a message and getting a response."""

    def __init__(
        self,
        llm_provider: ILLMProvider,
        conversation_repository: IConversationRepository
    ):
        self.llm_provider = llm_provider
        self.conversation_repository = conversation_repository

    async def execute(
        self, request: SendMessageRequest
    ) -> SendMessageResponse:
        """Execute the use case."""
        # Validate input
        if not request.message.strip():
            raise InvalidMessageException("Message cannot be empty")

        # Get or create conversation
        if request.conversation_id:
            conversation = await self.conversation_repository.get_by_id(
                request.conversation_id
            )
            if not conversation:
                raise ConversationNotFoundException(
                    f"Conversation {request.conversation_id} not found"
                )
        else:
            conversation = Conversation()

        # Create user message
        user_message = Message(role="user", content=request.message)
        conversation = conversation.add_message(user_message)

        # Generate AI response
        messages_for_llm = conversation.get_messages_for_llm()
        assistant_content = await self.llm_provider.generate_response(
            messages_for_llm
        )

        # Create assistant message
        assistant_message = Message(
            role="assistant", content=assistant_content
        )
        conversation = conversation.add_message(assistant_message)

        # Save conversation
        await self.conversation_repository.save(conversation)

        return SendMessageResponse(
            conversation_id=conversation.id,
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
        
        # Validate input
        if not request.message.strip():
            raise InvalidMessageException("Message cannot be empty")

        # Get or create conversation
        if request.conversation_id:
            conversation = await self.conversation_repository.get_by_id(
                request.conversation_id
            )
            if not conversation:
                raise ConversationNotFoundException(
                    f"Conversation {request.conversation_id} not found"
                )
        else:
            conversation = Conversation()

        # Create user message
        user_message = Message(role="user", content=request.message)
        conversation = conversation.add_message(user_message)
        
        # Save conversation immediately to persist the user message
        # This also ensures we have a conversation_id for new conversations
        await self.conversation_repository.save(conversation)
        
        # Yield conversation_id first so frontend can track it
        yield f"__CONV_ID__:{json.dumps({'conversation_id': str(conversation.id)})}\n"

        # Generate AI response (streaming) - use conversation ID as thread_id
        messages_for_llm = conversation.get_messages_for_llm()
        thread_id = conversation.get_thread_id()

        # Collect chunks for final storage
        full_response = ""
        async for chunk in self.llm_provider.generate_response_stream(
            messages_for_llm, thread_id=thread_id
        ):
            full_response += chunk
            yield chunk

        # Create assistant message with full response (skip if it's an interrupt JSON)
        if full_response and not full_response.startswith('{"type":'):
            assistant_message = Message(
                role="assistant", content=full_response
            )
            conversation = conversation.add_message(assistant_message)
            # Save conversation with assistant response
            await self.conversation_repository.save(conversation)


class GetConversationHistoryUseCase:
    """Use case for retrieving conversation history."""

    def __init__(self, conversation_repository: IConversationRepository):
        self.conversation_repository = conversation_repository

    async def execute(self, conversation_id: UUID) -> ConversationResponse:
        """Execute the use case."""
        conversation = await self.conversation_repository.get_by_id(
            conversation_id
        )

        if not conversation:
            raise ConversationNotFoundException(
                f"Conversation {conversation_id} not found"
            )

        return ConversationResponse(
            id=conversation.id,
            title=conversation.title,
            messages=[
                MessageResponse(
                    id=msg.id,
                    role=msg.role,
                    content=msg.content,
                    timestamp=msg.timestamp
                )
                for msg in conversation.messages
            ],
            created_at=conversation.created_at,
            updated_at=conversation.updated_at
        )


class DeleteConversationUseCase:
    """Use case for deleting a conversation."""

    def __init__(self, conversation_repository: IConversationRepository):
        self.conversation_repository = conversation_repository

    async def execute(self, conversation_id: UUID) -> bool:
        """Execute the use case."""
        return await self.conversation_repository.delete(conversation_id)


class ListConversationsUseCase:
    """Use case for listing all conversations."""

    def __init__(self, conversation_repository: IConversationRepository):
        self.conversation_repository = conversation_repository

    async def execute(self) -> ConversationListResponse:
        """Execute the use case."""
        conversations = await self.conversation_repository.list_all()
        
        return ConversationListResponse(
            conversations=[
                ConversationSummary(
                    id=conv.id,
                    title=conv.title,
                    created_at=conv.created_at,
                    updated_at=conv.updated_at,
                    message_count=len(conv.messages)
                )
                for conv in conversations
            ]
        )


class ResumeConversationUseCase:
    """Use case for resuming an interrupted conversation."""

    def __init__(
        self,
        llm_provider: ILLMProvider,
        conversation_repository: IConversationRepository
    ):
        self.llm_provider = llm_provider
        self.conversation_repository = conversation_repository

    async def execute(self, request: ResumeConversationRequest) -> ResumeConversationResponse:
        """Resume an interrupted conversation with user's clarification.
        
        This persists both the user's answer and the AI's response to the conversation.
        """
        # Validate input
        if not request.user_input.strip():
            raise InvalidMessageException("User input cannot be empty")

        # thread_id equals conversation_id
        try:
            conversation_id = UUID(request.thread_id)
        except ValueError:
            raise InvalidMessageException(f"Invalid thread_id format: {request.thread_id}")

        # Load conversation
        conversation = await self.conversation_repository.get_by_id(conversation_id)
        if not conversation:
            raise ConversationNotFoundException(
                f"Conversation {conversation_id} not found"
            )

        # Add user's answer as a message
        user_message = Message(role="user", content=request.user_input)
        conversation = conversation.add_message(user_message)
        
        # Save conversation with user message
        await self.conversation_repository.save(conversation)

        # Call LLM provider's resume
        result = await self.llm_provider.resume(request.thread_id, request.user_input)

        if result.get("type") == "interrupt":
            # Another clarification needed - save the question as assistant message
            question = result.get("question", "")
            assistant_message = Message(role="assistant", content=question)
            conversation = conversation.add_message(assistant_message)
            await self.conversation_repository.save(conversation)

            return ResumeConversationResponse(
                type="interrupt",
                question=question,
                options=result.get("options", []),
                conversation_id=conversation_id
            )
        else:
            # Complete - save the final response
            content = result.get("content", "")
            assistant_message = Message(role="assistant", content=content)
            conversation = conversation.add_message(assistant_message)
            await self.conversation_repository.save(conversation)

            return ResumeConversationResponse(
                type="complete",
                content=content,
                conversation_id=conversation_id
            )
