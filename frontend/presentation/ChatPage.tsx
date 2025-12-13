/**
 * ChatPage Component - Minimal two-section chat interface.
 */

'use client';

import { useState, useEffect, useRef, KeyboardEvent } from 'react';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';
import { useLocale } from '@/contexts/LocaleContext';
import { Sidebar } from './Sidebar';
import ReactMarkdown from 'react-markdown';
import { Menu, X, Bot, User, Send, Stethoscope } from 'lucide-react';
import { MessageSkeleton } from './MessageSkeleton';
import { GraphVisualization } from './GraphVisualization';
import { readIsExpanded, writeIsExpanded } from '@/utils/graphStorageHelpers';
import { GraphNodeId } from '@/types/graph';

export function ChatPage() {
  const {
    messages,
    isLoading,
    isStreaming,
    error,
    sendMessage,
    selectOption,
    submitMultipleAnswers,
    newConversation,
    isWaitingForInput,
    pendingOptions,
    pendingQuestions,
    pendingQuestion,
    storageError,
    isStorageAvailable,
    clearStorageError,
    initializeStorage,
    checkpointExpired,
    checkpointExpiredMessage,
    clearCheckpointExpired,
    currentStageMessage,
    currentStageData,
    stagesLiveData,
    // Graph state from Zustand (single source of truth)
    // Requirements: 1.1, 1.2
    graphState,
  } = useChatViewModel();

  const handleStartNewConversation = () => {
    clearCheckpointExpired();
    newConversation();
  };

  const handleContinueFreshWorkflow = () => {
    clearCheckpointExpired();
  };

  useEffect(() => {
    initializeStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [input, setInput] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // State for multi-question answers
  const [multiAnswers, setMultiAnswers] = useState<string[]>([]);
  
  // Graph visualization state - only isExpanded is local state for UI toggle
  // Requirements: 1.1, 1.4 - Graph state comes from Zustand store
  const [isGraphExpanded, setIsGraphExpanded] = useState(false);
  
  // Localization
  const { t, direction, locale } = useLocale();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load graph panel expanded state from localStorage on mount - Requirements: 1.4
  useEffect(() => {
    setIsGraphExpanded(readIsExpanded());
  }, []);

  // Stage tracking is now handled by GraphStateService in the ViewModel
  // Requirements: 1.1, 1.2 - Zustand store is the single source of truth

  // Handle graph panel toggle with localStorage persistence - Requirements: 1.2, 1.3, 1.4
  const handleGraphToggle = () => {
    const newState = !isGraphExpanded;
    setIsGraphExpanded(newState);
    writeIsExpanded(newState);
  };

  // Reset multi-answers when pendingQuestions changes
  useEffect(() => {
    if (pendingQuestions.length > 0) {
      setMultiAnswers(new Array(pendingQuestions.length).fill(''));
    } else {
      setMultiAnswers([]);
    }
  }, [pendingQuestions]);

  // Get translated questions header for bilingual support
  const questionsHeader = t('chat.pleaseAnswerQuestions');

  const handleSend = () => {
    if (input.trim() && !isLoading && !isStreaming) {
      // Pass locale and translated header for Persian language support (Requirements: 3.4)
      sendMessage(input.trim(), true, locale, questionsHeader);
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
      // Pass locale and translated header for Persian language support (Requirements: 3.4)
      await selectOption(option, locale, questionsHeader);
    }
  };

  const handleMultiAnswerChange = (index: number, value: string) => {
    setMultiAnswers(prev => {
      const newAnswers = [...prev];
      newAnswers[index] = value;
      return newAnswers;
    });
  };

  const handleMultiAnswerSubmit = async () => {
    if (!isLoading && multiAnswers.every(a => a.trim())) {
      // Pass locale and translated header for Persian language support (Requirements: 3.4)
      await submitMultipleAnswers(multiAnswers, locale, questionsHeader);
      setMultiAnswers([]);
    }
  };

  return (
    <div className={`h-screen flex font-sans ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
      {/* Mobile Menu Toggle */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className={`md:hidden fixed top-4 z-50 p-2.5 bg-white/50 backdrop-blur-sm rounded-lg text-gray-700 hover:bg-white/70 transition-all duration-200 ${direction === 'rtl' ? 'right-4' : 'left-4'}`}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar - built into background, no rounded corners */}
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Overlay for mobile sidebar */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main Chat Panel - floating rounded card */}
      <div 
        className={`flex-1 h-full p-4 md:p-6 transition-all duration-300 ${
          isGraphExpanded ? 'mr-80' : ''
        }`}
        data-testid="chat-panel-container"
      >
        <div className="h-full bg-white/90 backdrop-blur-md rounded-3xl flex flex-col overflow-hidden shadow-sm">
          {/* Storage Unavailable Warning */}
          {!isStorageAvailable && (
            <div className="bg-amber-50 border-b border-amber-200 px-4 py-3">
              <p className="text-sm text-amber-700">
                <span className="font-medium">{t('common.warning')}:</span> {t('errors.storageUnavailable')}
              </p>
            </div>
          )}

          {/* Storage Error Banner */}
          {storageError && (
            <div className="bg-orange-50 border-b border-orange-200 px-4 py-3 flex items-center justify-between">
              <p className="text-sm text-orange-700">
                <span className="font-medium">{t('errors.storageError')}:</span> {storageError}
              </p>
              <button onClick={clearStorageError} className="text-orange-600 hover:text-orange-700 text-sm font-medium">
                {t('common.dismiss')}
              </button>
            </div>
          )}

          {/* Error Banner */}
          {error && (
            <div className="bg-red-50 border-b border-red-200 px-4 py-3">
              <p className="text-sm text-red-700">
                <span className="font-medium">{t('common.error')}:</span> {error}
              </p>
            </div>
          )}

          {/* Checkpoint Expiry Banner */}
          {checkpointExpired && (
            <div className="bg-gray-50 border-b border-gray-200 px-4 py-4">
              <p className="text-sm text-gray-700 mb-3">
                <span className="font-medium">{t('errors.sessionExpiredTitle')}:</span>{' '}
                {checkpointExpiredMessage || t('errors.sessionExpired')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleStartNewConversation}
                  className="px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm rounded-lg transition-colors"
                >
                  {t('actions.startNewConversation')}
                </button>
                <button
                  onClick={handleContinueFreshWorkflow}
                  className="px-4 py-2 text-gray-600 hover:text-gray-800 text-sm transition-colors"
                >
                  {t('actions.continueHere')}
                </button>
              </div>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-4">
            {messages.length === 0 && !isLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center text-white mb-4 shadow-lg">
                  <Stethoscope size={32} />
                </div>
                <h2 className="text-xl font-semibold text-gray-800 mb-2">{t('chat.howCanIHelp')}</h2>
                <p className="text-gray-500 text-sm mb-6 max-w-md">
                  {t('chat.aiAssistantIntro')}
                </p>
                <p className="text-xs text-amber-600 bg-amber-50 px-4 py-2 rounded-lg mb-6 max-w-md">
                  {t('medical.disclaimer')}
                </p>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-lg">
                  {[
                    { text: t('suggestions.headache'), desc: t('suggestions.headacheDesc') },
                    { text: t('suggestions.stomachPain'), desc: t('suggestions.stomachPainDesc') },
                    { text: t('suggestions.fever'), desc: t('suggestions.feverDesc') },
                    { text: t('suggestions.fatigue'), desc: t('suggestions.fatigueDesc') },
                  ].map((item, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        setInput(item.text);
                      }}
                      className={`p-4 bg-teal-50 hover:bg-teal-100 border border-teal-100 rounded-xl transition-colors group ${direction === 'rtl' ? 'text-right' : 'text-left'}`}
                    >
                      <p className="text-sm font-medium text-teal-700 group-hover:text-teal-800">{item.text}</p>
                      <p className="text-xs text-teal-500 mt-1">{item.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex w-full ${
                      direction === 'rtl'
                        ? (message.role === 'user' 
                            ? 'justify-start md:justify-start' // Mobile: right, Desktop: right (user on right in RTL)
                            : 'justify-start md:justify-end') // Mobile: right, Desktop: left (AI on left in RTL desktop)
                        : (message.role === 'user' ? 'justify-end' : 'justify-start')
                    }`}
                    data-testid={`message-${message.role}`}
                  >
                    <div className={`flex gap-3 ${
                      direction === 'rtl'
                        ? (message.role === 'user'
                            ? 'max-w-[80%] flex-row'
                            : 'max-w-[95%] sm:max-w-[85%] flex-row md:flex-row-reverse')
                        : (message.role === 'user' 
                            ? 'max-w-[80%] flex-row-reverse'
                            : 'max-w-[95%] sm:max-w-[85%] flex-row')
                    }`}>
                      <div className="flex-shrink-0">
                        {message.role === 'assistant' ? (
                          <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white" data-testid="ai-avatar">
                            <Bot size={16} />
                          </div>
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white" data-testid="user-avatar">
                            <User size={16} />
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col">
                        <div
                          className={`text-sm px-4 py-3 ${
                            message.role === 'user'
                              ? `bg-sky-100 text-gray-800 rounded-2xl ${direction === 'rtl' ? 'rounded-tl-sm' : 'rounded-tr-sm'}`
                              : 'text-gray-700'
                          }`}
                        >
                          {message.role === 'user' ? (
                            <div className="whitespace-pre-wrap">{message.content}</div>
                          ) : (
                            <div className="markdown-content">
                              <ReactMarkdown
                                components={{
                                  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                  ul: ({ children }) => <ul className="list-disc ml-4 mb-2">{children}</ul>,
                                  ol: ({ children }) => <ol className="list-decimal ml-4 mb-2">{children}</ol>,
                                  li: ({ children }) => <li className="mb-1">{children}</li>,
                                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                                }}
                              >
                                {message.content}
                              </ReactMarkdown>
                            </div>
                          )}
                        </div>

                        {/* Single question with options */}
                        {message.isQuestion && message.options && message.options.length > 0 && !message.questions && (
                          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-gray-200">
                            {message.options.map((option, idx) => (
                              <button
                                key={idx}
                                onClick={() => handleOptionClick(option)}
                                disabled={isLoading}
                                className="px-4 py-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-full text-blue-600 text-sm font-medium transition-colors disabled:opacity-50"
                              >
                                {option}
                              </button>
                            ))}
                          </div>
                        )}

                        {/* Multi-question format - Card-based layout */}
                        {message.isQuestion && message.questions && message.questions.length > 0 && (
                          <div className="mt-4 space-y-3">
                            {message.questions.map((q, qIdx) => (
                              <div 
                                key={qIdx} 
                                className={`p-4 rounded-xl border transition-all duration-200 ${
                                  multiAnswers[qIdx] 
                                    ? 'bg-violet-50 border-violet-200 shadow-sm' 
                                    : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-sm'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <span className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold ${
                                    multiAnswers[qIdx] 
                                      ? 'bg-violet-600 text-white' 
                                      : 'bg-gray-200 text-gray-600'
                                  }`}>
                                    {q.question_number}
                                  </span>
                                  <div className="flex-1 space-y-3">
                                    <p className="text-sm font-medium text-gray-800">
                                      {q.question}
                                    </p>
                                    <div className="grid grid-cols-2 gap-2 w-full">
                                      {q.options.map((option, optIdx) => (
                                        <button
                                          key={optIdx}
                                          onClick={() => handleMultiAnswerChange(qIdx, option)}
                                          disabled={isLoading}
                                          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 disabled:opacity-50 text-center ${
                                            multiAnswers[qIdx] === option
                                              ? 'bg-violet-600 text-white shadow-sm'
                                              : 'bg-gray-100 hover:bg-gray-200 text-gray-700 hover:text-gray-900'
                                          }`}
                                        >
                                          {option}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                            <button
                              onClick={handleMultiAnswerSubmit}
                              disabled={isLoading || !multiAnswers.every(a => a.trim())}
                              className="w-full mt-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
                            >
                              {t('chat.submitAnswers')}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {isLoading && !isStreaming && <MessageSkeleton stageMessage={currentStageMessage} direction={direction} />}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 border-t border-gray-200">
            <div className={`flex items-center gap-3 bg-gray-100 rounded-2xl px-4 py-2 ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading || isStreaming}
                placeholder={
                  isWaitingForInput && pendingQuestions.length > 0 
                    ? t('chat.placeholderQuestions')
                    : isWaitingForInput && pendingOptions.length > 0 
                      ? t('chat.placeholderOptions')
                      : t('chat.placeholder')
                }
                className={`flex-1 bg-transparent border-none outline-none text-gray-800 placeholder:text-gray-400 text-sm py-2 ${direction === 'rtl' ? 'text-right' : 'text-left'}`}
                dir={direction}
                data-testid="chat-input"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={isLoading || isStreaming || !input.trim()}
                className={`p-2 rounded-xl transition-all ${
                  input.trim()
                    ? 'bg-violet-600 text-white hover:bg-violet-700'
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
                data-testid="send-button"
              >
                <Send size={18} className={direction === 'rtl' ? 'rotate-180' : ''} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Graph Visualization - Page-level Right Sidebar */}
      {/* Requirements: 1.1, 1.2 - GraphVisualization reads from Zustand store */}
      {/* Requirements: 11.2, 11.3 - Stage field used directly as GraphNodeId */}
      <GraphVisualization
        isExpanded={isGraphExpanded}
        onToggle={handleGraphToggle}
        // Legacy props passed for backward compatibility, but Zustand state is preferred
        currentStage={graphState.currentStage}
        completedStages={graphState.completedStages}
        stagesLiveData={stagesLiveData}
        liveData={currentStageData as Record<string, unknown> | undefined}
        isWaitingForInput={isWaitingForInput}
        waitingNodeId={graphState.waitingNodeId}
      />
    </div>
  );
}
