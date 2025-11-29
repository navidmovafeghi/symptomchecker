# Architecture Documentation

## Overview

This medical chatbot follows clean architecture with clear separation of concerns and swappable components.

## Backend Layers

### Domain Layer
Core business logic with zero external dependencies.

- `entities.py` - Message, Conversation models
- `interfaces.py` - ILLMProvider, ICheckpointManager abstractions
- `exceptions.py` - Domain-specific exceptions

### Application Layer
Use cases that orchestrate domain logic.

| Use Case | Description |
|----------|-------------|
| SendMessageUseCase | Send message, get AI response (streaming/non-streaming) |
| ResumeConversationUseCase | Resume after interrupt with user's answer |
| DeleteCheckpointUseCase | Delete server checkpoint for a conversation |

### Infrastructure Layer
Concrete implementations of domain interfaces.

**MedicalChatbotProvider** (LLM + Checkpoint Manager):
- Uses OpenAI API via LangChain
- LangGraph state machine for medical triage
- Supports interrupts for clarification questions
- Checkpoints workflow state to SQLite (`checkpoints.db`)
- Implements both ILLMProvider and ICheckpointManager

### Presentation Layer
FastAPI routes and dependency injection.

- `routes.py` - API endpoints
- `dependencies.py` - DI container with factory functions
- `config.py` - Environment settings

## Frontend Architecture (MVVM)

| Layer | Files | Responsibility |
|-------|-------|----------------|
| View | ChatPage.tsx, Sidebar.tsx | UI rendering, user events |
| ViewModel | useChatViewModel.ts | State management (Zustand), business logic |
| Service | api.ts | HTTP communication with backend |
| Storage | indexedDBStorage.ts | Client-side conversation persistence |
| Types | index.ts | TypeScript interfaces |

## Data Persistence

| Storage | Location | Purpose |
|---------|----------|---------|
| IndexedDB | Browser | Conversation history (messages, metadata) |
| checkpoints.db | Backend | LangGraph workflow state (for interrupts) |

**Key Points:**
- Conversations are stored client-side in IndexedDB
- Server only stores LangGraph checkpoints for interrupt/resume functionality
- `thread_id` (same as `conversation_id`) links frontend conversations to backend checkpoints

## LangGraph Medical Workflow

The chatbot uses a state machine for medical triage:

1. **Intent Detection** - Classifies: symptom_checking, non_medical, other_medical, ambiguous
2. **Clarification** - If ambiguous, asks questions with options (INTERRUPT)
3. **Symptom Gathering** - Multi-turn conversation to collect details (INTERRUPT)
4. **Evaluation** - Determines if enough info for triage
5. **Final Response** - Provides guidance based on gathered information

Key concepts:
- **INTERRUPT**: Pauses workflow, saves state, waits for user input
- **Checkpointing**: State saved to checkpoints.db at each node
- **Resume**: Loads checkpoint, continues from where it paused

## Data Flow: Send Message

1. User types message in ChatPage
2. ChatPage calls useChatViewModel.sendMessage()
3. ViewModel calls apiService.sendMessageStream()
4. Service POSTs to /api/chat/message/stream
5. FastAPI routes to SendMessageUseCase.execute_stream()
6. MedicalChatbotProvider builds LangGraph, invokes with checkpointer
7. Graph executes nodes, may INTERRUPT or complete
8. Response streams back through all layers
9. ViewModel saves conversation to IndexedDB
10. ViewModel updates state, ChatPage re-renders

## SOLID Principles

| Principle | Implementation |
|-----------|----------------|
| Single Responsibility | Each class has one job |
| Open/Closed | Add new providers without modifying existing code |
| Liskov Substitution | Any ILLMProvider works interchangeably |
| Interface Segregation | Small, focused interfaces |
| Dependency Inversion | Use cases depend on abstractions |
