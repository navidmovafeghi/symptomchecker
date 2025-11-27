"""Application configuration."""
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    anthropic_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    cors_origins: str = "http://localhost:3000"
    llm_provider: str = "openai"  # Options: "anthropic", "openai"
    storage_type: str = "memory"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
