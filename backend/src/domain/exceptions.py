"""Domain exceptions."""


class DomainException(Exception):
    """Base exception for domain errors."""
    pass


class ConversationNotFoundException(DomainException):
    """Raised when a conversation is not found."""
    pass


class LLMProviderException(DomainException):
    """Raised when LLM provider encounters an error."""
    pass


class CheckpointNotFoundException(DomainException):
    """Raised when a server checkpoint is not found (expired or deleted)."""
    pass


class InvalidMessageException(DomainException):
    """Raised when a message is invalid."""
    pass
