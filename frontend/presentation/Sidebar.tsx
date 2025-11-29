/**
 * Sidebar Component - displays conversation history.
 */

'use client';

import { useEffect } from 'react';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';
import { Plus, Settings, User } from 'lucide-react';

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

  return (
    <div
      className={`
        fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-300 ease-in-out
        md:relative md:transform-none md:w-64 md:inset-auto
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        h-full bg-white md:bg-transparent flex flex-col p-2 md:p-0 border-r md:border-none border-slate-100 shadow-2xl md:shadow-none
      `}
    >
      {/* New Chat Button - Minimalist Outline */}
      <button
        onClick={newConversation}
        className="flex items-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl transition-all w-full mb-8 text-sm font-medium tracking-wide shadow-sm shadow-blue-200"
      >
        <Plus size={16} strokeWidth={2} />
        <span>New Chat</span>
      </button>

      {/* History List */}
      <div className="flex-1 overflow-y-auto px-1 space-y-1">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 px-3">Recent</div>
        
        {isLoadingConversations ? (
           <div className="px-3 py-2 text-slate-400 text-sm">Loading...</div>
        ) : conversations.length === 0 ? (
           <div className="px-3 py-2 text-slate-400 text-sm">No conversations yet</div>
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => handleSelectConversation(conv.id)}
              className={`
                flex flex-col px-3 py-2.5 rounded-lg cursor-pointer transition-colors group relative
                ${conversationId === conv.id
                  ? 'bg-blue-50 text-blue-900 shadow-sm border border-blue-100'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100/50'
                }
              `}
            >
              <div className="flex justify-between items-center">
                  <span className="text-sm font-medium truncate">{conv.title || 'New conversation'}</span>
                  {/* Delete button - keeping functionality */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(conv.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-200 rounded transition-all"
                  >
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 text-slate-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                     </svg>
                  </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 pt-4 border-t border-slate-200/60 space-y-1">
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium text-slate-600">
          <Settings size={18} />
          <span>Settings</span>
        </button>
        <button className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-100 transition-colors text-sm font-medium text-slate-600">
           <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
             <User size={14} />
           </div>
           <span>User Account</span>
        </button>
      </div>
    </div>
  );
}
