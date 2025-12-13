/**
 * Custom hook to warn users about unsaved changes before leaving the page.
 * Requirements: 5.3 - Warn user about unsaved changes when hasPendingSaves is true
 */

import { useEffect } from 'react';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';

/**
 * Hook that registers a beforeunload handler when there are pending saves.
 * This prevents users from accidentally losing data by closing the browser
 * while saves are in progress.
 */
export function useBeforeUnloadWarning(): void {
  const hasPendingSaves = useChatViewModel((state) => state.hasPendingSaves);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasPendingSaves) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but we set it for older browsers
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasPendingSaves]);
}
