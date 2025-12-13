# Implementation Plan

- [x] 1. Set up graph types and configuration
  - [x] 1.1 Create graph type definitions
    - Create `frontend/types/graph.ts` with `GraphNodeId`, `NodeStatus`, `GraphNode`, and `GraphEdge` interfaces
    - Define the `GRAPH_NODES` configuration array with all 7 nodes
    - Define the `GRAPH_EDGES` configuration array including conditional edges for refinement loop
    - _Requirements: 2.1, 2.3, 2.4_
  - [x] 1.2 Write property test for node content rendering
    - **Property 3: Node content rendering completeness**
    - **Validates: Requirements 2.2**
  - [x] 1.3 Write property test for node status styling
    - **Property 4: Node status styling consistency**
    - **Validates: Requirements 3.1, 3.2, 3.3**

- [x] 2. Add localization strings
  - [x] 2.1 Add English graph translations
    - Extend `frontend/locales/en.json` with node names, descriptions, and tooltips under `graph.nodes.*` keys
    - Add status messages under `graph.status.*` keys
    - Add toggle button text under `graph.toggle.*` keys
    - _Requirements: 2.2, 4.1, 4.2_
  - [x] 2.2 Add Persian graph translations
    - Extend `frontend/locales/fa.json` with Persian translations for all graph-related keys
    - Ensure patient-friendly language without technical jargon
    - _Requirements: 6.1, 6.2_
  - [x] 2.3 Write property test for Persian locale translation
    - **Property 6: Persian locale node text translation**
    - **Validates: Requirements 6.1**

- [x] 3. Create stage mapping utility
  - [x] 3.1 Implement stage-to-node mapping function
    - Create mapping from backend stage messages to `GraphNodeId`
    - Handle unknown stage messages gracefully (return null with console warning)
    - Export utility function `mapStageToNode(stageMessage: string): GraphNodeId | null`
    - _Requirements: 3.1, 3.4_
  - [x] 3.2 Write property test for active node status message
    - **Property 5: Active node status message correspondence**
    - **Validates: Requirements 4.3**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Create GraphVisualization component
  - [x] 5.1 Implement base component structure
    - Create `frontend/presentation/GraphVisualization.tsx`
    - Accept props: `currentStage`, `completedStages`, `isExpanded`, `onToggle`
    - Render toggle button with localized text
    - Conditionally render visualization panel based on `isExpanded`
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 5.2 Implement node rendering with status styling
    - Render all 7 nodes from `GRAPH_NODES` configuration
    - Apply CSS classes based on node status (pending, active, completed)
    - Display node name and brief description using localization
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3_
  - [x] 5.3 Implement edge rendering
    - Render directional connections between nodes
    - Visually distinguish conditional edges (refinement loop) with dashed lines or different color
    - _Requirements: 2.3, 2.4_
  - [x] 5.4 Implement tooltip functionality
    - Show detailed tooltip on hover (desktop) or tap (mobile)
    - Display localized detailed explanation from `tooltipKey`
    - _Requirements: 4.1, 5.2_
  - [x] 5.5 Implement status message display
    - Show current action message below the graph when a node is active
    - Update message when active node changes
    - _Requirements: 4.3_
  - [x] 5.6 Write property test for toggle round-trip
    - **Property 1: Toggle round-trip preserves state**
    - **Validates: Requirements 1.2, 1.3**

- [x] 6. Implement local storage persistence






  - [x] 6.1 Add storage utility for panel preferences

    - Create `frontend/utils/graphStorageHelpers.ts` with functions to read/write `isExpanded` state to local storage
    - Handle storage unavailable gracefully (default to collapsed)
    - Use storage key `graph_visualization_prefs`
    - _Requirements: 1.4_
  - [x] 6.2 Write property test for panel state persistence






    - **Property 2: Panel state persistence round-trip**
    - **Validates: Requirements 1.4**

- [x] 7. Integrate with ChatPage






  - [x] 7.1 Add GraphVisualization to ChatPage

    - Import and render `GraphVisualization` component in ChatPage
    - Position toggle button in non-intrusive location (top-right of chat panel header)
    - Use `currentStageMessage` from viewmodel with `mapStageToNode` to derive `currentStage`
    - Track `completedStages` locally in ChatPage using useEffect when stage changes
    - Manage `isExpanded` state with local storage persistence from task 6.1
    - _Requirements: 1.1, 3.1, 3.2, 3.3, 3.4_

  - [x] 7.2 Implement responsive layout

    - GraphVisualization already uses vertical layout on mobile (flex-col on small screens, flex-row on md+)
    - Ensure panel positioning doesn't obstruct chat input on mobile
    - _Requirements: 5.1, 5.3_

  - [x] 7.3 Implement RTL support

    - GraphVisualization already handles RTL via `direction` from useLocale
    - Verify graph flow direction mirrors correctly for RTL
    - _Requirements: 6.2_

- [x] 8. Final Checkpoint - Ensure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
