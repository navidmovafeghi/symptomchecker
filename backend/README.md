# Chatbot Backend

Layered architecture chatbot API with swappable components.

## Architecture

- **Domain Layer**: Business entities and interfaces
- **Application Layer**: Use cases and DTOs
- **Infrastructure Layer**: Swappable implementations (LLM providers, repositories)
- **Presentation Layer**: FastAPI routes and configuration

## Setup

1. Create a virtual environment:
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Create `.env` file:
```bash
cp .env.example .env
```

4. Add your Anthropic API key to `.env`:
```
ANTHROPIC_API_KEY=your_actual_key_here
```

## Run

```bash
python main.py
```

API will be available at: http://localhost:8000

Swagger docs: http://localhost:8000/docs

## Endpoints

- `POST /api/chat/message` - Send message (non-streaming)
- `POST /api/chat/message/stream` - Send message (streaming)
- `GET /api/chat/conversations/{id}` - Get conversation history
- `DELETE /api/chat/conversations/{id}` - Delete conversation

## Swapping Components

### Change LLM Provider
Edit `src/presentation/dependencies.py` and implement new provider in `src/infrastructure/llm_providers.py`

### Change Storage
Edit `src/presentation/dependencies.py` and implement new repository in `src/infrastructure/repositories.py`
