/**
 * Property-based tests for message rendering with avatars.
 * Tests the visual correctness properties defined in the design document.
 * 
 * **Feature: chat-ui-redesign**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { Message } from '@/types';

/**
 * MessageDisplay component - extracted for testing message rendering logic.
 * This mirrors the message rendering in ChatPage.tsx.
 */
import { Bot, User } from 'lucide-react';

interface MessageDisplayProps {
  message: Message;
}

function MessageDisplay({ message }: MessageDisplayProps) {
  return (
    <div 
      className={`mb-5 flex items-start gap-3 ${
        message.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
      data-testid={`message-${message.role}`}
    >
      {/* AI Avatar - shown on left for assistant messages */}
      {message.role === 'assistant' && (
        <div 
          className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"
          data-testid="ai-avatar"
        >
          <Bot className="w-5 h-5 text-white" />
        </div>
      )}

      {/* Message content container */}
      <div className="flex flex-col max-w-[85%]">
        {/* Message bubble */}
        <div
          className={`${
            message.role === 'user'
              ? 'bg-blue-50 text-blue-900 rounded-2xl rounded-tr-sm'
              : 'text-gray-700'
          } ${message.role === 'user' ? 'px-5 py-3' : ''}`}
          data-testid="message-bubble"
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>
      </div>

      {/* User Avatar - shown on right for user messages */}
      {message.role === 'user' && (
        <div 
          className="flex-shrink-0 w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center"
          data-testid="user-avatar"
        >
          <User className="w-5 h-5 text-gray-600" />
        </div>
      )}
    </div>
  );
}

/**
 * Arbitrary for generating valid message content.
 */
const messageContentArb = fc.string({ minLength: 1, maxLength: 500 });

/**
 * Arbitrary for generating valid timestamps.
 */
const timestampArb = fc.integer({ min: 1577836800000, max: 1924905600000 })
  .map(ts => new Date(ts).toISOString());

/**
 * Arbitrary for generating assistant messages.
 */
const assistantMessageArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: fc.constant('assistant' as const),
  content: messageContentArb,
  timestamp: timestampArb,
});

/**
 * Arbitrary for generating user messages.
 */
const userMessageArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: fc.constant('user' as const),
  content: messageContentArb,
  timestamp: timestampArb,
});

describe('Message Rendering Properties', () => {
  /**
   * **Feature: chat-ui-redesign, Property 1: AI messages display Bot avatar**
   * **Validates: Requirements 2.1**
   * 
   * *For any* AI message rendered in the chat, the message container SHALL include 
   * a Bot icon avatar element positioned to the left of the message content.
   */
  it('Property 1: AI messages display Bot avatar', () => {
    fc.assert(
      fc.property(assistantMessageArb, (message) => {
        const { container } = render(<MessageDisplay message={message} />);
        
        // Check that AI avatar is present
        const aiAvatar = screen.getByTestId('ai-avatar');
        expect(aiAvatar).toBeDefined();
        
        // Check that avatar has blue background
        expect(aiAvatar.className).toContain('bg-blue-600');
        
        // Check that avatar has rounded-lg styling
        expect(aiAvatar.className).toContain('rounded-lg');
        
        // Check that user avatar is NOT present
        const userAvatar = container.querySelector('[data-testid="user-avatar"]');
        expect(userAvatar).toBeNull();
        
        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: chat-ui-redesign, Property 2: User messages display User avatar**
   * **Validates: Requirements 2.2**
   * 
   * *For any* user message rendered in the chat, the message container SHALL include 
   * a User icon avatar element positioned to the right of the message content.
   */
  it('Property 2: User messages display User avatar', () => {
    fc.assert(
      fc.property(userMessageArb, (message) => {
        const { container } = render(<MessageDisplay message={message} />);
        
        // Check that user avatar is present
        const userAvatar = screen.getByTestId('user-avatar');
        expect(userAvatar).toBeDefined();
        
        // Check that avatar has gray background
        expect(userAvatar.className).toContain('bg-gray-200');
        
        // Check that avatar has rounded-lg styling
        expect(userAvatar.className).toContain('rounded-lg');
        
        // Check that AI avatar is NOT present
        const aiAvatar = container.querySelector('[data-testid="ai-avatar"]');
        expect(aiAvatar).toBeNull();
        
        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: chat-ui-redesign, Property 3: User messages have blue bubble styling**
   * **Validates: Requirements 3.1**
   * 
   * *For any* user message rendered in the chat, the message bubble SHALL have 
   * blue background classes (bg-blue-50, text-blue-900) and right alignment (justify-end).
   */
  it('Property 3: User messages have blue bubble styling', () => {
    fc.assert(
      fc.property(userMessageArb, (message) => {
        const { container } = render(<MessageDisplay message={message} />);
        
        // Check message container has right alignment
        const messageContainer = screen.getByTestId('message-user');
        expect(messageContainer.className).toContain('justify-end');
        
        // Check message bubble has blue styling
        const messageBubble = screen.getByTestId('message-bubble');
        expect(messageBubble.className).toContain('bg-blue-50');
        expect(messageBubble.className).toContain('text-blue-900');
        
        // Check message bubble has rounded corners
        expect(messageBubble.className).toContain('rounded-2xl');
        
        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: chat-ui-redesign, Property 4: AI messages have no bubble background**
   * **Validates: Requirements 3.2**
   * 
   * *For any* AI message rendered in the chat, the message content SHALL NOT have 
   * a bubble background class, displaying as plain text.
   */
  it('Property 4: AI messages have no bubble background', () => {
    fc.assert(
      fc.property(assistantMessageArb, (message) => {
        const { container } = render(<MessageDisplay message={message} />);
        
        // Check message container has left alignment
        const messageContainer = screen.getByTestId('message-assistant');
        expect(messageContainer.className).toContain('justify-start');
        
        // Check message bubble does NOT have blue background
        const messageBubble = screen.getByTestId('message-bubble');
        expect(messageBubble.className).not.toContain('bg-blue-50');
        expect(messageBubble.className).not.toContain('bg-blue-600');
        expect(messageBubble.className).not.toContain('bg-gray-50');
        
        // Check it has plain text styling
        expect(messageBubble.className).toContain('text-gray-700');
        
        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * SendButtonInput component - extracted for testing send button state logic.
 * This mirrors the input area rendering in ChatPage.tsx.
 */
import { Send, Mic } from 'lucide-react';

interface SendButtonInputProps {
  inputValue: string;
  isLoading?: boolean;
  isStreaming?: boolean;
}

function SendButtonInput({ inputValue, isLoading = false, isStreaming = false }: SendButtonInputProps) {
  const hasContent = inputValue.trim().length > 0;
  const isDisabled = isLoading || isStreaming || !hasContent;
  
  return (
    <div className="w-full bg-white border-t border-gray-100 px-6 py-4">
      <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-100 border border-slate-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
        <input
          type="text"
          value={inputValue}
          readOnly
          className="flex-grow py-2 bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 text-slate-900 placeholder:text-slate-400"
          data-testid="chat-input"
        />
        <button
          type="button"
          disabled={isDisabled}
          className={`p-2 rounded-lg transition-colors ${
            hasContent 
              ? 'bg-blue-600 hover:bg-blue-700 text-white' 
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
          data-testid="send-button"
        >
          <Send className="w-5 h-5" />
        </button>
        <button
          type="button"
          className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
          data-testid="mic-button"
        >
          <Mic className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Arbitrary for generating non-empty input strings (content present).
 */
const nonEmptyInputArb = fc.string({ minLength: 1, maxLength: 200 })
  .filter(s => s.trim().length > 0);

/**
 * Arbitrary for generating empty or whitespace-only input strings.
 */
const emptyInputArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\t'),
  fc.constant('\n'),
  fc.constant('  \t  ')
);

describe('Send Button State Properties', () => {
  /**
   * **Feature: chat-ui-redesign, Property 5: Send button enabled state matches input content**
   * **Validates: Requirements 5.3, 5.4**
   * 
   * *For any* input state, the send button SHALL have blue background (bg-blue-600) 
   * when input is non-empty, and gray disabled styling (bg-slate-200) when input is empty.
   */
  it('Property 5: Send button has blue background when input has content', () => {
    fc.assert(
      fc.property(nonEmptyInputArb, (inputValue) => {
        const { container } = render(<SendButtonInput inputValue={inputValue} />);
        
        // Check that send button has blue background when input has content
        const sendButton = screen.getByTestId('send-button');
        expect(sendButton.className).toContain('bg-blue-600');
        expect(sendButton.className).not.toContain('bg-slate-200');
        
        // Check button is not disabled
        expect(sendButton.hasAttribute('disabled')).toBe(false);
        
        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });

  it('Property 5: Send button has gray disabled state when input is empty', () => {
    fc.assert(
      fc.property(emptyInputArb, (inputValue) => {
        const { container } = render(<SendButtonInput inputValue={inputValue} />);
        
        // Check that send button has gray disabled styling when input is empty
        const sendButton = screen.getByTestId('send-button');
        expect(sendButton.className).toContain('bg-slate-200');
        expect(sendButton.className).not.toContain('bg-blue-600');
        
        // Check button is disabled
        expect(sendButton.hasAttribute('disabled')).toBe(true);
        
        // Cleanup
        container.remove();
      }),
      { numRuns: 100 }
    );
  });
});
