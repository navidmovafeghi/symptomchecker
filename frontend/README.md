# Chatbot Frontend

Next.js frontend with MVVM architecture pattern.

## Architecture

- **Model**: Types and data structures (`types/`)
- **ViewModel**: Business logic and state management (`viewmodels/`)
- **View**: React components (`presentation/`)
- **Service**: API communication layer (`services/`)

## Tech Stack

- **Next.js 15** with App Router
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Zustand** for state management

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file:
```bash
cp .env.local.example .env.local
```

3. Update `.env.local` with your backend URL:
```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Run

Development mode:
```bash
npm run dev
```

Build for production:
```bash
npm run build
npm start
```

The app will be available at: http://localhost:3000

## MVVM Pattern

### Model (types/)
- Defines data structures and types
- No business logic

### ViewModel (viewmodels/)
- Manages UI state with Zustand
- Contains presentation logic
- Communicates with API service
- Exposes state and actions to View

### View (presentation/)
- React components for UI
- No business logic
- Subscribes to ViewModel state
- Triggers ViewModel actions

### Service (services/)
- API communication
- HTTP client abstraction
- No state management

## Components

- `ChatPage` - Main chat interface
- `MessageList` - Displays messages with auto-scroll
- `MessageBubble` - Individual message display
- `MessageInput` - User input with keyboard shortcuts

## Features

- Real-time streaming responses
- Auto-scrolling message list
- Error handling with user feedback
- Conversation persistence
- Clear chat functionality
- Responsive design
