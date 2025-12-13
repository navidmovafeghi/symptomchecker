/**
 * PersistenceService module exports.
 * Provides a singleton instance for centralized conversation persistence.
 * 
 * Requirements: 1.3
 */

export * from './types';
export { PersistenceService } from './persistenceService';

import { PersistenceService } from './persistenceService';
import type { IPersistenceService } from './types';

/**
 * Singleton instance of the PersistenceService.
 * Lazily initialized on first access.
 */
let persistenceServiceInstance: PersistenceService | null = null;

/**
 * Get the singleton PersistenceService instance.
 * Creates the instance on first call.
 * 
 * Requirements: 1.3 - Single code path for all persistence operations
 */
export function getPersistenceService(): IPersistenceService {
  if (!persistenceServiceInstance) {
    persistenceServiceInstance = new PersistenceService();
  }
  return persistenceServiceInstance;
}

/**
 * Reset the singleton instance (for testing purposes).
 */
export function resetPersistenceService(): void {
  persistenceServiceInstance = null;
}
