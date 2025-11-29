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
    <div className="flex h-screen w-screen bg-slate-50">
      {/* Sidebar */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 backdrop-blur-sm z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Main chat area */}
      <div className="flex-1 flex items-center justify-center p-6">
        {/* Chat container */}
        <div className="flex flex-col h-[calc(100vh-3rem)] w-full max-w-2xl bg-white shadow-lg rounded-xl border border-slate-200 overflow-hidden">
        {/* Chat Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          {/* Mobile menu toggle button */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="md:hidden p-2 hover:bg-slate-100 rounded-lg transition-colors"
            aria-label={sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
          >
            {sidebarOpen ? (
              <X className="h-5 w-5 text-slate-600" />
            ) : (
              <Menu className="h-5 w-5 text-slate-600" />
            )}
          </button>
          
          {/* Title and version badge */}
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-slate-900">Assistant</h1>
            <span className="px-2 py-0.5 text-xs font-medium text-slate-500 bg-slate-100 rounded-full">v1.0</span>
          </div>
          
          {/* Spacer for centering on desktop */}
          <div className="w-9 md:hidden" />
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

        {/* Chat messages area */}
        <div className="flex flex-col flex-grow p-6 overflow-y-auto">
          {messages.length === 0 && !isLoading ? (
            <div className="mb-5 flex items-start gap-3 justify-start">
              {/* AI Avatar for greeting */}
              <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div className="text-gray-700">
                Hi there 👋
              </div>
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div 
                  key={message.id} 
                  className={`mb-5 flex items-start gap-3 ${
                    message.role === 'user' ? 'justify-end' : 'justify-start'
                  }`}
                  data-testid={`message-${message.role}`}
                >
                  {/* AI Avatar - shown on left for assistant messages */}
                  {message.role === 'assistant' && (
                    <div 
                      className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center"
                      data-testid="ai-avatar"
                    >
                      <Bot className="w-5 h-5 text-white" />
                    </div>
                  )}

                  {/* Message content container */}
                  <div className="flex flex-col max-w-[85%]">
                    {/* Message bubble */}
                    <div
                      className={`${
                        message.role === 'user'
                          ? 'bg-blue-50 text-blue-900 rounded-2xl rounded-tr-sm'
                          : 'text-gray-700'
                      } ${message.role === 'user' ? 'px-5 py-3' : ''}`}
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

                    {/* Option buttons - shown below assistant messages with options */}
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

                  {/* User Avatar - shown on right for user messages */}
                  {message.role === 'user' && (
                    <div 
                      className="flex-shrink-0 w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center"
                      data-testid="user-avatar"
                    >
                      <User className="w-5 h-5 text-gray-600" />
                    </div>
                  )}
                </div>
              ))}

              {isLoading && !isStreaming && (
                <div className="mb-5 flex items-start gap-3 justify-start">
                  {/* AI Avatar for loading state */}
                  <div className="flex-shrink-0 w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                  </div>
                  <div className="flex items-center gap-1.5 py-3">
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-300 dot-bounce dot-bounce-1" />
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-300 dot-bounce dot-bounce-2" />
                    <div className="h-1.5 w-1.5 rounded-full bg-gray-300 dot-bounce dot-bounce-3" />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Chat input */}
        <div className="w-full bg-white border-t border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3 px-4 py-2 rounded-xl bg-slate-100 border border-slate-200 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isLoading || isStreaming}
              placeholder={isWaitingForInput && pendingOptions.length > 0 ? "Select an option above or type..." : "Type a message..."}
              className="flex-grow py-2 bg-transparent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 text-slate-900 placeholder:text-slate-400"
              data-testid="chat-input"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={isLoading || isStreaming || !input.trim()}
              className={`p-2 rounded-lg transition-colors ${
                input.trim() 
                  ? 'bg-blue-600 hover:bg-blue-700 text-white' 
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
              data-testid="send-button"
            >
              <Send className="w-5 h-5" />
            </button>
            <button
              type="button"
              className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
              data-testid="mic-button"
            >
              <Mic className="w-5 h-5" />
            </button>
          </div>
          {messages.length > 0 && (
            <button
              onClick={newConversation}
              className="mt-2 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
