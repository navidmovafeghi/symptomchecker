# Architecture Diagrams

## 1. System Overview - Clean Architecture Layers

```mermaid
graph TB
    subgraph "Frontend (React + TypeScript)"
        View[View Layer<br/>ChatPage.tsx, Sidebar.tsx]
        ViewModel[ViewModel Layer<br/>useChatViewModel.ts<br/>Zustand State]
        Service[Service Layer<br/>api.ts]
        Storage[Storage Layer<br/>indexedDBStorage.ts]
    end
    
    subgraph "Backend (FastAPI + Python)"
        Presentation[Presentation Layer<br/>routes.py, dependencies.py]
        Application[Application Layer<br/>Use Cases]
        Domain[Domain Layer<br/>entities.py, interfaces.py]
        Infrastructure[Infrastructure Layer<br/>MedicalChatbotProvider]
    end
    
    subgraph "External Services"
        OpenAI[OpenAI API<br/>via LangChain]
        SQLite[(checkpoints.db<br/>SQLite)]
    end
    
    subgraph "Browser Storage"
        IndexedDB[(IndexedDB<br/>Conversations)]
    end
    
    View --> ViewModel
    ViewModel --> Service
    ViewModel --> Storage
    Storage --> IndexedDB
    Service --> Presentation
    Presentation --> Application
    Application --> Domain
    Application --> Infrastructure
    Infrastructure --> OpenAI
    Infrastructure --> SQLite
    
    style Domain fill:#e1f5ff
    style Application fill:#fff4e1
    style Infrastructure fill:#ffe1f5
    style Presentation fill:#e1ffe1
```

## 2. Backend Layer Architecture (Clean Architecture)

```mermaid
graph TB
    subgraph "Domain Layer (Core Business Logic)"
        Entities[entities.py<br/>Message, Conversation]
        Interfaces[interfaces.py<br/>ILLMProvider<br/>ICheckpointManager]
        Exceptions[exceptions.py<br/>Domain Exceptions]
    end
    
    subgraph "Application Layer (Use Cases)"
        SendMsg[SendMessageUseCase<br/>execute / execute_stream]
        Resume[ResumeConversationUseCase<br/>execute / execute_stream]
        Delete[DeleteCheckpointUseCase<br/>execute]
    end
    
    subgraph "Infrastructure Layer (Implementations)"
        Provider[MedicalChatbotProvider<br/>LangChain + LangGraph<br/>OpenAI Integration]
        Checkpoint[SQLite Checkpointer<br/>checkpoints.db]
    end
    
    subgraph "Presentation Layer (API)"
        Routes[routes.py<br/>FastAPI Endpoints]
        DI[dependencies.py<br/>Dependency Injection]
        Config[config.py<br/>Environment Settings]
    end
    
    Routes --> DI
    DI --> SendMsg
    DI --> Resume
    DI --> Delete
    
    SendMsg --> Interfaces
    Resume --> Interfaces
    Delete --> Interfaces
    
    SendMsg --> Entities
    Resume --> Entities
    
    Provider -.implements.-> Interfaces
    Provider --> Checkpoint
    
    DI -.creates.-> Provider
    
    style Entities fill:#4a90e2
    style Interfaces fill:#4a90e2
    style Exceptions fill:#4a90e2
    style SendMsg fill:#f5a623
    style Resume fill:#f5a623
    style Delete fill:#f5a623
    style Provider fill:#bd10e0
    style Checkpoint fill:#bd10e0
```

## 3. Frontend Architecture (MVVM Pattern)

