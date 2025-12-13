# Requirements Document

## Introduction

This feature adds a "Behind the Scenes" button to the chat interface that reveals a visual representation of the symptom checker's graph execution flow. When activated, users can see which processing stage they're currently in, understand the purpose of each node, and track their progress through the diagnostic workflow. This transparency helps users understand why certain questions are being asked and what happens with their responses.

## Glossary

- **Graph**: The LangGraph workflow that processes symptom checking through connected nodes
- **Node**: A discrete processing step in the graph (e.g., question generation, diagnosis)
- **Stage**: The current active node in the graph execution
- **Graph Visualization Panel**: A collapsible UI component showing the workflow diagram
- **Node Status**: The state of a node (pending, active, completed)

## Requirements

### Requirement 1

**User Story:** As a user, I want to see a button that reveals the graph visualization, so that I can understand what's happening behind the scenes.

#### Acceptance Criteria

1. WHEN the chat interface loads THEN the System SHALL display a "Behind the Scenes" toggle button in a non-intrusive location
2. WHEN the user clicks the toggle button THEN the System SHALL expand a visualization panel showing the graph workflow
3. WHEN the visualization panel is open and the user clicks the toggle button THEN the System SHALL collapse the panel
4. WHEN the visualization panel state changes THEN the System SHALL persist the preference in local storage

### Requirement 2

**User Story:** As a user, I want to see all the nodes in the graph workflow, so that I understand the complete diagnostic process.

#### Acceptance Criteria

1. WHEN the visualization panel is displayed THEN the System SHALL show all seven graph nodes in their execution order
2. WHEN displaying nodes THEN the System SHALL show each node with a descriptive name and brief purpose description
3. WHEN displaying the graph THEN the System SHALL show directional connections between nodes indicating the flow
4. WHEN displaying the refinement loop THEN the System SHALL visually indicate the conditional loop between refinement nodes

### Requirement 3

**User Story:** As a user, I want to see which stage I'm currently in, so that I know where I am in the diagnostic process.

#### Acceptance Criteria

1. WHEN a graph node becomes active THEN the System SHALL highlight that node with a distinct visual indicator
2. WHEN a graph node completes THEN the System SHALL mark that node as completed with a different visual style
3. WHEN nodes are pending THEN the System SHALL display them in a muted or inactive style
4. WHEN the current stage changes THEN the System SHALL update the visualization within 500 milliseconds

### Requirement 4

**User Story:** As a user, I want to understand what each node does, so that I can follow the diagnostic reasoning.

#### Acceptance Criteria

1. WHEN the user hovers over a node THEN the System SHALL display a tooltip with a detailed explanation of that node's purpose
2. WHEN displaying node information THEN the System SHALL use patient-friendly language without technical jargon
3. WHEN the active node changes THEN the System SHALL display a brief status message below the graph indicating the current action

### Requirement 5

**User Story:** As a user, I want the visualization to work on mobile devices, so that I can use this feature regardless of my device.

#### Acceptance Criteria

1. WHEN the screen width is below 768 pixels THEN the System SHALL display a simplified vertical layout of the graph
2. WHEN on mobile THEN the System SHALL allow tap interactions instead of hover for tooltips
3. WHEN the panel is expanded on mobile THEN the System SHALL not obstruct the chat input area

### Requirement 6

**User Story:** As a user, I want the visualization to support my language preference, so that I can understand it in my preferred language.

#### Acceptance Criteria

1. WHEN the user's locale is Persian THEN the System SHALL display all node names and descriptions in Persian
2. WHEN the user's locale is Persian THEN the System SHALL render the visualization in right-to-left layout
3. WHEN the locale changes THEN the System SHALL update the visualization text without requiring a page refresh
