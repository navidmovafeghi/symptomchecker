/**
 * PersistenceService - Centralized conversation persistence with retry and queue logic.
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4
 */

import { Message } from '@/types';
import {
  getStorageService,
  IStorageService,
  StorageError,
  StoredConversation,
  StoredMessage,
  StoredQuestionWithOptions,
} from '@/services/storage';
import {
  SaveRequest,
  PersistenceEvents,
  PersistenceEventHandler,
  IPersistenceService,
} from './types';

/**
 * Helper function to convert Message to StoredMessage.
 */
function messageToStoredMessage(msg: Message): StoredMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    options: msg.options,
    isQuestion: msg.isQuestion,
    questions: msg.questions,
  };
}

/**
 * Helper function to convert QuestionWithOptions to StoredQuestionWithOptions.
 */
function questionToStoredQuestion(q: { question: string; options: string[]; question_number: number }): StoredQuestionWithOptions {
  return {
    question: q.question,
    options: q.options,
    question_number: q.question_number,
  };
}

/**
 * Helper function to generate a title from the first user message.
 */
function generateTitle(messages: Message[]): string | null {
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (!firstUserMessage) return null;
  const content = firstUserMessage.content.trim();
  return content.length > 50 ? content.substring(0, 47) + '...' : content;
}


/**
 * PersistenceService implementation.
 * Provides centralized persistence with:
 * - Per-conversation queues for sequential processing (Requirements: 3.1, 3.2)
 * - Queue optimization: newer saves replace pending saves (Requirements: 3.3)
 * - Parallel saves for different conversations (Requirements: 3.4)
 * - Retry logic with exponential backoff (Requirements: 2.1)
 * - Event emission for lifecycle tracking (Requirements: 7.1, 7.2, 7.3, 7.4)
 */
export class PersistenceService implements IPersistenceService {
  /** Per-conversation save queues */
  private queues: Map<string, SaveRequest[]> = new Map();
  
  /** Set of conversation IDs currently being processed */
  private processing: Set<string> = new Set();
  
  /** Event handlers by event type */
  private eventHandlers: Map<keyof PersistenceEvents, Set<PersistenceEventHandler<any>>> = new Map();
  
  /** Maximum retry attempts for transient failures */
  private readonly MAX_RETRIES = 3;
  
  /** Exponential backoff delays in milliseconds */
  private readonly RETRY_DELAYS = [100, 200, 400];
  
  /** Optional custom storage service for testing */
  private customStorageService?: IStorageService;
  
  /**
   * Constructor with optional storage service for testing.
   * @param storageService Optional custom storage service (uses getStorageService() if not provided)
   */
  constructor(storageService?: IStorageService) {
    this.customStorageService = storageService;
  }
  
  /**
   * Get the storage service to use.
   */
  private getStorage(): IStorageService {
    return this.customStorageService || getStorageService();
  }

  /**
   * Save a conversation with retry and queue logic.
   * Requirements: 1.1, 3.1, 3.2, 3.3
   */
  async saveConversation(request: SaveRequest): Promise<void> {
    const { conversationId } = request;
    
    // Add to queue, replacing any pending save with newer data
    this.enqueue(request);
    
    // If not already processing this conversation, start processing
    if (!this.processing.has(conversationId)) {
      await this.processQueue(conversationId);
    } else {
      // Already processing - the request is queued and will be processed
      // Wait for the queue to be processed
      await this.waitForQueueCompletion(conversationId);
    }
  }

  /**
   * Check if a conversation has a save in progress.
   * Requirements: 5.1
   */
  isSaving(conversationId: string): boolean {
    return this.processing.has(conversationId);
  }

  /**
   * Check if any conversation has pending saves.
   * Requirements: 5.4
   */
  hasPendingSaves(): boolean {
    return this.processing.size > 0;
  }

  /**
   * Subscribe to persistence events.
   * Requirements: 7.1, 7.2, 7.3, 7.4
   */
  on<K extends keyof PersistenceEvents>(
    event: K,
    handler: PersistenceEventHandler<K>
  ): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    
    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * Get the current queue depth for a conversation.
   */
  getQueueDepth(conversationId: string): number {
    return this.queues.get(conversationId)?.length || 0;
  }

  /**
   * Add a save request to the queue.
   * Replaces any pending save with newer data (optimization).
   * Requirements: 3.3
   */
  private enqueue(request: SaveRequest): void {
    const { conversationId } = request;
    const queue = this.queues.get(conversationId) || [];
    
    // Replace pending save with newer data (optimization)
    // Only replace if there's a pending item (not the one being processed)
    if (queue.length > 0) {
      queue[queue.length - 1] = request;
    } else {
      queue.push(request);
    }
    
    this.queues.set(conversationId, queue);
    this.emit('queueUpdated', { conversationId, queueDepth: queue.length });
    
    console.log(`[PersistenceService] Queued save for ${conversationId}, queue depth: ${queue.length}`);
  }

