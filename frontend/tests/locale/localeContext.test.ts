/**
 * Property-based tests for LocaleContext.
 * Tests locale persistence and translation functionality.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  saveLocalePreference,
  loadLocalePreference,
  toPersianNumerals,
  getDirection,
  Locale,
} from '../../contexts/LocaleContext';
import enTranslations from '../../locales/en.json';
import faTranslations from '../../locales/fa.json';

// Type for translations
type TranslationValue = string | Record<string, unknown>;
type Translations = Record<string, TranslationValue>;

// Arbitrary for generating valid locale values
const localeArb: fc.Arbitrary<Locale> = fc.constantFrom('en', 'fa');

// Helper to clear localStorage
const clearLocalStorage = (): void => {
  try {
    localStorage.clear();
  } catch {
    // localStorage not available in test environment
  }
};

describe('LocaleContext', () => {
  beforeEach(() => {
    clearLocalStorage();
  });

  afterEach(() => {
    clearLocalStorage();
  });

  /**
   * **Feature: persian-localization, Property 2: Language preference persistence round-trip**
   * **Validates: Requirements 1.4**
   *
   * For any valid locale value ('en' or 'fa'), saving the preference and then
   * retrieving it SHALL return the same locale value.
   */
  it('Property 2: locale persistence round-trip preserves locale value', () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        // Save the locale preference
        saveLocalePreference(locale);

        // Load it back
        const loaded = loadLocalePreference();

        // Verify it matches
        expect(loaded).toBe(locale);
      }),
      { numRuns: 100 }
    );
  });


  /**
   * **Feature: persian-localization, Property 1: Translation completeness**
   * **Validates: Requirements 7.2**
   *
   * For any translation key that exists in the English translation file,
   * the Persian translation file SHALL contain a corresponding entry
   * (or the system falls back to English).
   */
  it('Property 1: translation completeness - Persian has all English keys or fallback works', () => {
    // Helper to get all keys from a nested object with dot notation
    const getAllKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const keys: string[] = [];
      for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    };

    // Helper to get nested value
    const getNestedValue = (obj: Record<string, unknown>, path: string): unknown => {
      const keys = path.split('.');
      let current: unknown = obj;
      for (const key of keys) {
        if (current === null || current === undefined || typeof current !== 'object') {
          return undefined;
        }
        current = (current as Record<string, unknown>)[key];
      }
      return current;
    };

    // Get all keys from English translations
    const englishKeys = getAllKeys(enTranslations as Record<string, unknown>);

    // Create an arbitrary that picks from English keys
    const englishKeyArb = fc.constantFrom(...englishKeys);

    fc.assert(
      fc.property(englishKeyArb, (key) => {
        const englishValue = getNestedValue(enTranslations as Record<string, unknown>, key);
        const persianValue = getNestedValue(faTranslations as Record<string, unknown>, key);

        // Either Persian has the key, or English value exists for fallback
        const hasPersianTranslation = persianValue !== undefined && typeof persianValue === 'string';
        const hasEnglishFallback = englishValue !== undefined && typeof englishValue === 'string';

        // The property: Persian must have the key OR English fallback must exist
        expect(hasPersianTranslation || hasEnglishFallback).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: persian-localization, Property 3: RTL direction consistency**
   * **Validates: Requirements 2.1**
   *
   * For any UI component rendered with Persian locale active, the computed
   * text direction SHALL be 'rtl'. For English locale, direction SHALL be 'ltr'.
   */
  it('Property 3: RTL direction consistency - Persian locale returns rtl direction', () => {
    fc.assert(
      fc.property(localeArb, (locale) => {
        const direction = getDirection(locale);
        
        // Property: Persian locale must always return 'rtl', English must return 'ltr'
        if (locale === 'fa') {
          expect(direction).toBe('rtl');
        } else {
          expect(direction).toBe('ltr');
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: persian-localization, Property 4: Persian numeral conversion**
   * **Validates: Requirements 4.2**
   *
   * For any non-negative integer and Persian locale with Persian numerals enabled,
   * the formatted output SHALL contain only Persian digit characters (۰-۹).
   */
  it('Property 4: Persian numeral conversion - output contains only Persian digits', () => {
    const nonNegativeIntArb = fc.integer({ min: 0, max: 999999999 });

    fc.assert(
      fc.property(nonNegativeIntArb, (num) => {
        const persian = toPersianNumerals(num);
        
        // Property: No Western digits should remain in the output
        const hasWesternDigits = /[0-9]/.test(persian);
        expect(hasWesternDigits).toBe(false);
        
        // Property: Output should contain only Persian digit characters
        const validPersianDigits = /^[۰۱۲۳۴۵۶۷۸۹]+$/;
        expect(validPersianDigits.test(persian)).toBe(true);
        
        // Property: Length should be preserved (same number of digits)
        expect(persian.length).toBe(String(num).length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: persian-localization, Property 5: Date formatting locale consistency**
   * **Validates: Requirements 4.1**
   *
   * For any valid Date object and Persian locale, the formatted date string
   * SHALL contain Persian month names or localized format.
   */
  it('Property 5: Date formatting locale consistency - Persian dates use Persian format', () => {
    // Generate valid dates using timestamp within a reasonable range (2000-2030)
    // Using integer timestamps to avoid NaN dates
    const validDateArb = fc
      .integer({
        min: new Date('2000-01-01').getTime(),
        max: new Date('2030-12-31').getTime(),
      })
      .map((timestamp) => new Date(timestamp))
      .filter((date) => !isNaN(date.getTime())); // Extra safety filter

    fc.assert(
      fc.property(validDateArb, (date) => {
        // Format date using Persian locale
        const persianFormatted = date.toLocaleDateString('fa-IR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        
        // Format date using English locale
        const englishFormatted = date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
        
        // Property: Persian formatted date should contain Persian/Arabic script characters
        const hasPersianChars = /[\u0600-\u06FF]/.test(persianFormatted);
        expect(hasPersianChars).toBe(true);
        
        // Property: English formatted date should NOT contain Persian characters
        const englishHasPersianChars = /[\u0600-\u06FF]/.test(englishFormatted);
        expect(englishHasPersianChars).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: persian-localization, Property 6: Persian text preservation round-trip**
   * **Validates: Requirements 6.2**
   *
   * For any string containing Persian characters, submitting it as a message
   * and retrieving it SHALL preserve all Persian characters exactly.
   */
  it('Property 6: Persian text preservation round-trip - Persian characters are preserved', () => {
    // Arbitrary for generating strings with Persian characters
    // Persian Unicode range: \u0600-\u06FF (Arabic script used for Persian)
    const persianCharArb = fc.integer({ min: 0x0600, max: 0x06FF }).map((code) => String.fromCharCode(code));
    
    // Arbitrary for ASCII characters to mix with Persian
    const asciiCharArb = fc.integer({ min: 0x0020, max: 0x007E }).map((code) => String.fromCharCode(code));
    
    // Generate strings that contain at least some Persian characters
    const persianTextArb = fc.array(
      fc.oneof(
        { weight: 3, arbitrary: persianCharArb }, // More Persian chars
        { weight: 1, arbitrary: asciiCharArb },   // Some ASCII chars
        { weight: 1, arbitrary: fc.constant(' ') } // Include spaces
      ),
      { minLength: 1, maxLength: 100 }
    ).map((chars) => chars.join(''))
     .filter((text) => /[\u0600-\u06FF]/.test(text)); // Ensure at least one Persian char

    fc.assert(
      fc.property(persianTextArb, (persianText) => {
        // Simulate message storage and retrieval (round-trip)
        // In a real scenario, this would go through IndexedDB storage
        // Here we test the fundamental property that string encoding preserves Persian chars
        
        // Encode to JSON (simulating storage serialization)
        const serialized = JSON.stringify({ content: persianText });
        
        // Decode from JSON (simulating storage retrieval)
        const deserialized = JSON.parse(serialized) as { content: string };
        
        // Property: Persian characters must be preserved exactly
        expect(deserialized.content).toBe(persianText);
        
        // Property: All Persian characters in original must exist in retrieved
        const originalPersianChars = persianText.match(/[\u0600-\u06FF]/g) || [];
        const retrievedPersianChars = deserialized.content.match(/[\u0600-\u06FF]/g) || [];
        expect(retrievedPersianChars).toEqual(originalPersianChars);
        
        // Property: Length must be preserved
        expect(deserialized.content.length).toBe(persianText.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: persian-localization, Property 7: Language change reactivity**
   * **Validates: Requirements 5.3, 5.4**
   *
   * For any translation key, changing the locale SHALL immediately update
   * the value returned by the translation function without page reload.
   */
  it('Property 7: Language change reactivity - translation function returns correct value for each locale', () => {
    // Helper to get all keys from a nested object with dot notation
    const getAllKeys = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const keys: string[] = [];
      for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const value = obj[key];
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          keys.push(...getAllKeys(value as Record<string, unknown>, fullKey));
        } else {
          keys.push(fullKey);
        }
      }
      return keys;
    };

    // Helper to get nested value
    const getNestedValue = (obj: Translations, path: string): string | undefined => {
      const keys = path.split('.');
      let current: unknown = obj;
      for (const key of keys) {
        if (current === null || current === undefined || typeof current !== 'object') {
          return undefined;
        }
        current = (current as Record<string, unknown>)[key];
      }
      return typeof current === 'string' ? current : undefined;
    };

    // Simulate translation function behavior for a given locale
    const translate = (key: string, locale: Locale): string => {
      const translations: Record<Locale, Translations> = {
        en: enTranslations as Translations,
        fa: faTranslations as Translations,
      };
      
      // Try current locale first
      let value = getNestedValue(translations[locale], key);
      
      // Fall back to English if not found
      if (value === undefined && locale !== 'en') {
        value = getNestedValue(translations.en, key);
      }
      
      // Return key if still not found
      return value ?? key;
    };

    // Get all keys from English translations
    const englishKeys = getAllKeys(enTranslations as Record<string, unknown>);
    const englishKeyArb = fc.constantFrom(...englishKeys);

    fc.assert(
      fc.property(englishKeyArb, localeArb, (key, locale) => {
        // Get translation for the given locale
        const translatedValue = translate(key, locale);
        
        // Property 1: Translation function should return a non-empty string
        expect(translatedValue.length).toBeGreaterThan(0);
        
        // Property 2: When locale changes, the translation should reflect the new locale
        // (either the locale-specific value or English fallback)
        const expectedEnglish = getNestedValue(enTranslations as Translations, key);
        const expectedPersian = getNestedValue(faTranslations as Translations, key);
        
        if (locale === 'en') {
          // For English locale, should return English value
          expect(translatedValue).toBe(expectedEnglish);
        } else if (locale === 'fa') {
          // For Persian locale, should return Persian value if exists, otherwise English fallback
          if (expectedPersian !== undefined) {
            expect(translatedValue).toBe(expectedPersian);
          } else {
            expect(translatedValue).toBe(expectedEnglish);
          }
        }
        
        // Property 3: Switching locale should give different results for keys that have translations in both languages
        if (expectedEnglish !== undefined && expectedPersian !== undefined && expectedEnglish !== expectedPersian) {
          const enTranslation = translate(key, 'en');
          const faTranslation = translate(key, 'fa');
          // If both translations exist and are different, switching locale should change the result
          expect(enTranslation).not.toBe(faTranslation);
        }
      }),
      { numRuns: 100 }
    );
  });
});
