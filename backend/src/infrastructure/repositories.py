"""Repository implementations - swappable storage adapters."""
import json
import aiosqlite
from typing import Dict, List, Optional
from uuid import UUID
from ..domain.interfaces import IConversationRepository
from ..domain.entities import Conversation, Message


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


class SQLiteConversationRepository(IConversationRepository):
    """SQLite implementation of conversation storage for persistence."""

    def __init__(self, db_path: str = "conversations.db"):
        self.db_path = db_path
        self._initialized = False

    async def _ensure_initialized(self) -> None:
        """Create tables if they don't exist."""
        if self._initialized:
            return
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    messages TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_conversations_updated_at 
                ON conversations(updated_at DESC)
            """)
            await db.commit()
        self._initialized = True

    async def save(self, conversation: Conversation) -> None:
        """Save or update a conversation in SQLite."""
        await self._ensure_initialized()
        
        # Serialize messages to JSON
        messages_json = json.dumps([
            {
                "id": str(msg.id),
                "role": msg.role,
                "content": msg.content,
                "timestamp": msg.timestamp.isoformat()
            }
            for msg in conversation.messages
        ])
        
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                INSERT OR REPLACE INTO conversations (id, title, messages, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
            """, (
                str(conversation.id),
                conversation.title,
                messages_json,
                conversation.created_at.isoformat(),
                conversation.updated_at.isoformat()
            ))
            await db.commit()

    async def get_by_id(self, conversation_id: UUID) -> Optional[Conversation]:
        """Retrieve a conversation by ID from SQLite."""
        await self._ensure_initialized()
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM conversations WHERE id = ?",
                (str(conversation_id),)
            ) as cursor:
                row = await cursor.fetchone()
                if not row:
                    return None
                return self._row_to_conversation(row)

    async def delete(self, conversation_id: UUID) -> bool:
        """Delete a conversation from SQLite."""
        await self._ensure_initialized()
        
        async with aiosqlite.connect(self.db_path) as db:
            cursor = await db.execute(
                "DELETE FROM conversations WHERE id = ?",
                (str(conversation_id),)
            )
            await db.commit()
            return cursor.rowcount > 0

    async def list_all(self) -> List[Conversation]:
        """List all conversations ordered by most recent."""
        await self._ensure_initialized()
        
        async with aiosqlite.connect(self.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM conversations ORDER BY updated_at DESC"
            ) as cursor:
                rows = await cursor.fetchall()
                return [self._row_to_conversation(row) for row in rows]

    def _row_to_conversation(self, row) -> Conversation:
        """Convert a database row to a Conversation entity."""
        from datetime import datetime
        
        messages_data = json.loads(row["messages"])
        messages = [
            Message(
                id=UUID(msg["id"]),
                role=msg["role"],
                content=msg["content"],
                timestamp=datetime.fromisoformat(msg["timestamp"])
            )
            for msg in messages_data
        ]
        
        return Conversation(
            id=UUID(row["id"]),
            title=row["title"],
            messages=messages,
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"])
        )
