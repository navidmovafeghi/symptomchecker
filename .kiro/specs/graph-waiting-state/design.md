# Design Document: Graph Waiting State

## Overview

This feature adds a new "waiting" state to the graph visualization component. The waiting state (displayed in blue) indicates when a node is paused and awaiting user input, providing clearer visual feedback that distinguishes between "system is processing" (purple/active) and "system is waiting for you" (blue/waiting).

## Architecture

The feature follows the existing MVVM architecture:

```
┌─────────────────────────────────────────────────────────────────┐
│                         ViewModel                                │
│  useChatViewModel.ts                                            │
│  - isWaitingForInput: boolean                                   │
│  - pendingQuestions: QuestionWithOptions[]                      │
│  - pendingQuestion: string | null                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Types                                    │
│  graph.ts                                                        │
│  - NodeStatus: 'pending' | 'active' | 'waiting' | 'completed'   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         View                                     │
│  GraphVisualization.tsx                                          │
│  - getNodeStatus() updated to return 'waiting'                  │
│  - Blue styling for waiting state                               │
│  - Updated legend                                                │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. Updated NodeStatus Type

```typescript
// frontend/types/graph.ts
export type NodeStatus = 'pending' | 'active' | 'waiting' | 'completed';
```

### 2. Updated GraphVisualizationProps

```typescript
// frontend/presentation/GraphVisualization.tsx
export interface GraphVisualizationProps {
  currentStage: GraphNodeId | null;
  completedStages: GraphNodeId[];
  isExpanded: boolean;
  onToggle: () => void;
  liveData?: Record<string, unknown>;
  stagesLiveData?: Record<string, Record<string, unknown>>;
  // NEW: indicates system is waiting for user input
  isWaitingForInput?: boolean;
  // NEW: which node is waiting (derived from interrupt type)
  waitingNodeId?: GraphNodeId | null;
}
```

### 3. Updated getNodeStatus Function

```typescript
function getNodeStatus(
  nodeId: GraphNodeId,
  currentStage: GraphNodeId | null,
  completedStages: GraphNodeId[],
  isWaitingForInput: boolean,
  waitingNodeId: GraphNodeId | null
): NodeStatus {
  // Waiting state takes precedence for interrupt nodes
  if (isWaitingForInput && nodeId === waitingNodeId) {
    return 'waiting';
  }
  if (nodeId === currentStage) {
    return 'active';
  }
  if (completedStages.includes(nodeId)) {
    return 'completed';
  }
  return 'pending';
}
```

### 4. Waiting Node Determination Logic

The waiting node is determined based on the type of interrupt:
- If `pendingQuestions.length > 0` → waiting node is `'collect_answers'`
- If `pendingQuestion` is set → waiting node is `'collect_refinement_answer'`

## Data Models

No new data models required. The feature uses existing ViewModel state:
- `isWaitingForInput: boolean`
- `pendingQuestions: QuestionWithOptions[]`
- `pendingQuestion: string | null`

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Interrupt nodes display waiting status when awaiting input

*For any* graph state where `isWaitingForInput` is true and there are pending questions or a pending question, the appropriate interrupt node (`collect_answers` or `collect_refinement_answer`) SHALL have status `'waiting'`.

**Validates: Requirements 1.1, 1.2, 1.3, 5.2, 5.3**

### Property 2: Waiting state has correct CSS styling

*For any* node with status `'waiting'`, the rendered element SHALL have blue border classes, blue background classes, blue status indicator, and SHALL NOT have the `animate-pulse` class.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

### Property 3: Waiting state displays appropriate status message

*For any* node in the waiting state, the Graph_Visualization SHALL display a status message indicating user input is required.

**Validates: Requirements 3.1**

## Error Handling

- If `isWaitingForInput` is true but no `waitingNodeId` can be determined, fall back to showing the current stage as active
- If props are undefined, use safe defaults (empty arrays, null values)

## Testing Strategy

### Unit Tests

1. Test `getNodeStatus()` function with various combinations of inputs
2. Test waiting node determination logic
3. Test CSS class application for waiting state

### Property-Based Tests

Using a property-based testing library (e.g., fast-check), we will test:

1. **Property 1**: Generate random combinations of `isWaitingForInput`, `pendingQuestions`, `pendingQuestion`, and verify the correct node gets `'waiting'` status
2. **Property 2**: Generate nodes with `'waiting'` status and verify CSS classes are correctly applied
3. **Property 3**: Generate waiting states and verify status messages are displayed

### Integration Tests

1. Test the full flow from ViewModel state change to UI update
2. Test localization of waiting state messages (English and Persian)
