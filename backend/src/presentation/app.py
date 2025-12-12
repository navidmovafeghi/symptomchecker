"""FastAPI application."""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import router
from .config import settings
from .dependencies import get_llm_provider
from ..infrastructure.symptom_checker_provider import SymptomCheckerProvider


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager for startup and shutdown events.
    
    Handles cleanup of resources like the SymptomCheckerProvider's
    database connection on application shutdown.
    """
    # Startup: nothing special needed (lazy initialization handles it)
    yield
    
    # Shutdown: cleanup provider resources
    provider = get_llm_provider()
    if isinstance(provider, SymptomCheckerProvider):
        await provider.cleanup()


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Chatbot API",
        description="Layered architecture chatbot with swappable components",
        version="1.0.0",
        lifespan=lifespan,
    )

    # CORS
    origins = settings.cors_origins.split(",")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Routes
    app.include_router(router)

    @app.get("/")
    async def root():
        return {"message": "Chatbot API is running"}

    @app.get("/health")
    async def health():
        return {"status": "healthy"}

    return app


app = create_app()
