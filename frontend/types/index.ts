/**
 * Type definitions for the chatbot application.
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  /** Optional answer options for interactive questions */
  options?: string[];
  /** Whether this message is waiting for user selection */
  isQuestion?: boolean;
}

export interface Conversation {
  id: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

export interface SendMessageRequest {
  conversation_id?: string;
  message: string;
}

export interface SendMessageResponse {
  conversation_id: string;
  user_message: Message;
  assistant_message: Message;
}

/** Interrupt response from backend when clarification is needed */
export interface InterruptResponse {
  type: 'interrupt';
  question: string;
  options: string[];
  thread_id: string;
}

/** Complete response from backend */
export interface CompleteResponse {
  type: 'complete';
  content: string;
}
