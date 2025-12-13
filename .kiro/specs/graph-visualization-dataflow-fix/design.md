# Design Document: Graph Visualization Data Flow Fix

## Overview

This feature fixes critical data flow issues in the graph visualization component that prevent accurate display of the symptom checker workflow progress. The fixes address mapping inconsistencies, state management bugs, and edge cases in stage completion tracking.

## Architecture

The fix touches three layers of the existing architecture:

```
backend/src/infrastructure/
├── symptom_checker_provider.py   # Fix stage message for collect_refinement_answer

frontend/
├── utils/
│   └── graphHelpers.ts           # Fix stage-to-node mapping
├── viewmodels/
│   └── useChatViewModel.ts       # Add stagesLiveData reset
└── presentation/
    └── ChatPage.tsx              # Fix completed stages tracking
```

### Data Flow (Current vs Fixed)

**Current (Broken):**
```
Backend: "Preparing follow-up question" → Frontend maps to: generate_refinement_question
                                          (Wrong! Should be collect_refinement_answer)
```

**Fixed:**
```
Backend: "Collecting your response" → Frontend maps to: collect_refinement_answer
Backend: "Preparing follow-up question" → Frontend maps to: generate_refinement_question
```

## Components and Interfaces

### Backend Stage Descriptions (Fixed)

```python
stage_descriptions_en = {
    "generate_questions": "Preparing screening questions",
    "collect_answers": "Processing your answers",
    "generate_ddx": "Analyzing symptoms",
    "generate_refinement_question": "Preparing follow-up question",
    "collect_refinement_answer": "Collecting your response",  # NEW distinct message
    "refine_ddx": "Refining diagnosis",
    "generate_final_summary": "Preparing your assessment",
}
```

### Frontend Stage Mapping (Fixed)

```typescript
const STAGE_TO_NODE_MAP: Record<string, GraphNodeId> = {
  // English
  'Preparing screening questions': 'generate_questions',
  'Processing your answers': 'collect_answers',
  'Analyzing symptoms': 'generate_ddx',
  'Preparing follow-up question': 'generate_refinement_question',
  'Collecting your response': 'collect_refinement_answer',  // NEW
  'Refining diagnosis': 'refine_ddx',
  'Preparing your assessment': 'generate_final_summary',
  
  // Persian equivalents...
};
```

### ViewModel State Reset

```typescript
// In newConversation() and selectConversation()
set({
  // ... existing resets
  stagesLiveData: {},  // NEW: Clear accumulated live data
  currentStage: null,
  currentStageMessage: null,
  currentStageData: null,
});
```

### ChatPage Completion Tracking (Fixed)

```typescript
// Handle null transition to mark last stage as completed
useEffect(() => {
  const currentNodeId = currentStageMessage ? mapStageToNode(currentStageMessage) : null;
  
  // When stage changes OR becomes null, mark previous as completed
  if (previousStageRef.current && previousStageRef.current !== currentNodeId) {
    setCompletedStages(prev => {
      if (!prev.includes(previousStageRef.current!)) {
        return [...prev, previousStageRef.current!];
      }
      return prev;
    });
  }
  
  previousStageRef.current = currentNodeId;
}, [currentStageMessage]);

// Also mark as completed when loading ends
useEffect(() => {
  if (!isLoading && previousStageRef.current) {
    setCompletedStages(prev => {
      if (!prev.includes(previousStageRef.current!)) {
        return [...prev, previousStageRef.current!];
      }
      return prev;
    });
  }
}, [isLoading]);
```

## Data Models

### Stage Message Uniqueness Constraint

Each node MUST have a unique stage message to ensure unambiguous mapping:

| Node ID | English Message | Persian Message |
|---------|-----------------|-----------------|
| generate_questions | Preparing screening questions | آماده‌سازی سوالات غربالگری |
| collect_answers | Processing your answers | در حال پردازش پاسخ‌های شما |
| generate_ddx | Analyzing symptoms | در حال تحلیل علائم |
| generate_refinement_question | Preparing follow-up question | آماده‌سازی سوال تکمیلی |
| collect_refinement_answer | Collecting your response | در حال دریافت پاسخ شما |
| refine_ddx | Refining diagnosis | اصلاح تشخیص |
| generate_final_summary | Preparing your assessment | آماده‌سازی ارزیابی شما |

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Stage message mapping uniqueness

*For any* two distinct node IDs in the graph, their corresponding stage messages SHALL be different strings.

**Validates: Requirements 2.2**

### Property 2: collect_refinement_answer mapping correctness

*For any* stage message containing "Collecting your response" or "در حال دریافت پاسخ شما", the mapping function SHALL return `collect_refinement_answer`.

**Validates: Requirements 1.1**

### Property 3: Unknown stage graceful handling

*For any* stage message not in the mapping, the mapping function SHALL return null without throwing an error.

**Validates: Requirements 2.3**

### Property 4: New conversation clears live data

*For any* call to `newConversation()`, the `stagesLiveData` state SHALL become an empty object.

**Validates: Requirements 3.1, 3.2**

### Property 5: Stage transition marks previous as completed

*For any* transition from stage A to stage B (where A ≠ B and A ≠ null), stage A SHALL be added to `completedStages`.

**Validates: Requirements 4.1, 5.1**

### Property 6: Loading end marks last stage completed

*For any* transition where `isLoading` changes from true to false while a stage was active, that stage SHALL be added to `completedStages`.

**Validates: Requirements 4.3**

## Error Handling

| Error Scenario | Handling Strategy |
|----------------|-------------------|
| Unknown stage message | Return null, log warning (existing behavior) |
| `processing` pseudo-stage | Map to null, no error (graceful degradation) |
| Rapid stage transitions | Use React state batching, no race conditions |
| Missing Persian translation | Fall back to English message |

## Testing Strategy

### Property-Based Testing

We will use **fast-check** for property-based testing. Each property test will run a minimum of 100 iterations.

Property tests will be tagged with the format: `**Feature: graph-visualization-dataflow-fix, Property {number}: {property_text}**`

### Unit Tests

Unit tests will cover:
- Stage message to node ID mapping for all 7 nodes
- State reset in `newConversation()` and `selectConversation()`
- Completed stages tracking through stage transitions
- Edge case: null stage message handling

### Test File Structure

```
frontend/tests/
├── utils/
│   └── graphHelpers.test.ts      # Extended with new mapping tests
└── viewmodels/
    └── useChatViewModel.test.ts  # State reset tests

backend/tests/
└── infrastructure/
    └── test_symptom_checker_provider.py  # Stage message uniqueness
```
