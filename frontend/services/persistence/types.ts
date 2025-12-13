/**
 * PersistenceService types and interfaces.
 * Provides centralized persistence with retry logic, queuing, and event emission.
 * 
 * Requirements: 1.1, 1.2, 7.1, 7.2, 7.3, 7.4
 */

import { Message, QuestionWithOptions } from '@/types';
import { StorageErrorCode } from '@/services/storage/types';

/**
 * Graph state for persistence.
 * Matches the structure expected by StoredGraphState.
 */
export interface GraphState {
  completedStages: string[];
  waitingNodeId: string | null;
  stagesLiveData: Record<string, Record<string, unknown>>;
}

/**
 * Events emitted by the PersistenceService.
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */
export interface PersistenceEvents {
  /** Emitted when a save operation begins */
  saveStarted: {
    conversationId: string;
    messageCount: number;
    hasGraphState: boolean;
  };
  /** Emitted when a save operation succeeds */
  saveCompleted: {
    conversationId: string;
    durationMs: number;
  };
  /** Emitted when a save operation fails after all retries */
  saveFailed: {
    conversationId: string;
    error: string;
    errorCode: StorageErrorCode;
  };
  /** Emitted when the save queue changes */
  queueUpdated: {
    conversationId: string;
    queueDepth: number;
  };
}

/**
 * Save request containing all data needed to persist a conversation.
 * Requirements: 1.2
 */
export interface SaveRequest {
  conversationId: string;
  messages: Message[];
  threadId: string | null;
  isInterrupted: boolean;
  pendingQuestion: string | null;
  pendingOptions: string[];
  pendingQuestions: QuestionWithOptions[];
  graphState: GraphState;
  existingCreatedAt?: string;
}

/**
 * Event handler type for persistence events.
 */
export type PersistenceEventHandler<K extends keyof PersistenceEvents> = (
  data: PersistenceEvents[K]
) => void;

/**
 * Centralized persistence service interface.
 * Requirements: 1.1
 */
export interface IPersistenceService {
  /**
   * Save a conversation with retry and queue logic.
   * Returns a promise that resolves when save completes or rejects after all retries fail.
   */
  saveConversation(request: SaveRequest): Promise<void>;

  /**
   * Check if a conversation has a save in progress.
   */
  isSaving(conversationId: string): boolean;

  /**
   * Check if any conversation has pending saves.
   */
  hasPendingSaves(): boolean;

  /**
   * Subscribe to persistence events.
   * Returns an unsubscribe function.
   */
  on<K extends keyof PersistenceEvents>(
    event: K,
    handler: PersistenceEventHandler<K>
  ): () => void;

  /**
   * Get the current queue depth for a conversation.
   */
  getQueueDepth(conversationId: string): number;
}
