# Requirements Document

## Introduction

This document specifies requirements for a comprehensive refactoring of the graph visualization feature in the symptom checker application. The current implementation has fundamental architectural issues where graph state is split between frontend React state, Zustand store, and backend LangGraph checkpoints, leading to inconsistencies and bugs.

This refactoring aims to establish a single source of truth for graph state, ensure consistency between initial and resume flows, and properly persist graph visualization state across browser sessions.

## Glossary

- **Graph Visualization**: A sidebar panel showing the 7-node workflow diagram with node statuses (pending, active, waiting, completed)
- **Graph State**: The complete state of the graph visualization including current stage, completed stages, waiting node, and live data
- **Stage Event**: A JSON message from the backend containing `type: "stage"`, `stage` (node name), `message` (human-readable), and `data` (live metrics)
- **Interrupt Event**: A JSON message from the backend indicating the graph is paused for user input
- **Completed Stages**: Array of node IDs that have finished execution in the current conversation
- **Waiting Node**: The node currently paused for user input (interrupt)
- **Refinement Loop**: The iterative process of asking follow-up questions (up to 5 iterations)
- **IndexedDB**: Browser storage used to persist conversation state client-side
- **LangGraph Checkpoint**: Server-side state persistence for the graph workflow

## Requirements

### Requirement 1: Single Source of Truth for Graph State

**User Story:** As a developer, I want graph visualization state to be managed in a single location, so that state is consistent and predictable across all scenarios.

#### Acceptance Criteria

1. WHEN graph state changes THEN THE Zustand_Store SHALL be the single source of truth for all graph visualization state
2. WHEN the ChatPage component renders THEN THE ChatPage component SHALL read graph state from Zustand_Store instead of local React state
3. WHEN stage events are received THEN THE ViewModel SHALL update graph state atomically in a single state update
4. WHEN interrupt events are received THEN THE ViewModel SHALL derive the waiting node from the interrupt type and update state accordingly

### Requirement 2: Consistent Stage Event Format

**User Story:** As a developer, I want the backend to send consistent stage events, so that the frontend can reliably map stages to graph nodes.

#### Acceptance Criteria

1. WHEN the Backend sends a stage event THEN THE Backend SHALL include the actual LangGraph node name in the `stage` field
2. WHEN the Backend resumes a conversation THEN THE Backend SHALL send the actual node name instead of a generic "processing" pseudo-stage
3. WHEN the Backend sends stage events THEN THE Backend SHALL use the same stage names in both initial and resume flows
4. WHEN the Backend sends stage events for refinement nodes THEN THE Backend SHALL include the refinement iteration count in the `data` field

### Requirement 3: Graph State Persistence

**User Story:** As a user returning to a previously interrupted conversation, I want to see which stages were already completed, so that I understand the progress made before I left.

#### Acceptance Criteria

1. WHEN a conversation is saved to IndexedDB THEN THE Storage_Service SHALL persist the completed stages array
2. WHEN a conversation is saved to IndexedDB THEN THE Storage_Service SHALL persist the stages live data
3. WHEN a conversation is saved to IndexedDB THEN THE Storage_Service SHALL persist the waiting node ID if interrupted
4. WHEN a conversation is loaded from IndexedDB THEN THE ViewModel SHALL restore all graph state from storage
5. WHEN a new conversation is started THEN THE ViewModel SHALL reset all graph state to initial values

### Requirement 4: Correct Waiting Node Determination

**User Story:** As a user resuming a conversation, I want the graph to correctly show which node is waiting for my input, so that I understand where I am in the workflow.

#### Acceptance Criteria

1. WHEN an interrupt event contains `questions` array THEN THE ViewModel SHALL set waiting node to `collect_answers`
2. WHEN an interrupt event contains single `question` field THEN THE ViewModel SHALL set waiting node to `collect_refinement_answer`
3. WHEN the waiting node is determined THEN THE ViewModel SHALL persist it to IndexedDB with the conversation
4. WHEN a conversation is restored THEN THE ViewModel SHALL restore the waiting node from IndexedDB

### Requirement 5: Stage Completion Tracking

**User Story:** As a user, I want to see accurate progress through the workflow, so that I know which steps have been completed.

#### Acceptance Criteria

