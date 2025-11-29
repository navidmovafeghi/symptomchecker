"""Application configuration."""
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    openai_api_key: Optional[str] = None
    anthropic_api_key: Optional[str] = None
    cors_origins: str = "http://localhost:3000"
    llm_provider: str = "openai"  # Only 'openai' is supported
    storage_type: str = "sqlite"  # Options: "memory", "sqlite"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
