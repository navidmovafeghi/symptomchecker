/**
 * LanguageSwitcher Component - Toggle between English and Persian languages.
 * Supports keyboard navigation for accessibility.
 */

'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { useLocale, Locale } from '@/contexts/LocaleContext';
import { Globe, ChevronDown } from 'lucide-react';

interface LanguageSwitcherProps {
  className?: string;
}

interface LanguageOption {
  code: Locale;
  label: string;
  nativeLabel: string;
}

const languages: LanguageOption[] = [
  { code: 'en', label: 'English', nativeLabel: 'English' },
  { code: 'fa', label: 'Persian', nativeLabel: 'فارسی' },
];

export function LanguageSwitcher({ className = '' }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useLocale();
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const currentLanguage = languages.find((lang) => lang.code === locale) || languages[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case 'Escape':
        setIsOpen(false);
        setFocusedIndex(-1);
        buttonRef.current?.focus();
        break;
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
          setFocusedIndex(0);
        } else {
          setFocusedIndex((prev) => (prev + 1) % languages.length);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (isOpen) {
          setFocusedIndex((prev) => (prev - 1 + languages.length) % languages.length);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen && focusedIndex >= 0) {
          handleSelectLanguage(languages[focusedIndex].code);
        } else {
          setIsOpen(!isOpen);
          if (!isOpen) {
            setFocusedIndex(languages.findIndex((lang) => lang.code === locale));
          }
        }
        break;
      case 'Tab':
        if (isOpen) {
          setIsOpen(false);
          setFocusedIndex(-1);
        }
        break;
    }
  };

  const handleSelectLanguage = (code: Locale) => {
    setLocale(code);
    setIsOpen(false);
    setFocusedIndex(-1);
    buttonRef.current?.focus();
  };

  const toggleDropdown = () => {
    setIsOpen(!isOpen);
    if (!isOpen) {
      setFocusedIndex(languages.findIndex((lang) => lang.code === locale));
    } else {
      setFocusedIndex(-1);
    }
  };

  return (
    <div
      ref={dropdownRef}
      className={`relative ${className}`}
      onKeyDown={handleKeyDown}
    >
      {/* Trigger Button */}
      <button
        ref={buttonRef}
        onClick={toggleDropdown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t('language.switchLanguage')}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/50 hover:bg-white/70 text-gray-700 transition-all duration-200 text-sm font-medium w-full"
      >
        <Globe size={16} className="flex-shrink-0" />
        <span className="flex-1 text-start">{currentLanguage.nativeLabel}</span>
        <ChevronDown
          size={14}
          className={`flex-shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <ul
          role="listbox"
          aria-label={t('language.switchLanguage')}
          aria-activedescendant={focusedIndex >= 0 ? `lang-option-${languages[focusedIndex].code}` : undefined}
          className="absolute z-50 bottom-full mb-1 w-full bg-white rounded-lg shadow-lg border border-gray-200 py-1 overflow-hidden"
        >
          {languages.map((lang, index) => (
            <li
              key={lang.code}
              id={`lang-option-${lang.code}`}
              role="option"
              aria-selected={locale === lang.code}
              onClick={() => handleSelectLanguage(lang.code)}
              className={`
                flex items-center justify-between px-3 py-2 cursor-pointer transition-colors duration-150
                ${locale === lang.code ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}
                ${focusedIndex === index ? 'bg-gray-100' : ''}
                hover:bg-gray-100
              `}
            >
              <span className="text-sm">{lang.nativeLabel}</span>
              {locale === lang.code && (
                <span className="text-blue-600 text-xs">✓</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
