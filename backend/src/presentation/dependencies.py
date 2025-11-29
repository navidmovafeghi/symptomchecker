"""Dependency injection container."""
from functools import lru_cache
from ..infrastructure.medical_chatbot_provider import MedicalChatbotProvider
from ..application.use_cases import (
    SendMessageUseCase,
    DeleteCheckpointUseCase,
    ResumeConversationUseCase
)
from .config import settings


def _create_llm_provider():
    """Factory function to create the appropriate LLM provider."""
    if settings.llm_provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when llm_provider is 'openai'")
        return MedicalChatbotProvider(api_key=settings.openai_api_key)
    else:
        raise ValueError(f"Unknown llm_provider: {settings.llm_provider}. Only 'openai' is supported.")

_llm_provider = _create_llm_provider()


@lru_cache
def get_llm_provider():
    """Get LLM provider instance (swappable via config)."""
    return _llm_provider


def get_checkpoint_manager():
    """Get checkpoint manager instance.
    
    The MedicalChatbotProvider implements ICheckpointManager,
    so we can use the same instance for checkpoint management.
    """
    return _llm_provider


def get_send_message_use_case() -> SendMessageUseCase:
    """Get SendMessageUseCase instance."""
    return SendMessageUseCase(llm_provider=get_llm_provider())


def get_resume_conversation_use_case() -> ResumeConversationUseCase:
    """Get ResumeConversationUseCase instance."""
    return ResumeConversationUseCase(llm_provider=get_llm_provider())


def get_delete_checkpoint_use_case() -> DeleteCheckpointUseCase:
    """Get DeleteCheckpointUseCase instance for checkpoint-only deletion."""
    return DeleteCheckpointUseCase(checkpoint_manager=get_checkpoint_manager())
