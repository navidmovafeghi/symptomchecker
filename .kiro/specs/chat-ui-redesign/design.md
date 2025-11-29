# Design Document

## Overview

This design document outlines the UI redesign of the chat application to match a modern, light-themed design reference. The redesign transforms the current dark-sidebar interface into a bright, professional chat experience with blue accents, avatar icons, and mobile responsiveness while preserving all existing functionality.

The implementation will modify the existing `ChatPage.tsx` and `Sidebar.tsx` components, updating Tailwind CSS classes and adding new UI elements (icons, mobile menu toggle, overlay).

## Architecture

The redesign follows the existing component architecture:

```
frontend/
├── app/
│   └── page.tsx              # Entry point (unchanged)
├── presentation/
│   ├── ChatPage.tsx          # Main chat interface (modified)
│   └── Sidebar.tsx           # Sidebar component (modified)
└── viewmodels/
    └── useChatViewModel.ts   # Business logic (unchanged)
```

No new components are required. The changes are purely presentational (CSS classes and JSX structure).

## Components and Interfaces

### ChatPage Component Changes

The ChatPage component will be restructured to:
1. Add mobile sidebar state management (`sidebarOpen`)
2. Add mobile menu toggle button
3. Add overlay for mobile sidebar
4. Update message rendering with avatars
5. Update input area styling

```typescript
// New state for mobile sidebar
const [sidebarOpen, setSidebarOpen] = useState(false);

// New props passed to Sidebar
<Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
```

### Sidebar Component Changes

The Sidebar component will receive new props:
```typescript
interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}
```

### Icon Dependencies

The design requires Lucide React icons:
- `Plus` - New Chat button
- `Bot` - AI avatar
- `User` - User avatar
- `Menu` - Mobile menu open
- `X` - Mobile menu close
- `Send` - Send button
- `Mic` - Microphone button

## Data Models

No changes to data models. The redesign is purely presentational.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following properties can be verified:

### Property 1: AI messages display Bot avatar
*For any* AI message rendered in the chat, the message container SHALL include a Bot icon avatar element positioned to the left of the message content.
**Validates: Requirements 2.1**

### Property 2: User messages display User avatar
*For any* user message rendered in the chat, the message container SHALL include a User icon avatar element positioned to the right of the message content.
**Validates: Requirements 2.2**

### Property 3: User messages have blue bubble styling
*For any* user message rendered in the chat, the message bubble SHALL have blue background classes (`bg-blue-50`, `text-blue-900`) and right alignment (`justify-end`).
**Validates: Requirements 3.1**

### Property 4: AI messages have no bubble background
*For any* AI message rendered in the chat, the message content SHALL NOT have a bubble background class, displaying as plain text.
**Validates: Requirements 3.2**

### Property 5: Send button enabled state matches input content
*For any* input state, the send button SHALL have blue background (`bg-blue-600`) when input is non-empty, and gray disabled styling (`bg-slate-200`) when input is empty.
**Validates: Requirements 5.3, 5.4**

## Error Handling

No changes to error handling. Existing error banners and storage warnings will be restyled to match the new design aesthetic but maintain the same functionality.

## Testing Strategy

### Unit Tests
- Verify Sidebar renders with correct light theme classes
- Verify New Chat button has blue styling and Plus icon
- Verify conversation items have correct active/hover states
- Verify mobile menu toggle shows/hides sidebar
- Verify overlay renders when sidebar is open on mobile
- Verify input area has correct styling and icons
- Verify header displays "Assistant" title and version badge

### Property-Based Tests
The design will use Vitest with `@fast-check/vitest` for property-based testing.

Each property test will:
1. Generate random message data (content, role)
2. Render the message component
3. Assert the property holds for all generated inputs

Property tests will be annotated with requirement references:
```typescript
// **Feature: chat-ui-redesign, Property 1: AI messages display Bot avatar**
// **Validates: Requirements 2.1**
```

Configuration: Each property test will run a minimum of 100 iterations.
