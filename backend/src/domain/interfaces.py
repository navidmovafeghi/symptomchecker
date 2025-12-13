"""Domain interfaces - ports for infrastructure adapters."""
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any, AsyncIterator


class ILLMProvider(ABC):
    """Interface for LLM providers (swappable)."""

    @abstractmethod
    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        """Generate a response from the LLM.

        Args:
            messages: List of message dicts with 'role' and 'content'
            thread_id: Optional thread ID for state persistence

        Returns:
            Generated response content
        """
        pass

    @abstractmethod
    def generate_response_stream(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> AsyncIterator[str]:
        """Generate a streaming response from the LLM.

        Args:
            messages: List of message dicts with 'role' and 'content'
            thread_id: Optional thread ID for state persistence

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

    def resume_stream(self, thread_id: str, user_input: str) -> AsyncIterator[str]:
        """Resume an interrupted conversation with streaming stage updates.

        Args:
            thread_id: Unique thread identifier for the conversation
            user_input: User's response to clarification question

        Yields:
            Stage indicator JSON messages followed by final result
        """
        raise NotImplementedError("This provider does not support streaming resume")


class ICheckpointManager(ABC):
    """Interface for managing LangGraph checkpoint data."""

    @abstractmethod
    async def delete_checkpoint(self, thread_id: str) -> bool:
        """Delete checkpoint data for a thread.
        
        Args:
            thread_id: The unique thread identifier for the checkpoint to delete.
            
        Returns:
            True if the checkpoint was deleted, False if it didn't exist.
        """
        pass
