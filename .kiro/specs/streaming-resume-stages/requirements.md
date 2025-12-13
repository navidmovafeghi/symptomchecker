# Requirements Document

## Introduction

This feature adds real-time stage indicators during the conversation resume flow. Currently, when users answer preliminary questions and submit their responses, they see a generic "Thinking..." message while the backend processes multiple LangGraph nodes (differential diagnosis generation, refinement questions, etc.). This feature will stream stage updates to the frontend so users see contextual progress messages like "Analyzing symptoms...", "Preparing follow-up question...", etc.

## Glossary

- **Resume Flow**: The process of continuing an interrupted LangGraph conversation after the user provides answers to clarification questions
- **Stage Indicator**: A user-friendly message displayed during processing that describes what the system is currently doing
- **LangGraph Node**: A discrete processing step in the medical triage workflow (e.g., generate_ddx, generate_refinement_question)
- **Interrupt**: A LangGraph mechanism that pauses workflow execution to collect user input
- **Checkpoint**: Saved LangGraph state that allows resuming a conversation from where it paused

## Requirements

### Requirement 1

**User Story:** As a user, I want to see what the system is doing while it processes my answers, so that I understand the progress and don't think the application is frozen.

#### Acceptance Criteria

1. WHEN the system resumes a conversation after user submits answers THEN the Frontend SHALL display stage-specific progress messages instead of generic "Thinking..."
2. WHEN the backend transitions between LangGraph nodes during resume THEN the Frontend SHALL update the displayed stage message to reflect the current processing step
3. WHEN the system is generating differential diagnosis THEN the Frontend SHALL display "Analyzing symptoms..."
4. WHEN the system is generating a refinement question THEN the Frontend SHALL display "Preparing follow-up question..."
5. WHEN the system is refining the diagnosis THEN the Frontend SHALL display "Refining diagnosis..."
6. WHEN the system is generating the final summary THEN the Frontend SHALL display "Preparing your assessment..."

### Requirement 2

**User Story:** As a developer, I want the resume endpoint to support streaming responses, so that stage updates can be sent to the frontend in real-time.

#### Acceptance Criteria

1. WHEN the backend resume method executes THEN the Backend SHALL yield stage indicator JSON messages as each LangGraph node begins processing
2. WHEN a stage indicator is yielded THEN the Backend SHALL format it as JSON with "type", "stage", and "message" fields
3. WHEN the LangGraph workflow completes or interrupts THEN the Backend SHALL yield the final response (interrupt or complete) as the last message
4. WHEN the backend streams resume responses THEN the Backend SHALL include newline delimiters after each JSON message for proper parsing

### Requirement 3

**User Story:** As a developer, I want the frontend to consume streaming resume responses, so that stage updates are displayed to users in real-time.

#### Acceptance Criteria

1. WHEN the frontend calls the resume endpoint THEN the API Service SHALL use streaming fetch to receive chunked responses
2. WHEN the API Service receives a stage-type JSON message THEN the API Service SHALL invoke the stage callback with the stage name and message
3. WHEN the API Service receives an interrupt or complete JSON message THEN the API Service SHALL return the parsed response to the caller
4. WHEN the ViewModel initiates a resume operation THEN the ViewModel SHALL pass a stage callback to update the currentStageMessage state

### Requirement 4

**User Story:** As a user, I want the stage indicators to appear immediately when I submit my answers, so that I have instant feedback that my submission was received.

#### Acceptance Criteria

1. WHEN the user submits answers and the resume stream begins THEN the Backend SHALL yield an initial stage message before graph execution starts
2. WHEN the initial stage message is received THEN the Frontend SHALL display it within 100ms of the stream starting
