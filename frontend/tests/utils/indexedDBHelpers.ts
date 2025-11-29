/**
 * Helper utilities for IndexedDB testing.
 * Provides functions for database cleanup and test setup.
 */

/**
 * Database name used by the storage service.
 */
export const DB_NAME = 'medical-chatbot';

/**
 * Deletes the IndexedDB database and waits for completion.
 * Use this in afterEach hooks to ensure clean state between tests.
 */
export const deleteDatabase = (): Promise<void> => {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve(); // Resolve even on error to avoid hanging
    request.onblocked = () => resolve();
  });
};

/**
 * Waits for a specified number of milliseconds.
 * Useful for testing async operations.
 */
export const wait = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Creates a fresh IndexedDBStorageService instance and initializes it.
 * Use this in beforeEach hooks for consistent test setup.
 */
export const createStorageService = async () => {
  const { IndexedDBStorageService } = await import('../../services/storage/indexedDBStorage');
  const storageService = new IndexedDBStorageService();
  await storageService.initialize();
  return storageService;
};

/**
 * Cleans up a storage service instance.
 * Closes the database connection and deletes the database.
 */
export const cleanupStorageService = async (storageService: { close: () => void }) => {
  storageService.close();
  await deleteDatabase();
};
