"""Dependency injection container."""
from functools import lru_cache
from ..infrastructure.symptom_checker_provider import SymptomCheckerProvider
from ..application.use_cases import (
    SendMessageUseCase,
    DeleteCheckpointUseCase,
    ResumeConversationUseCase
)
from .config import settings


def _create_llm_provider():
    """Factory function to create the LLM provider."""
    if not settings.openai_api_key:
        raise ValueError("OPENAI_API_KEY is required")
    
    return SymptomCheckerProvider(
        api_key=settings.openai_api_key,
        checkpoint_db_path=settings.checkpoint_db_path,
    )

_llm_provider = _create_llm_provider()


@lru_cache
def get_llm_provider():
    """Get LLM provider instance (swappable via config)."""
    return _llm_provider


def get_checkpoint_manager():
    """Get checkpoint manager instance.
    
    SymptomCheckerProvider implements ICheckpointManager for checkpoint management.
    """
    return _llm_provider


def get_send_message_use_case() -> SendMessageUseCase:
    """Get SendMessageUseCase instance."""
    return SendMessageUseCase(llm_provider=get_llm_provider())


def get_resume_conversation_use_case() -> ResumeConversationUseCase:
    """Get ResumeConversationUseCase instance."""
    return ResumeConversationUseCase(llm_provider=get_llm_provider())


def get_delete_checkpoint_use_case():
    """Get DeleteCheckpointUseCase instance for checkpoint-only deletion."""
    return DeleteCheckpointUseCase(checkpoint_manager=get_checkpoint_manager())
