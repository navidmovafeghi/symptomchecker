# Changelog

## [Unreleased] - Graph Visualization Fixes

This release addresses fundamental architectural issues in the graph visualization feature where state was previously split between frontend React state, Zustand store, and backend LangGraph checkpoints. The refactoring establishes a single source of truth for graph state, ensures consistency between initial and resume flows, and properly persists graph visualization state across browser sessions.

### Summary

- Established Zustand store as the single source of truth for graph visualization state
- Created a dedicated GraphStateService module for graph state management
- Extended IndexedDB storage schema to persist graph state
- Fixed backend stage event consistency between initial and resume flows
- Added refinement loop iteration display (Round X of 5)
- Removed debug console.log statements from production code
- Implemented backward compatibility migration for existing conversations

---

### New Files Created

#### Frontend

| File | Description |
|------|-------------|
| `frontend/services/graphStateService.ts` | New service module implementing `IGraphStateService` interface for graph state management. Handles stage event processing, interrupt event processing, waiting node derivation, and backward compatibility migration. |
| `frontend/tests/services/graphStateService.test.ts` | Property-based tests for GraphStateService covering waiting node derivation, stage completion tracking, graph state reset, and backward compatibility migration. |
| `frontend/tests/utils/testArbitraries.ts` | Test utilities with fast-check arbitraries for generating valid graph states, interrupt events, and messages. |

---

### Modified Files

#### Frontend

| File | Changes |
|------|---------|
| `frontend/services/storage/types.ts` | Added `StoredGraphState` interface with `completed_stages`, `waiting_node_id`, and `stages_live_data` fields. Extended `StoredConversation` with optional `graph_state` field for backward compatibility. |
| `frontend/services/storage/indexedDBStorage.ts` | Updated `saveConversation` and `getConversation` to handle graph state persistence. No schema migration needed as graph_state is optional. |
| `frontend/viewmodels/useChatViewModel.ts` | Added `graphState: GraphState` to Zustand store. Integrated GraphStateService for processing stage events, interrupt events, and complete events. Added `updateGraphState` action for atomic updates. Updated `selectConversation` to restore graph state with migration support. Updated `newConversation` and `deleteConversation` to reset graph state. |
| `frontend/presentation/GraphVisualization.tsx` | Updated to read graph state from Zustand store as single source of truth. Added refinement round display (Round X of 5). Removed debug console.log statements. Kept legacy props for backward compatibility. |
| `frontend/presentation/ChatPage.tsx` | Removed local React state for graph visualization. Now reads `graphState` from Zustand store. Passes graph state to GraphVisualization component. |
| `frontend/tests/viewmodel/useChatViewModel.test.ts` | Added property tests for atomic state updates, sequential stage processing, graph state reset, and conversation delete cleanup. |
| `frontend/tests/storage/indexedDBStorage.test.ts` | Added property tests for graph state persistence round-trip and backward compatibility migration. |
| `frontend/tests/presentation/graphVisualization.test.tsx` | Added property test for direct stage mapping. |

#### Backend

| File | Changes |
|------|---------|
| `backend/src/infrastructure/symptom_checker_provider.py` | Removed "processing" pseudo-stage from `resume_stream` initial yield. Now uses actual node name from first event. Added `refinement_round` to stage data for `collect_refinement_answer` and `refine_ddx` nodes. |
| `backend/tests/test_stage_event_consistency.py` | Added property tests for backend stage name consistency and refinement count in stage data. |

---

### Architecture Changes

#### Before (Problems)
```
┌─────────────────────────────────────────────────────────────────┐
│  ChatPage (React State)     Zustand Store      Backend          │
│  ├─ currentStage           ├─ messages        ├─ LangGraph      │
│  ├─ completedStages        ├─ threadId        │  Checkpoints    │
│  ├─ liveData               ├─ isWaiting       │                 │
│  └─ waitingNode            └─ ...             │                 │
│                                                                  │
│  Problems:                                                       │
│  • State scattered across 3 locations                           │
│  • No persistence of graph state to IndexedDB                   │
│  • "processing" pseudo-stage on resume breaks mapping           │
│  • Waiting node not derived consistently                        │
└─────────────────────────────────────────────────────────────────┘
```

