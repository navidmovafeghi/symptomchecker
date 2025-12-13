'use client';

import { ReactNode, useEffect } from 'react';
import { LocaleProvider, useLocale } from '@/contexts/LocaleContext';

/**
 * Inner component that applies locale-based attributes to the document
 */
function LocaleAttributeHandler({ children }: { children: ReactNode }) {
  const { locale, direction } = useLocale();

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
