/**
 * Storage service types and interfaces for client-side conversation storage.
 * Requirements: 5.1, 6.1
 */

import { MessageRole } from '@/types';

/**
 * Error codes for storage operations.
 */
export type StorageErrorCode = 
  | 'UNAVAILABLE'      // IndexedDB not available
  | 'QUOTA_EXCEEDED'   // Browser storage full
  | 'CORRUPTION'       // Data corruption detected
  | 'UNKNOWN';         // Unknown error

/**
 * Custom error class for storage operations.
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: StorageErrorCode
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

/**
 * Question with options for multi-question mode.
 */
export interface StoredQuestionWithOptions {
  question: string;
  options: string[];
  question_number: number;
}

/**
 * Stored message structure in IndexedDB.
 */
export interface StoredMessage {
  id: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  options?: string[];
  isQuestion?: boolean;
  /** Multiple questions with options (multi-question mode) */
  questions?: StoredQuestionWithOptions[];
}

/**
 * Stored graph state for persistence.
 * Requirements: 3.1, 3.2, 3.3
 */
export interface StoredGraphState {
  /** Array of completed node IDs in execution order */
  completed_stages: string[];
  /** Node currently waiting for user input (interrupt) */
  waiting_node_id: string | null;
  /** Live data accumulated for each stage */
  stages_live_data: Record<string, Record<string, unknown>>;
}

/**
 * Stored conversation structure in IndexedDB.
 */
export interface StoredConversation {
  id: string;
  title: string | null;
  messages: StoredMessage[];
  created_at: string;
  updated_at: string;
  version: number;
  thread_id: string;
  is_interrupted: boolean;
  pending_question?: string;
  pending_options?: string[];
  /** Multiple pending questions (multi-question mode) */
  pending_questions?: StoredQuestionWithOptions[];
  /** Graph visualization state (optional for backward compatibility) */
  graph_state?: StoredGraphState;
}

/**
 * Summary of a conversation for listing.
 */
export interface StoredConversationSummary {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

/**
 * Storage service interface for abstracting IndexedDB operations.
 * Requirements: 5.1, 5.2
 */
export interface IStorageService {
  /**
   * Initialize the storage service.
   */
  initialize(): Promise<void>;

  /**
   * Check if storage is available after initialization.
   * Returns true if the storage service has been successfully initialized.
   */
  isAvailable(): boolean;

  /**
   * Save a conversation to storage.
   */
  saveConversation(conversation: StoredConversation): Promise<void>;

  /**
   * Get a conversation by ID.
   */
  getConversation(id: string): Promise<StoredConversation | null>;

  /**
   * Delete a conversation by ID.
   */
  deleteConversation(id: string): Promise<boolean>;

  /**
   * List all conversations.
   */
  listConversations(): Promise<StoredConversationSummary[]>;

  /**
   * Find the most recently updated interrupted conversation.
   * Returns null if no interrupted conversations exist.
   * Requirements: 4.1
   */
  findInterruptedConversation(): Promise<StoredConversation | null>;

  /**
   * Migrate data if needed for schema changes.
   */
  migrateIfNeeded(): Promise<void>;
}
