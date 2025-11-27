"""Domain entities - core business objects."""
from datetime import datetime
from typing import List, Literal
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
    messages: List[Message] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def add_message(self, message: Message) -> "Conversation":
        """Add a message and return a new Conversation instance."""
        return self.model_copy(
            update={
                "messages": self.messages + [message],
                "updated_at": datetime.utcnow()
            }
        )

    def get_messages_for_llm(self) -> List[dict]:
        """Format messages for LLM API."""
        return [
            {"role": msg.role, "content": msg.content}
            for msg in self.messages
        ]