#### After (Solution)
```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              Zustand Store (Single Source of Truth)       │   │
│  │  ├─ messages: Message[]                                   │   │
│  │  ├─ graphState: GraphState                                │   │
│  │  │   ├─ currentStage: GraphNodeId | null                  │   │
│  │  │   ├─ completedStages: GraphNodeId[]                    │   │
│  │  │   ├─ waitingNodeId: GraphNodeId | null                 │   │
│  │  │   └─ stagesLiveData: Record<GraphNodeId, LiveData>     │   │
│  │  └─ ...                                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                      │
│              ┌────────────┴────────────┐                        │
│              ▼                         ▼                        │
│  ┌─────────────────────┐   ┌─────────────────────┐             │
│  │   GraphStateService │   │   IndexedDB Storage │             │
│  │   (State Logic)     │   │   (Persistence)     │             │
│  └─────────────────────┘   └─────────────────────┘             │
└─────────────────────────────────────────────────────────────────┘
```

---

### Migration Notes for Existing Conversations

Existing conversations saved before this update will continue to work. The system automatically handles migration:

1. **Conversations without `graph_state`**: When loading a conversation that lacks the `graph_state` field, the ViewModel automatically derives:
   - `completedStages` from conversation message patterns
   - `waitingNodeId` from the `is_interrupted` flag and last assistant message type

2. **No data loss**: The migration is non-destructive. Original conversation data is preserved.

3. **Automatic upgrade**: When a migrated conversation is saved (e.g., after sending a new message), the derived graph state is persisted to IndexedDB.

#### Migration Logic

The `GraphStateService.migrateConversationGraphState()` method handles migration:

```typescript
// Derive completed stages from message patterns
- If assistant has questions → generate_questions completed
- If user responded → collect_answers completed  
- If assistant responded after user → generate_ddx completed
- Multiple exchanges → refinement stages completed

// Derive waiting node from interrupt state
- If is_interrupted && last message has questions array → collect_answers
- If is_interrupted && last message has single question → collect_refinement_answer
```

---

### Property-Based Tests Added

| Property | Description | Validates |
|----------|-------------|-----------|
| Property 2: Atomic State Updates | Stage events update currentStage, completedStages, and stagesLiveData in a single atomic operation | Requirements 1.3, 9.2 |
| Property 3: Waiting Node Derivation | Interrupt with questions array → collect_answers; single question → collect_refinement_answer | Requirements 1.4, 4.1, 4.2 |
| Property 4: Backend Stage Name Consistency | Stage events contain exact LangGraph node names | Requirements 2.1, 2.2, 2.3, 11.1 |
| Property 5: Refinement Count in Stage Data | Refinement nodes include refinement_round (1-5) | Requirements 2.4, 6.1, 6.2 |
| Property 6: Graph State Persistence Round-Trip | Save/load preserves completedStages, waitingNodeId, stagesLiveData | Requirements 3.1-3.4, 4.3, 4.4 |
| Property 7: Graph State Reset | newConversation() resets to INITIAL_GRAPH_STATE | Requirements 3.5, 10.1, 10.2 |
| Property 8: Stage Completion Tracking | Stage transitions mark previous stage as completed | Requirements 5.1-5.4 |
| Property 9: Backward Compatibility Migration | Conversations without graph_state derive state from messages | Requirements 8.1, 8.2, 8.3 |
| Property 10: Sequential Stage Processing | N stage events result in N-1 completed stages | Requirements 9.1 |
| Property 11: Direct Stage Mapping | Stage field used directly as GraphNodeId | Requirements 11.2, 11.3 |
| Property 12: Conversation Delete Cleanup | Deleting active conversation resets graph state | Requirements 10.3 |

---

### Breaking Changes

None. All changes are backward compatible.

---

### Requirements Addressed

- **Requirement 1**: Single Source of Truth for Graph State
- **Requirement 2**: Consistent Stage Event Format
- **Requirement 3**: Graph State Persistence
- **Requirement 4**: Correct Waiting Node Determination
- **Requirement 5**: Stage Completion Tracking
- **Requirement 6**: Refinement Loop Visualization
- **Requirement 7**: Clean Production Code
- **Requirement 8**: Backward Compatibility
- **Requirement 9**: Atomic State Updates
- **Requirement 10**: Graph State Reset on Conversation Changes
- **Requirement 11**: Frontend-Backend Stage Name Alignment
- **Requirement 12**: SOLID Architecture Principles