```mermaid
graph TB
    subgraph "View Layer"
        ChatPage[ChatPage.tsx<br/>Main Chat Interface]
        Sidebar[Sidebar.tsx<br/>Conversation List]
        Components[Other Components<br/>MessageBubble, etc.]
    end
    
    subgraph "ViewModel Layer"
        ViewModel[useChatViewModel.ts<br/>Zustand Store]
        State[State Management<br/>- conversations<br/>- currentConversation<br/>- messages<br/>- isLoading]
        Actions[Actions<br/>- sendMessage<br/>- resumeConversation<br/>- createConversation<br/>- deleteConversation]
    end
    
    subgraph "Service Layer"
        API[api.ts<br/>HTTP Client]
        Methods[API Methods<br/>- sendMessageStream<br/>- resumeConversationStream<br/>- deleteCheckpoint]
    end
    
    subgraph "Storage Layer"
        IDB[indexedDBStorage.ts<br/>IndexedDB Wrapper]
        Operations[Operations<br/>- saveConversation<br/>- getConversations<br/>- deleteConversation]
    end
    
    subgraph "Types"
        Types[index.ts<br/>TypeScript Interfaces<br/>Message, Conversation, etc.]
    end
    
    ChatPage --> ViewModel
    Sidebar --> ViewModel
    Components --> ViewModel
    
    ViewModel --> State
    ViewModel --> Actions
    
    Actions --> API
    Actions --> IDB
    
    API --> Methods
    IDB --> Operations
    
    State -.uses.-> Types
    API -.uses.-> Types
    IDB -.uses.-> Types
    
    style ChatPage fill:#61dafb
    style Sidebar fill:#61dafb
    style ViewModel fill:#764abc
    style API fill:#50e3c2
    style IDB fill:#f8e71c
```

## 4. LangGraph Medical Workflow State Machine

```mermaid
stateDiagram-v2
    [*] --> IntentDetection
    
    IntentDetection --> Clarification: ambiguous
    IntentDetection --> SymptomGathering: symptom_checking
    IntentDetection --> FinalResponse: non_medical/other_medical
    
    Clarification --> INTERRUPT_1: Ask clarifying question
    INTERRUPT_1 --> [*]: Wait for user input
    
    [*] --> SymptomGathering: Resume after clarification
    
    SymptomGathering --> INTERRUPT_2: Need more info
    INTERRUPT_2 --> [*]: Wait for user input
    
    [*] --> Evaluation: Resume after symptom
    
    SymptomGathering --> Evaluation: Enough info collected
    
    Evaluation --> SymptomGathering: Need more details
    Evaluation --> FinalResponse: Ready for triage
    
    FinalResponse --> [*]: Complete
    
    note right of INTERRUPT_1
        State saved to checkpoints.db
        thread_id = conversation_id
    end note
    
    note right of INTERRUPT_2
        Multi-turn conversation
        Checkpoint at each step
    end note
```

## 5. Data Flow: Send Message (Complete Journey)

```mermaid
sequenceDiagram
    participant User
    participant ChatPage
    participant ViewModel
    participant API
    participant FastAPI
    participant UseCase
    participant Provider
    participant LangGraph
    participant OpenAI
    participant CheckpointDB
    participant IndexedDB
    
    User->>ChatPage: Types message & clicks send
    ChatPage->>ViewModel: sendMessage(content)
    ViewModel->>API: sendMessageStream(conversationId, content)
    API->>FastAPI: POST /api/chat/message/stream
    FastAPI->>UseCase: SendMessageUseCase.execute_stream()
    UseCase->>Provider: stream_response(thread_id, message)
    
    Provider->>LangGraph: Build graph with checkpointer
    Provider->>CheckpointDB: Load checkpoint (if exists)
    
    loop Graph Execution
        LangGraph->>OpenAI: API call for each node
        OpenAI-->>LangGraph: Response
        LangGraph->>CheckpointDB: Save state after each node
    end
    
    alt Workflow Interrupts
        LangGraph-->>Provider: INTERRUPT with question
        Provider-->>UseCase: Stream interrupt response
    else Workflow Completes
        LangGraph-->>Provider: Final response
        Provider-->>UseCase: Stream final response
    end
    
    UseCase-->>FastAPI: Stream chunks
    FastAPI-->>API: SSE stream
    API-->>ViewModel: Yield chunks
    ViewModel->>IndexedDB: Save conversation
    ViewModel-->>ChatPage: Update state
    ChatPage-->>User: Display response
```

## 6. Data Persistence Architecture

