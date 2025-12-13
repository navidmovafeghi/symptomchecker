/**
 * Storage utilities for graph visualization panel preferences.
 * Handles persistence of panel state (expanded/collapsed) to local storage.
 * 
 * Requirements: 1.4 - WHEN the visualization panel state changes THEN the System 
 * SHALL persist the preference in local storage
 */

/**
 * Storage key for graph visualization preferences.
 */
const STORAGE_KEY = 'graph_visualization_prefs';

/**
 * Interface for graph visualization preferences stored in local storage.
 */
export interface GraphVisualizationPreferences {
  isExpanded: boolean;
}

/**
 * Default preferences when storage is unavailable or empty.
 */
const DEFAULT_PREFERENCES: GraphVisualizationPreferences = {
  isExpanded: false, // Default to collapsed state
};

/**
 * Checks if local storage is available.
 * 
 * @returns true if local storage is available, false otherwise
 */
function isLocalStorageAvailable(): boolean {
  try {
    const testKey = '__storage_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the graph visualization preferences from local storage.
 * 
 * @returns The stored preferences, or default preferences if storage is unavailable or empty
 * 
 * @example
 * const prefs = readGraphPreferences();
 * console.log(prefs.isExpanded); // false (default) or stored value
 */
export function readGraphPreferences(): GraphVisualizationPreferences {
  if (!isLocalStorageAvailable()) {
    return { ...DEFAULT_PREFERENCES };
  }

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return { ...DEFAULT_PREFERENCES };
    }

    const parsed = JSON.parse(stored) as Partial<GraphVisualizationPreferences>;
    
    // Validate the parsed data has the expected shape
    if (typeof parsed.isExpanded !== 'boolean') {
      return { ...DEFAULT_PREFERENCES };
    }

    return {
      isExpanded: parsed.isExpanded,
    };
  } catch {
    // JSON parse error or other issues - return defaults
    return { ...DEFAULT_PREFERENCES };
  }
}

/**
 * Writes the graph visualization preferences to local storage.
 * Silently fails if storage is unavailable.
 * 
 * @param preferences - The preferences to store
 * @returns true if the write was successful, false otherwise
 * 
 * @example
 * writeGraphPreferences({ isExpanded: true });
 */
export function writeGraphPreferences(preferences: GraphVisualizationPreferences): boolean {
  if (!isLocalStorageAvailable()) {
    return false;
  }

  try {
    const serialized = JSON.stringify(preferences);
    window.localStorage.setItem(STORAGE_KEY, serialized);
    return true;
  } catch {
    // Storage quota exceeded or other issues - fail silently
    return false;
  }
}

/**
 * Reads the isExpanded state from local storage.
 * Convenience function for reading just the expanded state.
 * 
 * @returns The stored isExpanded value, or false if storage is unavailable
 * 
 * @example
 * const isExpanded = readIsExpanded(); // false (default) or stored value
 */
export function readIsExpanded(): boolean {
  return readGraphPreferences().isExpanded;
}

/**
 * Writes the isExpanded state to local storage.
 * Convenience function for writing just the expanded state.
 * 
 * @param isExpanded - The expanded state to store
 * @returns true if the write was successful, false otherwise
 * 
 * @example
 * writeIsExpanded(true); // Panel is now expanded
 */
export function writeIsExpanded(isExpanded: boolean): boolean {
  return writeGraphPreferences({ isExpanded });
}

/**
 * Clears the graph visualization preferences from local storage.
 * Useful for testing or resetting to defaults.
 * 
 * @returns true if the clear was successful, false otherwise
 */
export function clearGraphPreferences(): boolean {
  if (!isLocalStorageAvailable()) {
    return false;
  }

  try {
    window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
