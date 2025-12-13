# Requirements Document

## Introduction

This feature restructures the graph visualization layout to move it from inside the chat panel to a dedicated right sidebar at the page level. Currently, the "Behind the Scenes" graph visualization is rendered within the chat area's rounded card container. This change will position it as a true right sidebar that sits alongside the chat area, providing a cleaner separation of concerns and better visual hierarchy.

## Glossary

- **Graph Visualization Panel**: The collapsible UI component showing the workflow diagram
- **Chat Panel**: The main floating rounded card containing the chat messages and input
- **Left Sidebar**: The existing navigation sidebar on the left side of the page
- **Right Sidebar**: The new dedicated area for the graph visualization, outside the chat panel
- **Page Layout**: The top-level flex container that organizes left sidebar, chat panel, and right sidebar

## Requirements

### Requirement 1

**User Story:** As a user, I want the graph visualization to appear as a dedicated right sidebar outside the chat area, so that I have a clearer visual separation between the chat and the workflow diagram.

#### Acceptance Criteria

1. WHEN the graph visualization panel is expanded THEN the System SHALL display it as a right sidebar at the page level, not inside the chat panel
2. WHEN the page layout renders THEN the System SHALL organize content as: left sidebar, chat panel, right sidebar (graph)
3. WHEN the graph panel is collapsed THEN the System SHALL allow the chat panel to use the full available width
4. WHEN the graph panel is expanded THEN the System SHALL reduce the chat panel width to accommodate the right sidebar

### Requirement 2

**User Story:** As a user, I want the toggle button for the graph visualization to be positioned at the edge of the right sidebar area, so that I can easily access it without it being inside the chat.

#### Acceptance Criteria

1. WHEN the graph panel is collapsed THEN the System SHALL display the toggle button on the right edge of the viewport
2. WHEN the graph panel is expanded THEN the System SHALL display the toggle button at the left edge of the graph sidebar
3. WHEN the user clicks the toggle button THEN the System SHALL smoothly animate the sidebar open or closed

### Requirement 3

**User Story:** As a user, I want the layout to work correctly on mobile devices, so that the graph sidebar doesn't break the mobile experience.

#### Acceptance Criteria

1. WHEN the screen width is below 768 pixels THEN the System SHALL display the graph panel as an overlay rather than pushing content
2. WHEN the graph panel is open on mobile THEN the System SHALL display a backdrop overlay behind it
3. WHEN the user taps the backdrop on mobile THEN the System SHALL close the graph panel

### Requirement 4

**User Story:** As a user, I want the layout to support RTL languages, so that the sidebar positions correctly for Persian users.

#### Acceptance Criteria

1. WHEN the user's locale is Persian (RTL) THEN the System SHALL position the graph sidebar on the left side instead of right
2. WHEN in RTL mode THEN the System SHALL mirror the toggle button position accordingly
3. WHEN in RTL mode THEN the System SHALL maintain proper flex direction for the page layout

