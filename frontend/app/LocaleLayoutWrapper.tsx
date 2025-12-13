'use client';

import { ReactNode, useEffect } from 'react';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';
import { useBeforeUnloadWarning } from '@/utils/useBeforeUnloadWarning';

/**
 * Inner component that applies locale-based attributes to the document
 * and handles global app-level effects like beforeunload warnings.
 */
function LocaleAttributeHandler({ children }: { children: ReactNode }) {
  const { locale, direction } = useLocale();

  // Register beforeunload warning when there are pending saves
  // Requirements: 5.3
  useBeforeUnloadWarning();

  useEffect(() => {
    // Update document attributes when locale changes
    document.documentElement.dir = direction;
    document.documentElement.lang = locale;
    document.documentElement.setAttribute('data-locale', locale);
  }, [locale, direction]);

  return <>{children}</>;
}

interface LocaleLayoutWrapperProps {
  children: ReactNode;
}

/**
 * Client-side wrapper that provides locale context and handles RTL/LTR direction
 */
export function LocaleLayoutWrapper({ children }: LocaleLayoutWrapperProps) {
  return (
    <LocaleProvider>
      <LocaleAttributeHandler>{children}</LocaleAttributeHandler>
    </LocaleProvider>
  );
}
