# Implementation Plan
# Implementation Plan

- [x] 1. Restructure ChatPage layout





  - [x] 1.1 Move GraphVisualization outside chat panel container


    - Move the `<GraphVisualization />` component from inside the chat panel div to be a sibling at the page level
    - Position it after the chat panel container in the flex layout
    - Ensure the component renders at the same level as the Sidebar and chat panel
    - _Requirements: 1.1, 1.2_
  - [x] 1.2 Add dynamic margin to chat panel based on graph state


    - Add conditional margin class to the chat panel container when `isGraphExpanded` is true
    - Use `mr-80` (or equivalent) when expanded in LTR mode
    - Use `ml-80` when expanded in RTL mode
    - Add transition classes for smooth width adjustment
    - _Requirements: 1.3, 1.4_
  - [x] 1.3 Write property test for graph panel DOM independence


    - **Property 1: Graph panel DOM independence**
    - **Validates: Requirements 1.1, 1.2**

  - [x] 1.4 Write property test for chat panel width adjustment

    - **Property 2: Chat panel width adjustment**
    - **Validates: Requirements 1.3, 1.4**

- [x] 2. Update GraphVisualization positioning






  - [x] 2.1 Verify fixed positioning works at page level


    - Ensure the component's fixed positioning (`fixed top-0 right-0 h-full`) works correctly when rendered outside the chat panel
    - Verify toggle button positioning at viewport edge
    - _Requirements: 2.1, 2.2_
  - [x] 2.2 Verify RTL positioning


    - Confirm left-side positioning in RTL mode works correctly at page level
    - Verify toggle button mirrors correctly
    - _Requirements: 4.1, 4.2_

  - [x] 2.3 Write property test for RTL layout mirroring

    - **Property 3: RTL layout mirroring**
    - **Validates: Requirements 4.1, 4.2, 4.3**

- [x] 3. Verify mobile behavior





  - [x] 3.1 Test overlay behavior on mobile


    - Verify the graph panel displays as overlay on screens below 768px
    - Confirm backdrop overlay appears when panel is open
    - Verify tapping backdrop closes the panel
    - _Requirements: 3.1, 3.2, 3.3_

- [ ] 4. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