1. WHEN a stage event is received for a new node THEN THE ViewModel SHALL mark the previous node as completed
2. WHEN an interrupt event is received THEN THE ViewModel SHALL mark all nodes up to the waiting node as completed
3. WHEN the workflow completes THEN THE ViewModel SHALL mark all nodes including final summary as completed
4. WHEN stages are marked completed THEN THE ViewModel SHALL persist the updated completed stages to IndexedDB

### Requirement 6: Refinement Loop Visualization

**User Story:** As a user in the refinement loop, I want to see which iteration I'm on, so that I understand how much more information might be needed.

#### Acceptance Criteria

1. WHILE in the refinement loop THE Graph_Visualization SHALL display the current refinement iteration number (1-5)
2. WHEN the refinement count is included in stage data THEN THE Graph_Visualization SHALL show it in the node's live data display
3. WHEN the maximum refinement iterations (5) is reached THEN THE Graph_Visualization SHALL indicate this is the final refinement round

### Requirement 7: Clean Production Code

**User Story:** As a developer, I want the codebase to be clean and production-ready, so that there are no debug artifacts affecting performance.

#### Acceptance Criteria

1. WHEN the Graph_Visualization component renders THEN THE Graph_Visualization component SHALL omit debug information from console output
2. WHEN stage updates are processed THEN THE system SHALL omit internal state from console output
3. WHEN errors occur THEN THE system SHALL log errors appropriately without exposing internal state

### Requirement 8: Backward Compatibility

**User Story:** As a user with existing conversations, I want my data to continue working after the update, so that I don't lose my conversation history.

#### Acceptance Criteria

1. WHEN loading a conversation without graph state THEN THE ViewModel SHALL derive completed stages from the conversation messages
2. WHEN loading a conversation without waiting node THEN THE ViewModel SHALL derive it from the interrupt state flags
3. WHEN the storage schema changes THEN THE Storage_Service SHALL migrate existing data to the new schema

### Requirement 9: Atomic State Updates

**User Story:** As a developer, I want state updates to be atomic and race-condition free, so that rapid stage changes don't cause inconsistent state.

#### Acceptance Criteria

1. WHEN multiple stage events arrive in quick succession THEN THE ViewModel SHALL process them sequentially without losing intermediate stages
2. WHEN a stage transition occurs THEN THE ViewModel SHALL update currentStage and completedStages in a single atomic operation
3. WHEN the component unmounts during processing THEN THE system SHALL cancel pending state updates

### Requirement 10: Graph State Reset on Conversation Changes

**User Story:** As a user switching between conversations, I want the graph to accurately reflect each conversation's state, so that I'm not confused by stale data.

#### Acceptance Criteria

1. WHEN switching to a different conversation THEN THE ViewModel SHALL completely reset graph state before loading new state
2. WHEN starting a new conversation THEN THE ViewModel SHALL reset all graph state to initial values
3. WHEN deleting a conversation THEN THE ViewModel SHALL clear graph state if it was the active conversation

### Requirement 11: Frontend-Backend Stage Name Alignment

**User Story:** As a developer, I want stage names to be consistent between frontend and backend, so that mapping is straightforward and maintainable.

#### Acceptance Criteria

1. WHEN the Backend sends a stage event THEN THE stage field SHALL contain the exact LangGraph node name (e.g., `collect_answers`, `collect_refinement_answer`)
2. WHEN the frontend maps a stage THEN THE frontend SHALL use the stage field directly as the GraphNodeId
3. WHEN stage messages are displayed THEN THE frontend SHALL look up the human-readable message from the stage name instead of reverse mapping

### Requirement 12: SOLID Architecture Principles

**User Story:** As a developer, I want the codebase to follow SOLID principles, so that the code is maintainable, testable, and extensible.

#### Acceptance Criteria

1. THE GraphStateService SHALL have a single responsibility of managing graph visualization state (Single Responsibility)
2. THE ViewModel SHALL depend on abstractions (interfaces) for storage and state management instead of concrete implementations (Dependency Inversion)
3. WHEN new graph node types are added THEN THE system SHALL support extension without modifying existing graph state logic (Open/Closed)
4. THE Storage_Service interface SHALL define only the methods required by its consumers (Interface Segregation)
5. WHEN components consume graph state THEN THE components SHALL receive only the state slice they require instead of the entire state object (Interface Segregation)

