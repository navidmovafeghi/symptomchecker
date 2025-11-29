/**
 * ChatPage Component - Chat interface with sidebar for conversation history.
 */

'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';
import { Sidebar } from './Sidebar';
import ReactMarkdown from 'react-markdown';
import { Menu, X, Bot, User, Send, Mic } from 'lucide-react';

export function ChatPage() {
  const {
    messages,
    isLoading,
    isStreaming,
    error,
    sendMessage,
    selectOption,
    newConversation,
    isWaitingForInput,
    pendingOptions,
    // Storage state (Requirements: 1.4, 2.4)
    storageError,
    isStorageAvailable,
    clearStorageError,
    initializeStorage,
    // Checkpoint expiry state (Requirements: 3.5, 4.3)
    checkpointExpired,
    checkpointExpiredMessage,
    clearCheckpointExpired,
  } = useChatViewModel();

  // Handle starting a new conversation when checkpoint expires
  const handleStartNewConversation = () => {
    clearCheckpointExpired();
    newConversation();
  };

  // Handle continuing with fresh workflow (keep messages but clear interrupt state)
  const handleContinueFreshWorkflow = () => {
    clearCheckpointExpired();
    // User can continue typing in the same conversation
    // The next message will start a fresh workflow with the history as context
  };

  // Initialize storage on mount (Requirements: 1.4)
  useEffect(() => {
    initializeStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (input.trim() && !isLoading && !isStreaming) {
      sendMessage(input.trim(), true);
      setInput('');
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handleOptionClick = async (option: string) => {
    if (!isLoading) {
      await selectOption(option);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6 lg:p-8 flex items-center justify-center font-sans">
      <div className="w-full max-w-6xl h-[85vh] md:h-[90vh] flex gap-4 relative">
        
        {/* Mobile Menu Toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="md:hidden absolute top-3 left-3 z-50 p-2 text-slate-600 hover:bg-slate-200 rounded-md transition-colors"
        >
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>

        {/* Sidebar */}
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Overlay for mobile sidebar */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-slate-900/20 z-30 md:hidden backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Main Chat Panel */}
        <div className="flex-1 h-full w-full min-w-0">
          <div className="h-full bg-white rounded-2xl border border-slate-100 flex flex-col overflow-hidden relative shadow-sm">
            
            {/* Header - Minimal */}
            <div className="px-6 py-4 flex items-center justify-between bg-white z-10 border-b border-slate-50">
              <h1 className="text-lg font-semibold text-slate-800 tracking-tight">Assistant</h1>
              <div className="text-xs text-slate-500 font-medium px-2 py-1 bg-slate-50 rounded-md border border-slate-100">v2.0</div>
            </div>

            {/* Storage Unavailable Warning (Requirements: 1.4) */}
            {!isStorageAvailable && (
              <div className="bg-amber-50/50 border-b border-amber-100 px-4 py-3">
                <p className="text-sm text-amber-600">
                  <span className="font-medium">Warning:</span> Browser storage is not available. Your conversations will not be saved.
                </p>
              </div>
            )}

            {/* Storage Error Banner (Requirements: 1.4, 2.4) */}
            {storageError && (
              <div className="bg-orange-50/50 border-b border-orange-100 px-4 py-3 flex items-center justify-between">
                <p className="text-sm text-orange-600">
                  <span className="font-medium">Storage Error:</span> {storageError}
                </p>
                <button
                  onClick={clearStorageError}
                  className="text-orange-500 hover:text-orange-600 text-sm"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Error Banner */}
            {error && (
              <div className="bg-red-50/50 border-b border-red-100 px-4 py-3">
                <p className="text-sm text-red-600">
                  <span className="font-medium">Error:</span> {error}
                </p>
              </div>
            )}

            {/* Checkpoint Expiry Banner (Requirements: 3.5, 4.3) */}
            {checkpointExpired && (
              <div className="bg-slate-50/50 border-b border-slate-100 px-4 py-4">
                <p className="text-sm text-slate-600 mb-3">
                  <span className="font-medium">Session Expired:</span>{' '}
                  {checkpointExpiredMessage || 'Your session has expired. The conversation cannot be resumed from the exact workflow state.'}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleStartNewConversation}
                    className="px-4 py-2 bg-slate-700 hover:bg-slate-800 text-white text-sm rounded-lg transition-colors"
                  >
                    Start New Conversation
                  </button>
                  <button
                    onClick={handleContinueFreshWorkflow}
                    className="px-4 py-2 text-slate-600 hover:text-slate-800 text-sm transition-colors"
                  >
                    Continue Here
                  </button>
                </div>
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 md:p-10 space-y-8">
              {messages.length === 0 && !isLoading ? (
                <div className="flex w-full justify-start">
                  <div className="flex max-w-[85%] md:max-w-[70%] gap-4 flex-row">
                    <div className="flex-shrink-0 pt-1">
                      <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-200">
                        <Bot size={18} strokeWidth={2.5} />
                      </div>
                    </div>
                    <div className="text-[15px] leading-7 font-normal text-slate-700 px-0 py-1">
                      Hi there 👋
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex w-full ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      data-testid={`message-${message.role}`}
                    >
                      <div className={`flex max-w-[85%] md:max-w-[70%] gap-4 ${message.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        
                        {/* Avatar */}
                        <div className="flex-shrink-0 pt-1">
                          {message.role === 'assistant' ? (
                            <div
                              className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-200"
                              data-testid="ai-avatar"
                            >
                              <Bot size={18} strokeWidth={2.5} />
                            </div>
                          ) : (
                            <div
                              className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-600"
                              data-testid="user-avatar"
                            >
                              <User size={18} strokeWidth={2.5} />
                            </div>
                          )}
                        </div>

                        {/* Bubble */}
                        <div className="flex flex-col">
                          <div
                            className={`
                              text-[15px] leading-7 font-normal
                              ${message.role === 'user'
                                ? 'text-blue-900 bg-blue-50 px-5 py-3 rounded-2xl rounded-tr-sm'
                                : 'text-slate-700 px-0 py-1'
                              }
                            `}
                          >
                            {message.role === 'user' ? (
                              <div className="whitespace-pre-wrap">{message.content}</div>
                            ) : (
                              <div className="markdown-content">
                                <ReactMarkdown
                                  components={{
                                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                    ul: ({ children }) => (
                                      <ul className="list-disc ml-4 mb-2">{children}</ul>
                                    ),
                                    ol: ({ children }) => (
                                      <ol className="list-decimal ml-4 mb-2">{children}</ol>
                                    ),
                                    li: ({ children }) => <li className="mb-1">{children}</li>,
                                    strong: ({ children }) => (
                                      <strong className="font-bold">{children}</strong>
                                    ),
                                  }}
                                >
                                  {message.content}
                                </ReactMarkdown>
                              </div>
                            )}
                          </div>

                          {/* Option buttons */}
                          {message.isQuestion && message.options && message.options.length > 0 && (
                            <div className="flex flex-wrap gap-2 mt-3">
                              {message.options.map((option, index) => (
                                <button
                                  key={index}
                                  onClick={() => handleOptionClick(option)}
                                  disabled={isLoading}
                                  className="px-4 py-2 bg-gray-50 border border-gray-100 rounded-lg text-gray-600 hover:bg-gray-100 hover:border-gray-200 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>

                      </div>
                    </div>
                  ))}

                  {isLoading && !isStreaming && (
                    <div className="flex w-full justify-start">
                      <div className="flex max-w-[85%] md:max-w-[70%] gap-4 flex-row">
                        <div className="flex-shrink-0 pt-1">
                          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm shadow-blue-200">
                            <Bot size={18} strokeWidth={2.5} />
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 py-3">
                          <div className="h-1.5 w-1.5 rounded-full bg-gray-300 dot-bounce dot-bounce-1" />
                          <div className="h-1.5 w-1.5 rounded-full bg-gray-300 dot-bounce dot-bounce-2" />
                          <div className="h-1.5 w-1.5 rounded-full bg-gray-300 dot-bounce dot-bounce-3" />
                        </div>
                      </div>
                    </div>
                  )}

                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Input Area - Clean & Flat */}
            <div className="p-4 md:p-6 bg-white border-t border-slate-50">
              <div className="relative max-w-3xl mx-auto">
                <div className="bg-slate-50 rounded-xl border border-slate-200 flex items-center p-1.5 pl-4 focus-within:ring-2 focus-within:ring-blue-100 focus-within:border-blue-400 transition-all">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={isLoading || isStreaming}
                    placeholder={isWaitingForInput && pendingOptions.length > 0 ? "Select an option above or type..." : "Type a message..."}
                    className="flex-1 bg-transparent border-none outline-none text-slate-800 placeholder:text-slate-400 text-sm py-2"
                    data-testid="chat-input"
                  />
                  <div className="flex items-center gap-1 pr-1">
                    <button
                      type="button"
                      className="p-2 hover:bg-slate-200 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
                      data-testid="mic-button"
                    >
                      <Mic size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={handleSend}
                      disabled={isLoading || isStreaming || !input.trim()}
                      className={`p-2 rounded-lg transition-all duration-200 shadow-sm ${
                        input.trim()
                          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-blue-200'
                          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                      data-testid="send-button"
                    >
                      <Send size={16} strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
                <div className="text-center mt-3">
                   <p className="text-[10px] text-slate-400 uppercase tracking-widest">AI Generated Content</p>
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}
