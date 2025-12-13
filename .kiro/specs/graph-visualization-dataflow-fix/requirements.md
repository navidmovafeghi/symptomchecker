# Requirements Document

## Introduction

This feature addresses critical data flow issues in the graph visualization component that prevent accurate display of the symptom checker workflow progress. The current implementation has mapping inconsistencies between backend stage messages and frontend node IDs, state management issues that cause stale data, and edge cases where nodes are never properly marked as active or completed.

## Glossary

- **Stage Message**: A human-readable string sent by the backend indicating the current processing step (e.g., "Preparing screening questions")
- **Node ID**: A programmatic identifier for a graph node (e.g., `generate_questions`, `collect_refinement_answer`)
- **Stage-to-Node Mapping**: The translation layer that converts backend stage messages to frontend node IDs
- **Live Data**: Real-time metrics from each stage (e.g., question count, top diagnosis)
- **Completed Stages**: Array tracking which nodes have finished processing

## Requirements

### Requirement 1

**User Story:** As a user, I want the `collect_refinement_answer` node to be highlighted when the system is collecting my refinement answers, so that I can see accurate progress through the workflow.

#### Acceptance Criteria

1. WHEN the backend sends a stage update for `collect_refinement_answer` THEN the System SHALL map it to the correct node ID `collect_refinement_answer`
2. WHEN the `collect_refinement_answer` node is active THEN the System SHALL display it with the active visual indicator
3. WHEN the `collect_refinement_answer` node completes THEN the System SHALL mark it as completed with the completed visual style

### Requirement 2

**User Story:** As a user, I want the graph visualization to show consistent stage messages that match the actual processing step, so that I understand what the system is doing.

#### Acceptance Criteria

1. WHEN the backend processes the `collect_refinement_answer` node THEN the System SHALL send a distinct stage message that differs from `generate_refinement_question`
2. WHEN the frontend receives a stage message THEN the System SHALL map it to exactly one node ID without ambiguity
3. WHEN the backend sends a `processing` stage during resume operations THEN the System SHALL handle it gracefully without errors

### Requirement 3

**User Story:** As a user, I want the graph visualization to reset properly when I start a new conversation, so that I see fresh progress tracking.

#### Acceptance Criteria

1. WHEN a new conversation starts THEN the System SHALL clear all accumulated live data from previous stages
2. WHEN a new conversation starts THEN the System SHALL reset all nodes to pending status
3. WHEN a conversation is selected from history THEN the System SHALL not display stale live data from other conversations

### Requirement 4

**User Story:** As a user, I want the final stage to be marked as completed when the assessment finishes, so that I can see the workflow reached its end.

#### Acceptance Criteria

1. WHEN the `generate_final_summary` node completes and the stage message becomes null THEN the System SHALL mark `generate_final_summary` as completed
2. WHEN all processing finishes THEN the System SHALL display all executed nodes as completed
3. WHEN the loading state ends THEN the System SHALL ensure the last active node transitions to completed status

### Requirement 5

**User Story:** As a user, I want the `generate_refinement_question` node to show accurate status, so that the visualization reflects the actual workflow execution.

#### Acceptance Criteria

1. WHEN the backend skips sending stage updates for `generate_refinement_question` THEN the System SHALL either remove this node from the visualization or mark it as completed when its successor activates
2. WHEN the refinement loop executes THEN the System SHALL show consistent node status progression without gaps
3. WHEN the workflow skips directly to `generate_final_summary` THEN the System SHALL mark skipped refinement nodes appropriately

</content>
</invoke>