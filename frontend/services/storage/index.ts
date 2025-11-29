/**
 * Storage service entry point.
 * Exports the singleton instance of IndexedDBStorageService.
 * Requirements: 5.1, 5.2
 */

export { IndexedDBStorageService } from './indexedDBStorage';
export type {
  IStorageService,
  StoredConversation,
  StoredMessage,
  StoredConversationSummary,
  StorageErrorCode,
} from './types';
export { StorageError } from './types';

import { IndexedDBStorageService } from './indexedDBStorage';
import type { IStorageService } from './types';
import { StorageError } from './types';

// Singleton instance
let _storageService: IndexedDBStorageService | null = null;
let _initialized = false;
let _initializationPromise: Promise<void> | null = null;

/**
 * Check if IndexedDB storage is supported in the current environment.
 * Call this before attempting to use the storage service.
 * Requirements: 1.4, 5.3
 * 
 * @returns true if IndexedDB is available, false otherwise
 */
export function isStorageSupported(): boolean {
  return IndexedDBStorageService.checkIndexedDBSupport();
}

/**
 * Get the singleton storage service instance.
 * Creates the instance if it doesn't exist.
 * Requirements: 5.1, 5.2
 * 
 * @returns The storage service instance
 */
export function getStorageService(): IStorageService {
  if (!_storageService) {
    _storageService = new IndexedDBStorageService();
  }
  return _storageService;
}

/**
 * Initialize the storage service.
 * This must be called before using any storage operations.
 * Safe to call multiple times - subsequent calls return the same promise.
 * Requirements: 5.1, 5.2, 5.3
 * 
 * @returns Promise that resolves when initialization is complete
 * @throws StorageError if IndexedDB is not available
 */
export async function initializeStorage(): Promise<void> {
  // Return existing initialization promise if already initializing
  if (_initializationPromise) {
    return _initializationPromise;
  }

  // Already initialized
  if (_initialized) {
    return;
  }

  // Check support before attempting initialization
  if (!isStorageSupported()) {
    throw new StorageError(
      'IndexedDB is not available in this browser',
      'UNAVAILABLE'
    );
  }

  const service = getStorageService();
  _initializationPromise = service.initialize().then(() => {
    _initialized = true;
  });

  return _initializationPromise;
}

/**
 * Check if the storage service has been initialized.
 * 
 * @returns true if initialized, false otherwise
 */
export function isStorageInitialized(): boolean {
  return _initialized;
}

/**
 * Reset the storage service (primarily for testing).
 * Closes the database connection and resets the singleton.
 */
export function resetStorageService(): void {
  if (_storageService) {
    _storageService.close();
    _storageService = null;
  }
  _initialized = false;
  _initializationPromise = null;
}

/**
 * Singleton instance of the storage service.
 * Use this for all storage operations in the application.
 * 
 * Note: Call initializeStorage() before using other methods.
 * Check isStorageSupported() first to verify IndexedDB availability.
 * 
 * @deprecated Use getStorageService() instead for better control
 */
export const storageService = new IndexedDBStorageService();
