"""Dependency injection container."""
from functools import lru_cache
from ..infrastructure.llm_providers import AnthropicLLMProvider
from ..infrastructure.langgraph_provider import LangGraphMedicalProvider
from ..infrastructure.medical_chatbot_provider import MedicalChatbotProvider
from ..infrastructure.repositories import InMemoryConversationRepository, SQLiteConversationRepository
from ..application.use_cases import (
    SendMessageUseCase,
    GetConversationHistoryUseCase,
    DeleteConversationUseCase,
    ListConversationsUseCase,
    ResumeConversationUseCase
)
from .config import settings


# Repository selection based on config
def _create_conversation_repository():
    """Factory function to create the appropriate repository."""
    if settings.storage_type == "sqlite":
        return SQLiteConversationRepository(db_path="conversations.db")
    return InMemoryConversationRepository()

_conversation_repository = _create_conversation_repository()


# LLM Provider selection based on config
def _create_llm_provider():
    """Factory function to create the appropriate LLM provider."""
    if settings.llm_provider == "openai":
        if not settings.openai_api_key:
            raise ValueError("OPENAI_API_KEY is required when llm_provider is 'openai'")
        return MedicalChatbotProvider(api_key=settings.openai_api_key)
    elif settings.llm_provider == "anthropic":
        if not settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY is required when llm_provider is 'anthropic'")
        return LangGraphMedicalProvider(api_key=settings.anthropic_api_key)
    else:
        raise ValueError(f"Unknown llm_provider: {settings.llm_provider}")

_llm_provider = _create_llm_provider()


@lru_cache
def get_llm_provider():
    """Get LLM provider instance (swappable via config)."""
    return _llm_provider


@lru_cache
def get_conversation_repository():
    """Get conversation repository instance (swappable via config)."""
    return _conversation_repository


def get_send_message_use_case() -> SendMessageUseCase:
    """Get SendMessageUseCase instance."""
    return SendMessageUseCase(
        llm_provider=get_llm_provider(),
        conversation_repository=get_conversation_repository()
    )


def get_conversation_history_use_case() -> GetConversationHistoryUseCase:
    """Get GetConversationHistoryUseCase instance."""
    return GetConversationHistoryUseCase(
        conversation_repository=get_conversation_repository()
    )


def get_delete_conversation_use_case() -> DeleteConversationUseCase:
    """Get DeleteConversationUseCase instance."""
    return DeleteConversationUseCase(
        conversation_repository=get_conversation_repository()
    )


def get_list_conversations_use_case() -> ListConversationsUseCase:
    """Get ListConversationsUseCase instance."""
    return ListConversationsUseCase(
        conversation_repository=get_conversation_repository()
    )


def get_resume_conversation_use_case() -> ResumeConversationUseCase:
    """Get ResumeConversationUseCase instance."""
    return ResumeConversationUseCase(
        llm_provider=get_llm_provider(),
        conversation_repository=get_conversation_repository()
    )
