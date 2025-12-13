/**
 * Sidebar Component - Full-height sidebar built into background.
 */

'use client';

import { useEffect } from 'react';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';
import { useLocale } from '@/contexts/LocaleContext';
import { Plus, MessageSquare, Trash2 } from 'lucide-react';
import { LanguageSwitcher } from './LanguageSwitcher';

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const {
    conversations,
    conversationId,
    isLoadingConversations,
    loadConversations,
    selectConversation,
    newConversation,
    deleteConversation,
  } = useChatViewModel();

  const { t, direction } = useLocale();

  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    onClose();
  };

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // RTL-aware positioning classes
  const positionClasses = direction === 'rtl'
    ? 'right-0 translate-x-full md:translate-x-0'
    : 'left-0 -translate-x-full md:translate-x-0';

  const openTranslateClass = direction === 'rtl'
    ? 'translate-x-0'
    : 'translate-x-0';

  return (
    <div
      className={`
        fixed inset-y-0 z-40 w-64 transform transition-all duration-300 ease-out
        md:relative md:transform-none md:w-64 md:inset-auto
        ${direction === 'rtl' ? 'right-0' : 'left-0'}
        ${isOpen ? openTranslateClass : positionClasses}
        h-full flex flex-col
        bg-gradient-to-b from-[#e8f4fc] to-[#c9e4f6] md:bg-none
      `}
    >
      <div className="h-full flex flex-col px-4 py-6">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-gray-700 font-semibold text-lg tracking-tight">{t('chat.chatHistory')}</h2>
        </div>

        {/* New Chat Button */}
        <button
          onClick={newConversation}
          className="flex items-center justify-center gap-2 bg-white/50 hover:bg-white/70 text-gray-700 px-4 py-3 rounded-xl transition-all duration-200 w-full mb-6 text-sm font-medium"
        >
          <Plus size={18} strokeWidth={2.5} />
          <span>{t('chat.newChat')}</span>
        </button>

        {/* History List */}
        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-1">
          {isLoadingConversations ? (
            <div className="px-3 py-2 text-gray-500 text-sm">{t('common.loading')}</div>
          ) : conversations.length === 0 ? (
            <div className="px-3 py-2 text-gray-500 text-sm flex items-center gap-2">
              <MessageSquare size={14} />
              {t('chat.noConversations')}
            </div>
          ) : (
            conversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => handleSelectConversation(conv.id)}
                className={`
                  flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200 group
                  ${conversationId === conv.id
                    ? 'bg-white/60 text-gray-800'
                    : 'text-gray-600 hover:text-gray-800 hover:bg-white/40'
                  }
                `}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <MessageSquare size={14} className="flex-shrink-0 opacity-60" />
                  <span className="text-sm truncate">{conv.title || t('chat.newConversation')}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  className="opacity-100 md:opacity-0 md:group-hover:opacity-100 p-1 hover:bg-white/50 rounded transition-all duration-200"
                >
                  <Trash2 size={14} className="text-gray-400 hover:text-red-500" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Language Switcher - positioned at bottom */}
        <div className="mt-4 pt-4 border-t border-gray-300/30">
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );
}
