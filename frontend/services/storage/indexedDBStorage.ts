/**
 * IndexedDB Storage Service implementation.
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.3
 */

import {
  IStorageService,
  StoredConversation,
  StoredConversationSummary,
  StorageError,
} from './types';

const DB_NAME = 'medical-chatbot';
const DB_VERSION = 2; // Bumped to fix boolean index issue
const STORE_NAME = 'conversations';

/**
 * IndexedDB-based storage service for conversations.
 */
export class IndexedDBStorageService implements IStorageService {
  private db: IDBDatabase | null = null;
  private available: boolean = false;

  /**
   * Static method to check if IndexedDB is supported in the current environment.
   * Can be called before creating an instance.
   * Requirements: 1.4, 5.3
   */
  static checkIndexedDBSupport(): boolean {
    // Check if IndexedDB is available (works in both browser and test environments)
    if (typeof indexedDB === 'undefined') {
      return false;
    }
    
    // Additional check for private browsing mode in some browsers
    // where IndexedDB exists but throws errors
    try {
      // Try to access indexedDB - some browsers throw in private mode
      const testRequest = indexedDB.open('__test__');
      testRequest.onerror = () => {
        // Clean up
        indexedDB.deleteDatabase('__test__');
      };
      testRequest.onsuccess = () => {
        testRequest.result.close();
        indexedDB.deleteDatabase('__test__');
      };
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Initialize the storage service and open the database.
   * Requirements: 1.4, 5.3
   */
  async initialize(): Promise<void> {
    // Check if IndexedDB is available
    if (!IndexedDBStorageService.checkIndexedDBSupport()) {
      this.available = false;
      throw new StorageError(
        'IndexedDB is not available in this browser',
        'UNAVAILABLE'
      );
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        this.available = false;
        reject(
          new StorageError(
            'Failed to open IndexedDB database',
            'UNAVAILABLE'
          )
        );
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.available = true;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        const oldVersion = event.oldVersion;
        this.createSchema(db, transaction, oldVersion);
      };
    });
  }

  /**
   * Create the database schema.
   * Note: IndexedDB doesn't support boolean keys, so we use a number (1/0) for is_interrupted_num
   */
  private createSchema(
    db: IDBDatabase,
    transaction: IDBTransaction | null,
    oldVersion: number
  ): void {
    // Fresh install - create everything from scratch
    if (oldVersion === 0) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('by-updated', 'updated_at', { unique: false });
      // Use a numeric field for the index since booleans aren't valid IndexedDB keys
      store.createIndex('by-interrupted', 'is_interrupted_num', { unique: false });
      return;
    }

