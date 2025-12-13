# Implementation Plan

- [x] 1. Update type definitions






  - [x] 1.1 Add 'waiting' to NodeStatus type in frontend/types/graph.ts

    - Add 'waiting' as a valid NodeStatus value
    - _Requirements: 5.1_

- [x] 2. Update GraphVisualization component





  - [x] 2.1 Update GraphVisualizationProps interface


    - Add isWaitingForInput?: boolean prop
    - Add waitingNodeId?: GraphNodeId | null prop
    - _Requirements: 5.2, 5.3_

  - [x] 2.2 Update getNodeStatus function to handle waiting state

    - Add logic to return 'waiting' when isWaitingForInput is true and nodeId matches waitingNodeId
    - Ensure waiting state takes precedence over active state
    - _Requirements: 1.1, 1.2, 1.3_

  - [x] 2.3 Write property test for getNodeStatus waiting logic

    - **Property 1: Interrupt nodes display waiting status when awaiting input**
    - **Validates: Requirements 1.1, 1.2, 1.3, 5.2, 5.3**
  - [x] 2.4 Add blue styling for waiting state


    - Add border-blue-500 for waiting state border
    - Add bg-blue-50 for waiting state background
    - Add ring-2 ring-blue-200 for waiting state ring
    - Add blue status indicator dot (bg-blue-500, no animate-pulse)
    - Add blue text colors for node name and description
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 2.5 Write property test for waiting state CSS styling

    - **Property 2: Waiting state has correct CSS styling**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**
  - [x] 2.6 Add waiting state status message


    - Display status message when a node is in waiting state
    - Use appropriate i18n keys for the message
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 2.7 Write property test for waiting state status message


    - **Property 3: Waiting state displays appropriate status message**
    - **Validates: Requirements 3.1**
  - [x] 2.8 Update legend to include waiting state


    - Add blue indicator with "Waiting for input" label
    - Use i18n key for localization
    - _Requirements: 4.1, 4.2_

- [x] 3. Add localization strings





  - [x] 3.1 Add English waiting state strings to frontend/locales/en.json


    - Add graph.status.waiting key
    - _Requirements: 4.2_

  - [x] 3.2 Add Persian waiting state strings to frontend/locales/fa.json

    - Add graph.status.waiting key with Persian translation
    - _Requirements: 4.2_

- [x] 4. Update parent component to pass waiting props






  - [x] 4.1 Update the component that renders GraphVisualization

    - Determine waitingNodeId based on pendingQuestions and pendingQuestion
    - Pass isWaitingForInput and waitingNodeId props to GraphVisualization
    - _Requirements: 5.2, 5.3_

- [x] 5. Checkpoint - Make sure all tests pass





  - Ensure all tests pass, ask the user if questions arise.