```mermaid
graph TB
    subgraph "Frontend Storage"
        Browser[Browser]
        IDB[(IndexedDB)]
        
        Browser --> IDB
        
        IDBData[Stored Data:<br/>- conversations<br/>- messages<br/>- metadata<br/>- timestamps]
        
        IDB -.contains.-> IDBData
    end
    
    subgraph "Backend Storage"
        Server[Backend Server]
        SQLite[(checkpoints.db<br/>SQLite)]
        
        Server --> SQLite
        
        SQLiteData[Stored Data:<br/>- thread_id<br/>- checkpoint_id<br/>- workflow state<br/>- node position<br/>- pending questions]
        
        SQLite -.contains.-> SQLiteData
    end
    
    subgraph "Data Linking"
        Link[thread_id = conversation_id]
    end
    
    IDB -.linked by.-> Link
    SQLite -.linked by.-> Link
    
    Note1[Client-side:<br/>Full conversation history<br/>Persistent across sessions]
    Note2[Server-side:<br/>Only workflow state<br/>For interrupt/resume]
    
    IDB -.-> Note1
    SQLite -.-> Note2
    
    style IDB fill:#f8e71c
    style SQLite fill:#4a90e2
    style Link fill:#50e3c2
```

## 7. SOLID Principles Implementation

```mermaid
graph TB
    subgraph "Single Responsibility"
        SR1[SendMessageUseCase<br/>Only handles sending messages]
        SR2[MedicalChatbotProvider<br/>Only handles LLM interaction]
        SR3[indexedDBStorage<br/>Only handles storage]
    end
    
    subgraph "Open/Closed"
        OC1[ILLMProvider Interface]
        OC2[MedicalChatbotProvider]
        OC3[Future: GPT4Provider]
        OC4[Future: ClaudeProvider]
        
        OC2 -.implements.-> OC1
        OC3 -.implements.-> OC1
        OC4 -.implements.-> OC1
    end
    
    subgraph "Liskov Substitution"
        LS1[Use Case depends on ILLMProvider]
        LS2[Any implementation works]
        LS3[Behavior preserved]
        
        LS1 --> LS2 --> LS3
    end
    
    subgraph "Interface Segregation"
        IS1[ILLMProvider<br/>stream_response, get_response]
        IS2[ICheckpointManager<br/>delete_checkpoint]
        IS3[Small, focused interfaces]
        
        IS1 --> IS3
        IS2 --> IS3
    end
    
    subgraph "Dependency Inversion"
        DI1[Use Cases]
        DI2[Abstractions<br/>ILLMProvider, ICheckpointManager]
        DI3[Implementations<br/>MedicalChatbotProvider]
        
        DI1 --> DI2
        DI3 -.implements.-> DI2
    end
    
    style SR1 fill:#4a90e2
    style OC1 fill:#f5a623
    style LS1 fill:#50e3c2
    style IS1 fill:#bd10e0
    style DI2 fill:#7ed321
```

## 8. API Endpoints & Use Cases Mapping

```mermaid
graph LR
    subgraph "API Endpoints"
        E1[POST /api/chat/message]
        E2[POST /api/chat/message/stream]
        E3[POST /api/chat/resume]
        E4[POST /api/chat/resume/stream]
        E5[DELETE /api/chat/checkpoint/:id]
    end
    
    subgraph "Use Cases"
        UC1[SendMessageUseCase<br/>.execute]
        UC2[SendMessageUseCase<br/>.execute_stream]
        UC3[ResumeConversationUseCase<br/>.execute]
        UC4[ResumeConversationUseCase<br/>.execute_stream]
        UC5[DeleteCheckpointUseCase<br/>.execute]
    end
    
    subgraph "Domain Interfaces"
        I1[ILLMProvider]
        I2[ICheckpointManager]
    end
    
    E1 --> UC1
    E2 --> UC2
    E3 --> UC3
    E4 --> UC4
    E5 --> UC5
    
    UC1 --> I1
    UC2 --> I1
    UC3 --> I1
    UC4 --> I1
    UC5 --> I2
    
    style E1 fill:#61dafb
    style E2 fill:#61dafb
    style E3 fill:#61dafb
    style E4 fill:#61dafb
    style E5 fill:#61dafb
    style UC1 fill:#f5a623
    style UC2 fill:#f5a623
    style UC3 fill:#f5a623
    style UC4 fill:#f5a623
    style UC5 fill:#f5a623
```

