"""Data Transfer Objects for application layer."""
from typing import List, Optional
from uuid import UUID
from pydantic import BaseModel, Field
from datetime import datetime


class HistoryMessage(BaseModel):
    """A message in conversation history sent from client."""
    role: str = Field(..., description="Message role: user, assistant, or system")
    content: str = Field(..., description="Message content")


class SendMessageRequest(BaseModel):
    """Request to send a message."""
    conversation_id: UUID | None = None
    message: str = Field(..., min_length=1)
    conversation_history: Optional[List[HistoryMessage]] = Field(
        default=None,
        description="Full conversation history from client-side storage (IndexedDB)"
    )


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


class ResumeConversationRequest(BaseModel):
    """Request to resume an interrupted conversation."""
    thread_id: str = Field(..., description="Thread ID (same as conversation_id)")
    user_input: str = Field(..., min_length=1, description="User's response to clarification")
    conversation_history: Optional[List[HistoryMessage]] = Field(
        default=None,
        description="Fallback conversation history if server checkpoint is missing"
    )


class ResumeConversationResponse(BaseModel):
    """Response after resuming a conversation."""
    type: str  # "interrupt" or "complete"
    question: Optional[str] = None  # For interrupt
    options: Optional[List[str]] = None  # For interrupt
    content: Optional[str] = None  # For complete
    conversation_id: UUID
