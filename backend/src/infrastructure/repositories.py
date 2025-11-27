"""Repository implementations - swappable storage adapters."""
from typing import Dict, List, Optional
from uuid import UUID
from ..domain.interfaces import IConversationRepository
from ..domain.entities import Conversation


class InMemoryConversationRepository(IConversationRepository):
    """In-memory implementation of conversation storage."""

    def __init__(self):
        self._storage: Dict[UUID, Conversation] = {}

    async def save(self, conversation: Conversation) -> None:
        """Save or update a conversation in memory."""
        self._storage[conversation.id] = conversation

    async def get_by_id(self, conversation_id: UUID) -> Optional[Conversation]:
        """Retrieve a conversation by ID."""
        return self._storage.get(conversation_id)

    async def delete(self, conversation_id: UUID) -> bool:
        """Delete a conversation."""
        if conversation_id in self._storage:
            del self._storage[conversation_id]
            return True
        return False

    async def list_all(self) -> List[Conversation]:
        """List all conversations."""
        return list(self._storage.values())


# Future repositories can be added here:
# class PostgresConversationRepository(IConversationRepository):
#     """PostgreSQL implementation."""
#     pass
#
# class MongoConversationRepository(IConversationRepository):
#     """MongoDB implementation."""
#     pass
