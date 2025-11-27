/**
 * ChatPage Component - Chat interface with sidebar for conversation history.
 */

'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';
import { Sidebar } from './Sidebar';
import ReactMarkdown from 'react-markdown';

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
  } = useChatViewModel();

  const [input, setInput] = useState('');
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
    <div className="flex min-h-screen w-screen bg-gray-100">
      {/* Sidebar */}
      <Sidebar />

      {/* Main chat area */}
      <div className="flex-1 flex items-center justify-center p-4">
        {/* Chat container */}
        <div className="flex flex-col h-[calc(100vh-2rem)] w-full max-w-2xl bg-white shadow-lg rounded-2xl overflow-hidden">
        {/* Error Banner */}
        {error && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">
              <span className="font-semibold">Error:</span> {error}
            </p>
          </div>
        )}

        {/* Chat messages area */}
        <div className="flex flex-col flex-grow p-4 overflow-y-auto">
          {messages.length === 0 && !isLoading ? (
            <div className="self-start bg-gray-200 text-gray-800 px-4 py-2 rounded-lg mb-2">
              Hi there 👋
            </div>
          ) : (
            <>
              {messages.map((message) => (
                <div key={message.id} className="mb-3">
                  {/* Message bubble */}
                  <div
                    className={`${
                      message.role === 'user'
                        ? 'self-end ml-auto bg-blue-500 text-white'
                        : 'self-start mr-auto bg-gray-200 text-gray-800'
                    } px-4 py-2 rounded-lg max-w-[85%] w-fit`}
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
                    <div className="flex flex-wrap gap-2 mt-2 max-w-[85%]">
                      {message.options.map((option, index) => (
                        <button
                          key={index}
                          onClick={() => handleOptionClick(option)}
                          disabled={isLoading}
                          className="px-4 py-2 bg-white border border-gray-300 rounded-full text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && !isStreaming && (
                <div className="self-start bg-gray-200 text-gray-800 px-4 py-2 rounded-lg mb-2">
                  <div className="flex items-center gap-1">
                    <div className="h-2 w-2 animate-bounce rounded-full bg-gray-500" />
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-gray-500"
                      style={{ animationDelay: '0.2s' }}
                    />
                    <div
                      className="h-2 w-2 animate-bounce rounded-full bg-gray-500"
                      style={{ animationDelay: '0.4s' }}
                    />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Chat input */}
        <div className="w-full bg-gray-100 border-t border-gray-300 px-6 py-4 flex items-center gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading || isStreaming}
            placeholder={isWaitingForInput && pendingOptions.length > 0 ? "Select an option above or type..." : "Type a message..."}
            className="flex-grow px-4 py-2 rounded-full border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isLoading || isStreaming || !input.trim()}
            className="bg-blue-500 hover:bg-blue-600 text-white font-medium px-4 py-2 rounded-full transition disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            Send
          </button>
          {messages.length > 0 && (
            <button
              onClick={newConversation}
              className="text-xs text-gray-500 hover:text-gray-700"
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
