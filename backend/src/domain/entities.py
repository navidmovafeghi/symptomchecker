"""Domain entities - core business objects."""
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID, uuid4
from pydantic import BaseModel, Field


MessageRole = Literal["user", "assistant", "system"]


class Message(BaseModel):
    """Represents a single message in a conversation."""
    id: UUID = Field(default_factory=uuid4)
    role: MessageRole
    content: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        frozen = True  # Immutable


class Conversation(BaseModel):
    """Represents a conversation with multiple messages."""
    id: UUID = Field(default_factory=uuid4)
    title: Optional[str] = None  # Auto-generated from first user message
    messages: List[Message] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    version: int = 1  # For optimistic locking
    has_pending_response: bool = False  # Tracks incomplete responses

    def add_message(self, message: Message) -> "Conversation":
        """Add a message and return a new Conversation instance.
        
        Preserves the version number - version is only incremented on save.
        """
        updates = {
            "messages": self.messages + [message],
            "updated_at": datetime.utcnow(),
            "version": self.version,  # Preserve version
        }
        # Auto-generate title from first user message
        if self.title is None and message.role == "user":
            updates["title"] = message.content[:50] + ("..." if len(message.content) > 50 else "")
        return self.model_copy(update=updates)

    def get_messages_for_llm(self) -> List[dict]:
        """Format messages for LLM API."""
        return [
            {"role": msg.role, "content": msg.content}
            for msg in self.messages
        ]
    
    def get_thread_id(self) -> str:
        """Get thread_id for LangGraph (uses conversation id)."""
        return str(self.id)
