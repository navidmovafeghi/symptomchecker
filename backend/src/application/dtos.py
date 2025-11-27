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


class ResumeConversationRequest(BaseModel):
    """Request to resume an interrupted conversation."""
    thread_id: str = Field(..., description="Thread ID (same as conversation_id)")
    user_input: str = Field(..., min_length=1, description="User's response to clarification")


class ResumeConversationResponse(BaseModel):
    """Response after resuming a conversation."""
    type: str  # "interrupt" or "complete"
    question: Optional[str] = None  # For interrupt
    options: Optional[List[str]] = None  # For interrupt
    content: Optional[str] = None  # For complete
    conversation_id: UUID
