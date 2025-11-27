"""FastAPI application."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .routes import router
from .config import settings


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title="Chatbot API",
        description="Layered architecture chatbot with swappable components",
        version="1.0.0"
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