  /**
   * Process the queue for a conversation sequentially.
   * Requirements: 3.1, 3.2
   */
  private async processQueue(conversationId: string): Promise<void> {
    this.processing.add(conversationId);
    
    try {
      while (true) {
        const queue = this.queues.get(conversationId);
        if (!queue || queue.length === 0) break;
        
        const request = queue.shift()!;
        this.emit('queueUpdated', { conversationId, queueDepth: queue.length });
        
        await this.saveWithRetry(request);
      }
    } finally {
      this.processing.delete(conversationId);
      this.queues.delete(conversationId);
    }
  }

  /**
   * Wait for a conversation's queue to be fully processed.
   */
  private waitForQueueCompletion(conversationId: string): Promise<void> {
    return new Promise((resolve) => {
      const checkCompletion = () => {
        if (!this.processing.has(conversationId)) {
          resolve();
        } else {
          setTimeout(checkCompletion, 10);
        }
      };
      checkCompletion();
    });
  }

  /**
   * Save with retry logic and exponential backoff.
   * Requirements: 2.1, 2.2, 2.3, 2.4
   */
  private async saveWithRetry(request: SaveRequest): Promise<void> {
    const startTime = Date.now();
    const { conversationId, messages, graphState } = request;
    
    this.emit('saveStarted', {
      conversationId,
      messageCount: messages.length,
      hasGraphState: !!graphState,
    });
    
    console.log(`[PersistenceService] Starting save for ${conversationId}, ${messages.length} messages, hasGraphState: ${!!graphState}`);
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const storedConversation = this.buildStoredConversation(request);
        const storage = this.getStorage();
        await storage.saveConversation(storedConversation);
        
        const durationMs = Date.now() - startTime;
        this.emit('saveCompleted', { conversationId, durationMs });
        
        console.log(`[PersistenceService] Save completed for ${conversationId} in ${durationMs}ms`);
        return;
        
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry quota exceeded errors (Requirements: 2.4)
        if (error instanceof StorageError && error.code === 'QUOTA_EXCEEDED') {
          this.emit('saveFailed', {
            conversationId,
            error: error.message,
            errorCode: 'QUOTA_EXCEEDED',
          });
          console.error(`[PersistenceService] Quota exceeded for ${conversationId}, not retrying`);
          throw error;
        }
        
        // Log retry attempt (Requirements: 8.2)
        console.error(`[PersistenceService] Save attempt ${attempt + 1} failed for ${conversationId}:`, error);
        
        // Wait before retry (except on last attempt)
        if (attempt < this.MAX_RETRIES) {
          await this.delay(this.RETRY_DELAYS[attempt]);
        }
      }
    }
    
    // All retries exhausted (Requirements: 2.2)
    const errorCode = lastError instanceof StorageError ? lastError.code : 'UNKNOWN';
    this.emit('saveFailed', {
      conversationId,
      error: lastError?.message || 'Unknown error',
      errorCode,
    });
    
    console.error(`[PersistenceService] All retries exhausted for ${conversationId}`);
    throw lastError;
  }

  /**
   * Build a StoredConversation from a SaveRequest.
   * Requirements: 4.1 - Always includes graph_state
   */
  buildStoredConversation(request: SaveRequest): StoredConversation {
    const now = new Date().toISOString();
    
    return {
      id: request.conversationId,
      title: generateTitle(request.messages),
      messages: request.messages.map(messageToStoredMessage),
      created_at: request.existingCreatedAt || now,
      updated_at: now,
      version: 1,
      thread_id: request.threadId || request.conversationId,
      is_interrupted: request.isInterrupted,
      pending_question: request.pendingQuestion || undefined,
      pending_options: request.pendingOptions.length > 0 ? request.pendingOptions : undefined,
      pending_questions: request.pendingQuestions.length > 0 
        ? request.pendingQuestions.map(questionToStoredQuestion) 
        : undefined,
      graph_state: {
        completed_stages: request.graphState.completedStages,
        waiting_node_id: request.graphState.waitingNodeId,
        stages_live_data: request.graphState.stagesLiveData as Record<string, Record<string, unknown>>,
      },
    };
  }

  /**
   * Emit an event to all registered handlers.
   */
  private emit<K extends keyof PersistenceEvents>(
    event: K,
    data: PersistenceEvents[K]
  ): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[PersistenceService] Error in ${event} handler:`, err);
        }
      });
    }
    
    // Log queue updates (Requirements: 8.4)
    if (event === 'queueUpdated') {
      const { conversationId, queueDepth } = data as PersistenceEvents['queueUpdated'];
      console.log(`[PersistenceService] Queue updated for ${conversationId}, depth: ${queueDepth}`);
    }
  }

  /**
   * Delay helper for retry backoff.
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