## 9. Component Interaction: Resume Conversation Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant API
    participant UseCase
    participant Provider
    participant CheckpointDB
    participant LangGraph
    
    Note over User,LangGraph: Previous conversation was interrupted
    
    User->>Frontend: Provides answer to clarification
    Frontend->>API: resumeConversationStream(conversationId, answer)
    API->>UseCase: ResumeConversationUseCase.execute_stream()
    UseCase->>Provider: stream_response(thread_id, answer)
    
    Provider->>CheckpointDB: Load checkpoint by thread_id
    CheckpointDB-->>Provider: Return saved state
    
    Provider->>LangGraph: Resume from checkpoint
    
    Note over LangGraph: Continue from where it paused
    
    LangGraph->>LangGraph: Process user's answer
    LangGraph->>CheckpointDB: Update checkpoint
    
    alt Need More Info
        LangGraph-->>Provider: INTERRUPT again
    else Ready for Final Response
        LangGraph-->>Provider: Complete response
        Provider->>CheckpointDB: Clear checkpoint (optional)
    end
    
    Provider-->>UseCase: Stream response
    UseCase-->>API: Stream chunks
    API-->>Frontend: Display response
    Frontend-->>User: Show next question or final answer
```

## 10. Technology Stack Overview

```mermaid
graph TB
    subgraph "Frontend Stack"
        React[React 18<br/>UI Framework]
        TS[TypeScript<br/>Type Safety]
        Zustand[Zustand<br/>State Management]
        IDB[IndexedDB<br/>Client Storage]
        Vite[Vite<br/>Build Tool]
    end
    
    subgraph "Backend Stack"
        FastAPI[FastAPI<br/>Web Framework]
        Python[Python 3.11+<br/>Language]
        LangChain[LangChain<br/>LLM Framework]
        LangGraph[LangGraph<br/>Workflow Engine]
        SQLite[SQLite<br/>Checkpoint Storage]
    end
    
    subgraph "External Services"
        OpenAI[OpenAI API<br/>GPT Models]
    end
    
    subgraph "Architecture Patterns"
        Clean[Clean Architecture<br/>Backend]
        MVVM[MVVM Pattern<br/>Frontend]
        DI[Dependency Injection<br/>Backend]
        SOLID[SOLID Principles<br/>Backend]
    end
    
    React --> Zustand
    React --> IDB
    Zustand --> TS
    
    FastAPI --> Python
    FastAPI --> LangChain
    LangChain --> LangGraph
    LangGraph --> SQLite
    LangChain --> OpenAI
    
    FastAPI -.follows.-> Clean
    React -.follows.-> MVVM
    FastAPI -.uses.-> DI
    Python -.follows.-> SOLID
    
    style React fill:#61dafb
    style FastAPI fill:#009688
    style LangGraph fill:#bd10e0
    style OpenAI fill:#10a37f
```

---

## Key Insights from Diagrams

### Architecture Strengths
1. **Clear Separation of Concerns**: Each layer has distinct responsibilities
2. **Testability**: Domain logic isolated from infrastructure
3. **Flexibility**: Easy to swap LLM providers or storage mechanisms
4. **Scalability**: Stateless backend with client-side storage

### Data Flow Patterns
1. **Streaming**: Real-time response delivery via SSE
2. **Interrupts**: Workflow pauses for user input, resumes seamlessly
3. **Dual Storage**: Client stores history, server stores workflow state

### Design Patterns Used
- **Clean Architecture** (Backend)
- **MVVM** (Frontend)
- **Dependency Injection** (Backend)
- **Repository Pattern** (Storage abstraction)
- **State Machine** (LangGraph workflow)
- **Strategy Pattern** (Swappable LLM providers)
