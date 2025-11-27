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
    MessageResponse
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
        """Execute the use case with streaming response."""
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

        # Generate AI response (streaming)
        messages_for_llm = conversation.get_messages_for_llm()

        # Collect chunks for final storage
        full_response = ""
        async for chunk in self.llm_provider.generate_response_stream(
            messages_for_llm
        ):
            full_response += chunk
            yield chunk

        # Create assistant message with full response
        assistant_message = Message(
            role="assistant", content=full_response
        )
        conversation = conversation.add_message(assistant_message)

        # Save conversation
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
