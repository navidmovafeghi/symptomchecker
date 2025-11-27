"""Data Transfer Objects for application layer."""
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime


class SendMessageRequest(BaseModel):
    """Request to send a message."""
    conversation_id: UUID | None = None
    message: str = Field(..., min_length=1)


class MessageResponse(BaseModel):
    """Response representing a message."""
    id: UUID
    role: str
    content: str
    timestamp: datetime


class SendMessageResponse(BaseModel):
    """Response after sending a message."""
    conversation_id: UUID
    user_message: MessageResponse
    assistant_message: MessageResponse


class ConversationResponse(BaseModel):
    """Response representing a conversation."""
    id: UUID
    title: Optional[str] = None
    messages: List[MessageResponse]
    created_at: datetime
    updated_at: datetime


class ConversationSummary(BaseModel):
    """Summary of a conversation for listing."""
    id: UUID
    title: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    message_count: int


class ConversationListResponse(BaseModel):
    """Response containing list of conversations."""
    conversations: List[ConversationSummary]
