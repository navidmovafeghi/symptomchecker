"""Application configuration."""
from typing import Optional
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment."""
    anthropic_api_key: Optional[str] = None
    cors_origins: str = "http://localhost:3000"
    checkpoint_db_path: str = "checkpoints.db"

    class Config:
        env_file = ".env"
        case_sensitive = False


settings = Settings()
