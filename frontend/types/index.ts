/**
 * Type definitions for the chatbot application.
 */

export type MessageRole = 'user' | 'assistant' | 'system';

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  /** Optional answer options for interactive questions (single question mode) */
  options?: string[];
  /** Whether this message is waiting for user selection */
  isQuestion?: boolean;
  /** Multiple questions with options (multi-question mode) */
  questions?: QuestionWithOptions[];
}

export interface Conversation {
  id: string;
  title?: string;
  messages: Message[];
  created_at: string;
  updated_at: string;
}

export interface SendMessageRequest {
  conversation_id?: string;
  message: string;
  /** Full conversation history for LLM context (server doesn't store) */
  conversation_history?: Array<{
    role: string;
    content: string;
  }>;
  /** User's preferred language for AI responses: 'en' or 'fa' */
  language?: string;
}

export interface SendMessageResponse {
  conversation_id: string;
  user_message: Message;
  assistant_message: Message;
}

/** Single question with options */
export interface QuestionWithOptions {
  question: string;
  options: string[];
  question_number: number;
}

/** Interrupt response from backend when clarification is needed */
export interface InterruptResponse {
  type: 'interrupt';
  /** Single question (for refinement questions) */
  question?: string;
  /** Options for single question */
  options?: string[];
  /** Multiple questions (for preliminary questions) */
  questions?: QuestionWithOptions[];
  /** Total number of questions (for multi-question mode) */
  total_questions?: number;
  thread_id: string;
}

/** Complete response from backend */
export interface CompleteResponse {
  type: 'complete';
  content: string;
}

/** Summary of a conversation for listing in sidebar */
export interface ConversationSummary {
  id: string;
  title?: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/** Response containing list of conversations */
export interface ConversationListResponse {
  conversations: ConversationSummary[];
}

/**
 * Error thrown when a server checkpoint has expired or is missing.
 * This happens when the LangGraph checkpoint is no longer available
 * and the conversation cannot be resumed from the exact workflow state.
 */
export class CheckpointExpiredError extends Error {
  constructor(message: string = 'This conversation cannot be resumed. The server session has expired.') {
    super(message);
    this.name = 'CheckpointExpiredError';
  }
}
