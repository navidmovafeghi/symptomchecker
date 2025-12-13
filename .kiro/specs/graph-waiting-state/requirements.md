# Requirements Document

## Introduction

This feature adds a new "waiting" state to the graph visualization component. Currently, nodes can be in three states: pending (gray), active (purple), or completed (green). The new "waiting" state (blue) will indicate when a node is ready and waiting for user input, providing clearer feedback that the system is paused and awaiting user action rather than actively processing.

## Glossary

- **Graph_Visualization**: The sidebar panel component that displays the symptom checker workflow as a series of connected nodes
- **Node_Status**: The visual state of a graph node (pending, active, waiting, or completed)
- **Waiting_State**: A new node status indicating the system is paused and awaiting user input
- **Interrupt_Node**: A graph node that pauses execution to collect user input (collect_answers, collect_refinement_answer)

## Requirements

### Requirement 1

**User Story:** As a user, I want to see when the system is waiting for my input, so that I understand I need to take action rather than wait for processing to complete.

#### Acceptance Criteria

1. WHEN a graph node enters an interrupt state waiting for user input THEN the Graph_Visualization SHALL display that node with a blue visual indicator
2. WHEN the collect_answers node is waiting for user responses THEN the Graph_Visualization SHALL show the node in the waiting state with blue styling
3. WHEN the collect_refinement_answer node is waiting for a user response THEN the Graph_Visualization SHALL show the node in the waiting state with blue styling
4. WHEN a node transitions from waiting to active (user submits input) THEN the Graph_Visualization SHALL update the node to purple active styling within 200ms

### Requirement 2

**User Story:** As a user, I want the waiting state to be visually distinct from other states, so that I can quickly identify which node needs my attention.

#### Acceptance Criteria

1. WHEN a node is in the waiting state THEN the Graph_Visualization SHALL display a blue border color (e.g., blue-500)
2. WHEN a node is in the waiting state THEN the Graph_Visualization SHALL display a light blue background (e.g., blue-50)
3. WHEN a node is in the waiting state THEN the Graph_Visualization SHALL display a blue status indicator dot
4. WHEN a node is in the waiting state THEN the Graph_Visualization SHALL NOT display the pulsing animation used for active state

### Requirement 3

**User Story:** As a user, I want to see a clear status message when the system is waiting for my input, so that I understand what action is expected.

#### Acceptance Criteria

1. WHEN a node is in the waiting state THEN the Graph_Visualization SHALL display a status message indicating user input is required
2. WHEN the collect_answers node is waiting THEN the status message SHALL indicate the system is waiting for answers to screening questions
3. WHEN the collect_refinement_answer node is waiting THEN the status message SHALL indicate the system is waiting for a follow-up answer

### Requirement 4

**User Story:** As a user, I want the legend to include the waiting state, so that I understand what the blue color means.

#### Acceptance Criteria

1. WHEN the Graph_Visualization legend is displayed THEN the legend SHALL include an entry for the waiting state with blue indicator
2. WHEN the legend shows the waiting state THEN the label SHALL clearly indicate this means "Waiting for input" or equivalent localized text

### Requirement 5

**User Story:** As a developer, I want the waiting state to be properly typed and integrated, so that the codebase remains maintainable.

#### Acceptance Criteria

1. WHEN the NodeStatus type is defined THEN the type SHALL include 'waiting' as a valid status value
2. WHEN the backend sends an interrupt event THEN the frontend SHALL correctly identify the associated node as being in the waiting state
3. WHEN the isWaitingForInput state is true in the ViewModel THEN the appropriate interrupt node SHALL be displayed in the waiting state
