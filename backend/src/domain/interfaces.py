"""Domain interfaces - ports for infrastructure adapters."""
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any, AsyncIterator
from uuid import UUID
from .entities import Conversation, Message


class ILLMProvider(ABC):
    """Interface for LLM providers (swappable)."""

    @abstractmethod
    async def generate_response(self, messages: List[dict]) -> str:
        """Generate a response from the LLM.

        Args:
            messages: List of message dicts with 'role' and 'content'

        Returns:
            Generated response content
        """
        pass

    @abstractmethod
    def generate_response_stream(
        self, messages: List[dict]
    ) -> AsyncIterator[str]:
        """Generate a streaming response from the LLM.

        Args:
            messages: List of message dicts with 'role' and 'content'

        Yields:
            Response chunks
        """
        ...

    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        """Resume an interrupted conversation (optional - for providers with interrupts).

        Args:
            thread_id: Unique thread identifier for the conversation
            user_input: User's response to clarification question

        Returns:
            Dict with 'type' (interrupt/complete) and relevant data
        """
        raise NotImplementedError("This provider does not support resume")


class IConversationRepository(ABC):
    """Interface for conversation storage (swappable)."""

    @abstractmethod
    async def save(self, conversation: Conversation) -> None:
        """Save or update a conversation."""
        pass

    @abstractmethod
    async def get_by_id(self, conversation_id: UUID) -> Optional[Conversation]:
        """Retrieve a conversation by ID."""
        pass

    @abstractmethod
    async def delete(self, conversation_id: UUID) -> bool:
        """Delete a conversation."""
        pass

    @abstractmethod
    async def list_all(self) -> List[Conversation]:
        """List all conversations."""
        pass
