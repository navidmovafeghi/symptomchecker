'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import enTranslations from '@/locales/en.json';
import faTranslations from '@/locales/fa.json';

export type Locale = 'en' | 'fa';
export type Direction = 'ltr' | 'rtl';

type TranslationValue = string | Record<string, unknown>;
type Translations = Record<string, TranslationValue>;

const translations: Record<Locale, Translations> = {
  en: enTranslations as Translations,
  fa: faTranslations as Translations,
};

const LOCALE_STORAGE_KEY = 'locale-preference';

export interface LocaleContextValue {
  locale: Locale;
  direction: Direction;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string>) => string;
  formatDate: (date: Date | string) => string;
  formatNumber: (num: number) => string;
  formatPercent: (num: number) => string;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: Translations, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return typeof current === 'string' ? current : undefined;
}

/**
 * Interpolate parameters into a translation string
 * Supports {{param}} syntax
 */
function interpolate(text: string, params?: Record<string, string>): string {
  if (!params) return text;

  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => params[key] ?? `{{${key}}}`);
}

/**
 * Convert Western Arabic numerals to Persian numerals
 */
export function toPersianNumerals(num: number | string): string {
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  return String(num).replace(/[0-9]/g, (digit) => persianDigits[parseInt(digit, 10)]);
}

/**
 * Get the direction for a locale
 */
export function getDirection(locale: Locale): Direction {
  return locale === 'fa' ? 'rtl' : 'ltr';
}

/**
 * Save locale preference to localStorage
 */
export function saveLocalePreference(locale: Locale): void {
  try {
    const preference = {
      locale,
      savedAt: new Date().toISOString(),
    };
    localStorage.setItem(LOCALE_STORAGE_KEY, JSON.stringify(preference));
  } catch {
    // localStorage not available, silently fail
  }
}

/**
 * Load locale preference from localStorage
 */
export function loadLocalePreference(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored) {
      const preference = JSON.parse(stored);
      if (preference.locale === 'en' || preference.locale === 'fa') {
        return preference.locale;
      }
    }
  } catch {
    // localStorage not available or invalid data
  }
  return null;
}

/**
 * Detect browser language preference
 */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  
  const browserLang = navigator.language || (navigator as { userLanguage?: string }).userLanguage || '';
  if (browserLang.startsWith('fa')) {
    return 'fa';
  }
  return 'en';
}

interface LocaleProviderProps {
  children: ReactNode;
  defaultLocale?: Locale;
}

export function LocaleProvider({ children, defaultLocale }: LocaleProviderProps) {
  // Always start with a consistent default for SSR hydration
  const [locale, setLocaleState] = useState<Locale>(defaultLocale ?? 'en');
  const [isHydrated, setIsHydrated] = useState(false);

  const direction = getDirection(locale);

  // After hydration, load the user's preference from localStorage
  useEffect(() => {
    const saved = loadLocalePreference();
    if (saved) {
      setLocaleState(saved);
    } else if (!defaultLocale) {
      // Fall back to browser detection if no saved preference
      setLocaleState(detectBrowserLocale());
    }
    setIsHydrated(true);
  }, [defaultLocale]);

  // Update document direction when locale changes
  useEffect(() => {
    document.documentElement.dir = direction;
    document.documentElement.lang = locale;
    document.documentElement.setAttribute('data-locale', locale);
  }, [locale, direction]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    saveLocalePreference(newLocale);
  }, []);

  /**
   * Translation function with fallback to English
   */
  const t = useCallback((key: string, params?: Record<string, string>): string => {
    // Try current locale first
    let value = getNestedValue(translations[locale], key);
    
    // Fall back to English if not found
    if (value === undefined && locale !== 'en') {
      value = getNestedValue(translations.en, key);
    }
    
    // Return key if still not found
    if (value === undefined) {
      return key;
    }
    
    return interpolate(value, params);
  }, [locale]);

  /**
   * Format date according to locale
   */
  const formatDate = useCallback((date: Date | string): string => {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    
    if (isNaN(dateObj.getTime())) {
      return String(date);
    }
    
    const options: Intl.DateTimeFormatOptions = {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    };
    
    return dateObj.toLocaleDateString(locale === 'fa' ? 'fa-IR' : 'en-US', options);
  }, [locale]);

  /**
   * Format number according to locale
   */
  const formatNumber = useCallback((num: number): string => {
    if (locale === 'fa') {
      return toPersianNumerals(num);
    }
    return num.toLocaleString('en-US');
  }, [locale]);

  /**
   * Format percentage according to locale
   */
  const formatPercent = useCallback((num: number): string => {
    const formatted = `${num}%`;
    if (locale === 'fa') {
      return toPersianNumerals(formatted);
    }
    return formatted;
  }, [locale]);

  const value: LocaleContextValue = {
    locale,
    direction,
    setLocale,
    t,
    formatDate,
    formatNumber,
    formatPercent,
  };

  return (
    <LocaleContext.Provider value={value}>
      {children}
    </LocaleContext.Provider>
  );
}

/**
 * Hook to access locale context
 */
export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (context === undefined) {
    throw new Error('useLocale must be used within a LocaleProvider');
  }
  return context;
}

export { LocaleContext };
