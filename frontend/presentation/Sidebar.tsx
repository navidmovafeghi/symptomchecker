/**
 * Sidebar Component - displays conversation history.
 */

'use client';

import { useEffect } from 'react';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';
import { Plus } from 'lucide-react';

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

  // Handle conversation selection and close sidebar on mobile
  const handleSelectConversation = (id: string) => {
    selectConversation(id);
    onClose(); // Close sidebar on mobile after selection
  };

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return 'Today';
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  return (
    <div 
      className={`w-64 bg-white/80 backdrop-blur-sm text-slate-900 flex flex-col h-full border-r border-slate-200
        fixed md:relative inset-y-0 left-0 z-40 transform transition-transform duration-300 ease-in-out
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
    >
      {/* Header */}
      <div className="p-4">
        <button
          onClick={newConversation}
          className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors flex items-center justify-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Chat
        </button>
      </div>

      {/* Recent Label */}
      <div className="px-4 py-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Recent</span>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingConversations ? (
          <div className="p-4 text-slate-500 text-sm">Loading...</div>
        ) : conversations.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-slate-500 text-sm">No conversations yet</p>
            <p className="text-slate-400 text-xs mt-1">Start a new chat to begin</p>
          </div>
        ) : (
          <div className="py-2 space-y-0.5">
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className={`group px-3 py-2.5 mx-2 rounded-lg cursor-pointer transition-all duration-150 ${
                  conversationId === conv.id
                    ? 'bg-blue-50 border-l-2 border-blue-600'
                    : 'hover:bg-slate-100 border-l-2 border-transparent'
                }`}
                onClick={() => handleSelectConversation(conv.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${
                      conversationId === conv.id
                        ? 'text-blue-900 font-medium'
                        : 'text-slate-700 font-normal'
                    }`}>
                      {conv.title || 'New conversation'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {formatDate(conv.updated_at)}
                    </p>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-slate-200 rounded-lg transition-all duration-150"
                    title="Delete conversation"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5 text-slate-400 hover:text-red-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