    // Migration from v1 to v2: fix the boolean index issue
    if (oldVersion < 2 && transaction) {
      const store = transaction.objectStore(STORE_NAME);
      // Delete the old boolean-based index if it exists
      if (store.indexNames.contains('by-interrupted')) {
        store.deleteIndex('by-interrupted');
      }
      // Create new index using numeric field
      store.createIndex('by-interrupted', 'is_interrupted_num', { unique: false });
    }
  }

  /**
   * Check if storage is available.
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Validate that a conversation has all required fields.
   * Requirements: 6.2, 6.3
   */
  private validateConversation(data: unknown): StoredConversation | null {
    if (!data || typeof data !== 'object') {
      console.error('Data validation failed: data is not an object');
      return null;
    }

    const conv = data as Record<string, unknown>;

    // Check required fields
    if (typeof conv.id !== 'string' || !conv.id) {
      console.error('Data validation failed: missing or invalid id');
      return null;
    }

    if (!Array.isArray(conv.messages)) {
      console.error('Data validation failed: messages is not an array');
      return null;
    }

    if (typeof conv.created_at !== 'string' || !conv.created_at) {
      console.error('Data validation failed: missing or invalid created_at');
      return null;
    }

    if (typeof conv.updated_at !== 'string' || !conv.updated_at) {
      console.error('Data validation failed: missing or invalid updated_at');
      return null;
    }

    // Validate each message
    for (const msg of conv.messages) {
      if (!this.validateMessage(msg)) {
        console.error('Data validation failed: invalid message in conversation');
        return null;
      }
    }

    return data as StoredConversation;
  }

  /**
   * Validate that a message has all required fields.
   */
  private validateMessage(data: unknown): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const msg = data as Record<string, unknown>;

    if (typeof msg.id !== 'string' || !msg.id) {
      return false;
    }

    if (!['user', 'assistant', 'system'].includes(msg.role as string)) {
      return false;
    }

    if (typeof msg.content !== 'string') {
      return false;
    }

    if (typeof msg.timestamp !== 'string' || !msg.timestamp) {
      return false;
    }

    return true;
  }

  /**
   * Get the object store for transactions.
   */
  private getStore(mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) {
      throw new StorageError(
        'Database not initialized. Call initialize() first.',
        'UNAVAILABLE'
      );
    }
    const transaction = this.db.transaction(STORE_NAME, mode);
    return transaction.objectStore(STORE_NAME);
  }

  /**
   * Check if an error is a quota exceeded error.
   * Requirements: 2.4
   */
  private isQuotaExceededError(error: unknown): boolean {
    if (!error) return false;
    
    // Check for DOMException with QuotaExceededError name
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      return true;
    }
    
    // Check for error object with name property
    if (typeof error === 'object' && 'name' in error) {
      return (error as { name: string }).name === 'QuotaExceededError';
    }
    
    return false;
  }

  /**
   * Save a conversation to IndexedDB.
   * Requirements: 2.4 - Handles quota exceeded errors
   */
  async saveConversation(conversation: StoredConversation): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readwrite');
        // Add numeric field for indexing (IndexedDB doesn't support boolean keys)
        const conversationWithNumericFlag = {
          ...conversation,
          is_interrupted_num: conversation.is_interrupted ? 1 : 0,
        };
        const request = store.put(conversationWithNumericFlag);

        request.onsuccess = () => resolve();
        request.onerror = () => {
          const error = request.error;
          if (this.isQuotaExceededError(error)) {
            reject(
              new StorageError(
                'Storage quota exceeded. Please delete some old conversations.',
                'QUOTA_EXCEEDED'
              )
            );
          } else {
            reject(
              new StorageError(
                `Failed to save conversation: ${error?.message || 'Unknown error'}`,
                'UNKNOWN'
              )
            );
          }
        };
      } catch (error) {
        // Handle synchronous errors (e.g., from getStore)
        if (error instanceof StorageError) {
          reject(error);
        } else if (this.isQuotaExceededError(error)) {
          reject(
            new StorageError(
              'Storage quota exceeded. Please delete some old conversations.',
              'QUOTA_EXCEEDED'
            )
          );
        } else {
          reject(
            new StorageError(
              `Failed to save conversation: ${error}`,
              'UNKNOWN'
            )
          );
        }
      }
    });
  }

  /**
   * Get a conversation by ID.
   * Validates data structure before returning.
   * Requirements: 6.2, 6.3
   */
  async getConversation(id: string): Promise<StoredConversation | null> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readonly');
        const request = store.get(id);

        request.onsuccess = () => {
          const data = request.result;
          if (!data) {
            resolve(null);
            return;
          }

          // Validate the data structure
          const validated = this.validateConversation(data);
          if (!validated) {
            // Log and skip corrupted data
            console.error(`Corrupted conversation data detected for id: ${id}`);
            resolve(null);
            return;
          }

          // Remove internal indexing field before returning
          const { is_interrupted_num, ...cleanData } = validated as StoredConversation & { is_interrupted_num?: number };
          resolve(cleanData as StoredConversation);
        };
        request.onerror = () => {
          reject(
            new StorageError(
              `Failed to get conversation: ${request.error?.message || 'Unknown error'}`,
              'UNKNOWN'
            )
          );
        };
      } catch (error) {
        if (error instanceof StorageError) {
          reject(error);
        } else {
          reject(
            new StorageError(
              `Failed to get conversation: ${error}`,
              'UNKNOWN'
            )
          );
        }
      }
    });
  }

  /**
   * Delete a conversation by ID.
   */
  async deleteConversation(id: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readwrite');
        const request = store.delete(id);

        request.onsuccess = () => resolve(true);
        request.onerror = () => {
          reject(
            new StorageError(
              `Failed to delete conversation: ${request.error?.message || 'Unknown error'}`,
              'UNKNOWN'
            )
          );
        };
      } catch (error) {
        if (error instanceof StorageError) {
          reject(error);
        } else {
          reject(
            new StorageError(
              `Failed to delete conversation: ${error}`,
              'UNKNOWN'
            )
          );
        }
      }
    });
  }

  /**
   * List all conversations with summary information.
   * Validates data and skips corrupted conversations.
   * Requirements: 6.2, 6.3
   */
  async listConversations(): Promise<StoredConversationSummary[]> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readonly');
        const index = store.index('by-updated');
        const request = index.openCursor(null, 'prev'); // Sort by updated_at descending
        const summaries: StoredConversationSummary[] = [];

        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            const data = cursor.value;
            // Validate the data structure
            const conversation = this.validateConversation(data);
            if (conversation) {
              summaries.push({
                id: conversation.id,
                title: conversation.title,
                created_at: conversation.created_at,
                updated_at: conversation.updated_at,
                message_count: conversation.messages.length,
              });
            } else {
              // Log and skip corrupted data
              console.error(`Corrupted conversation data detected, skipping`);
            }
            cursor.continue();
          } else {
            resolve(summaries);
          }
        };
        request.onerror = () => {
          reject(
            new StorageError(
              `Failed to list conversations: ${request.error?.message || 'Unknown error'}`,
              'UNKNOWN'
            )
          );
        };
      } catch (error) {
        if (error instanceof StorageError) {
          reject(error);
        } else {
          reject(
            new StorageError(
              `Failed to list conversations: ${error}`,
              'UNKNOWN'
            )
          );
        }
      }
    });
  }

  /**
   * Find the most recently updated interrupted conversation.
   * Returns null if no interrupted conversations exist.
   * Requirements: 4.1
   */
  async findInterruptedConversation(): Promise<StoredConversation | null> {
    // Use a simpler approach: get all conversations and filter
    // This is more robust and avoids index-related issues
    try {
      const allConversations = await this.getAllConversationsRaw();
      
      let mostRecent: StoredConversation | null = null;
      let mostRecentTime = 0;

      for (const data of allConversations) {
        const conversation = this.validateConversation(data);
        if (conversation && conversation.is_interrupted) {
          const updatedTime = new Date(conversation.updated_at).getTime();
          if (updatedTime > mostRecentTime) {
            mostRecentTime = updatedTime;
            mostRecent = conversation;
          }
        }
      }

      return mostRecent;
    } catch (error) {
      if (error instanceof StorageError) {
        throw error;
      }
      throw new StorageError(
        `Failed to find interrupted conversation: ${error}`,
        'UNKNOWN'
      );
    }
  }

  /**
   * Current schema version for stored conversations.
   */
  private static readonly CURRENT_SCHEMA_VERSION = 1;

  /**
   * Migrate data if needed for schema changes.
   * Requirements: 6.4
   * 
   * This method iterates through all conversations and migrates them
   * to the current schema version if needed.
   */
  async migrateIfNeeded(): Promise<void> {
    const conversations = await this.getAllConversationsRaw();
    
    for (const conv of conversations) {
      const migrated = this.migrateConversation(conv);
      if (migrated !== conv) {
        // Data was migrated, save it back
        await this.saveConversation(migrated);
      }
    }
  }

  /**
   * Get all conversations without validation (for migration purposes).
   */
  private async getAllConversationsRaw(): Promise<StoredConversation[]> {
    return new Promise((resolve, reject) => {
      try {
        const store = this.getStore('readonly');
        const request = store.getAll();

        request.onsuccess = () => {
          resolve(request.result || []);
        };
        request.onerror = () => {
          reject(
            new StorageError(
              `Failed to get all conversations: ${request.error?.message || 'Unknown error'}`,
              'UNKNOWN'
            )
          );
        };
      } catch (error) {
        if (error instanceof StorageError) {
          reject(error);
        } else {
          reject(
            new StorageError(
              `Failed to get all conversations: ${error}`,
              'UNKNOWN'
            )
          );
        }
      }
    });
  }

  /**
   * Migrate a single conversation to the current schema version.
   * Returns the migrated conversation or the original if no migration needed.
   */
  private migrateConversation(conv: StoredConversation): StoredConversation {
    let current = conv;
    const version = current.version || 0;

    // Apply migrations in sequence
    if (version < 1) {
      current = this.migrateToV1(current);
    }

    // Future migrations would be added here:
    // if (version < 2) {
    //   current = this.migrateToV2(current);
    // }

    return current;
  }

  /**
   * Migrate conversation to schema version 1.
   * Adds default values for new fields.
   */
  private migrateToV1(conv: StoredConversation): StoredConversation {
    return {
      ...conv,
      version: 1,
      thread_id: conv.thread_id || conv.id, // Use id as thread_id if not present
      is_interrupted: conv.is_interrupted ?? false,
      title: conv.title ?? null,
    };
  }

  /**
   * Close the database connection.
   * Useful for testing and cleanup.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
