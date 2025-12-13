/**
 * Chat ViewModel - manages chat state and business logic.
 * MVVM Pattern: This is the ViewModel layer.
 * 
 * Updated to use client-side IndexedDB storage for conversations.
 * Requirements: 1.2, 1.4
 */

import { create } from 'zustand';
import { Message, ConversationSummary, CheckpointExpiredError, QuestionWithOptions } from '@/types';
import { apiService } from '@/services/api';
import {
  getStorageService,
  initializeStorage,
  isStorageSupported,
  verifyStorageAccess,
  StorageError,
  StoredConversation,
  StoredMessage,
  StoredQuestionWithOptions,
} from '@/services/storage';

interface ChatState {
  // State
  messages: Message[];
  conversationId: string | null;
  isLoading: boolean;
  error: string | null;
  isStreaming: boolean;
  currentStreamingMessage: string;

  // Stage indicator state (for showing progress during LLM processing)
  currentStage: string | null;
  currentStageMessage: string | null;

  // Conversation list state
  conversations: ConversationSummary[];
  isLoadingConversations: boolean;

  // Interrupt state (for LangGraph clarifications)
  isWaitingForInput: boolean;
  pendingQuestion: string | null;
  pendingOptions: string[];
  /** Multiple pending questions (multi-question mode) */
  pendingQuestions: QuestionWithOptions[];
  threadId: string | null;

  // Storage state (NEW - Requirements: 1.4)
  storageError: string | null;
  isStorageAvailable: boolean;
  checkpointExpired: boolean;
  checkpointExpiredMessage: string | null;

  // Actions
  sendMessage: (content: string, useStreaming?: boolean) => Promise<void>;
  resumeConversation: (userInput: string) => Promise<void>;
  selectOption: (option: string) => Promise<void>;
  /** Submit answers to multiple questions at once */
  submitMultipleAnswers: (answers: string[]) => Promise<void>;
  clearConversation: () => void;
  setError: (error: string | null) => void;
  
  // Conversation list actions
  loadConversations: () => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  newConversation: () => void;
  deleteConversation: (conversationId: string) => Promise<void>;
  
  // Storage actions (NEW - Requirements: 1.2, 1.4)
  initializeStorage: () => Promise<void>;
  clearStorageError: () => void;
  clearCheckpointExpired: () => void;
}

/**
 * Helper function to convert Message to StoredMessage.
 */
function messageToStoredMessage(msg: Message): StoredMessage {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    options: msg.options,
    isQuestion: msg.isQuestion,
    questions: msg.questions,
  };
}

/**
 * Helper function to convert StoredMessage to Message.
 */
function storedMessageToMessage(msg: StoredMessage): Message {
  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp,
    options: msg.options,
    isQuestion: msg.isQuestion,
    questions: msg.questions,
  };
}

/**
 * Helper function to convert QuestionWithOptions to StoredQuestionWithOptions.
 */
function questionToStoredQuestion(q: QuestionWithOptions): StoredQuestionWithOptions {
  return {
    question: q.question,
    options: q.options,
    question_number: q.question_number,
  };
}

/**
 * Helper function to generate a title from the first user message.
 */
function generateTitle(messages: Message[]): string | null {
  const firstUserMessage = messages.find(m => m.role === 'user');
  if (!firstUserMessage) return null;
  const content = firstUserMessage.content.trim();
  return content.length > 50 ? content.substring(0, 47) + '...' : content;
}

/**
 * Helper function to build a StoredConversation from current state.
 */
function buildStoredConversation(
  conversationId: string,
  messages: Message[],
  threadId: string | null,
  isInterrupted: boolean,
  pendingQuestion: string | null,
  pendingOptions: string[],
  pendingQuestions: QuestionWithOptions[],
  existingCreatedAt?: string
): StoredConversation {
  const now = new Date().toISOString();
  return {
    id: conversationId,
    title: generateTitle(messages),
    messages: messages.map(messageToStoredMessage),
    created_at: existingCreatedAt || now,
    updated_at: now,
    version: 1,
    thread_id: threadId || conversationId,
    is_interrupted: isInterrupted,
    pending_question: pendingQuestion || undefined,
    pending_options: pendingOptions.length > 0 ? pendingOptions : undefined,
    pending_questions: pendingQuestions.length > 0 ? pendingQuestions.map(questionToStoredQuestion) : undefined,
  };
}

/**
 * Safe storage operation wrapper - fire and forget.
 * Storage failures should never break the main chat flow.
 * Returns a function that sets storage error state.
 */
async function safeStorageOperation<T>(
  operation: () => Promise<T>,
  onError?: (error: string) => void
): Promise<T | null> {
  try {
    return await operation();
  } catch (err) {
    const errorMessage = err instanceof StorageError 
      ? err.message 
      : err instanceof Error 
        ? err.message 
        : 'Storage operation failed';
    console.error('Storage operation failed:', errorMessage);
    onError?.(errorMessage);
    return null;
  }
}

export const useChatViewModel = create<ChatState>((set, get) => ({
  // Initial state
  messages: [],
  conversationId: null,
  isLoading: false,
  error: null,
  isStreaming: false,
  currentStreamingMessage: '',

  // Stage indicator state
  currentStage: null,
  currentStageMessage: null,

  // Conversation list state
  conversations: [],
  isLoadingConversations: false,

  // Interrupt state
  isWaitingForInput: false,
  pendingQuestion: null,
  pendingOptions: [],
  pendingQuestions: [],
  threadId: null,

  // Storage state (NEW - Requirements: 1.4)
  // Initialize as false to avoid hydration mismatch - will be set correctly on client mount
  storageError: null,
  isStorageAvailable: false,
  checkpointExpired: false,
  checkpointExpiredMessage: null,

  // Send message action
  // Requirements: 1.1, 1.3, 3.2
  sendMessage: async (content: string, useStreaming: boolean = true) => {
    const { conversationId, messages, isStorageAvailable } = get();

    // Validation
    if (!content.trim()) {
      set({ error: 'Message cannot be empty' });
      return;
    }

    // Clear any previous errors and waiting state
    set({ error: null, isLoading: true, isWaitingForInput: false, pendingOptions: [], currentStage: null, currentStageMessage: null });

    // Create user message with proper ID
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    const messagesWithUser = [...messages, userMessage];
    set({ messages: messagesWithUser });

    // Helper to save conversation to IndexedDB (fire-and-forget, never blocks chat)
    const saveToStorage = (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = []
    ): void => {
      if (!isStorageAvailable) return;
      
      // Fire and forget - don't await, don't block
      safeStorageOperation(async () => {
        const storageService = getStorageService();
        // Try to get existing conversation to preserve created_at
        const existing = await storageService.getConversation(convId);
        const storedConv = buildStoredConversation(
          convId,
          msgs,
          tId,
          isInterrupted,
          pendingQ,
          pendingOpts,
          pendingQs,
          existing?.created_at
        );
        await storageService.saveConversation(storedConv);
      }, (error) => set({ storageError: error }));
    };

    try {
      if (useStreaming) {
        // Streaming mode - don't set isStreaming yet, let skeleton show first
        let fullResponse = '';
        let streamingStarted = false;

        const result = await apiService.sendMessageStream(
          {
            conversation_id: conversationId || undefined,
            message: content.trim(),
          },
          (chunk) => {
            // On first chunk, transition from skeleton to streaming
            if (!streamingStarted) {
              streamingStarted = true;
              set({ isStreaming: true, currentStreamingMessage: '', currentStage: null, currentStageMessage: null });
              
              // Add placeholder for assistant message
              const tempAssistantMessage: Message = {
                id: `temp-assistant-${Date.now()}`,
                role: 'assistant',
                content: '',
                timestamp: new Date().toISOString(),
              };
              set({ messages: [...get().messages, tempAssistantMessage] });
            }

            fullResponse += chunk;
            set({ currentStreamingMessage: fullResponse });

            // Update the last message with the streaming content
            const currentMessages = get().messages;
            const updatedMessages = [...currentMessages];
            updatedMessages[updatedMessages.length - 1] = {
              ...updatedMessages[updatedMessages.length - 1],
              content: fullResponse,
            };
            set({ messages: updatedMessages });
          },
          // Stage callback - update the stage indicator
          (stage, message) => {
            set({ currentStage: stage, currentStageMessage: message });
          }
        );

        // Check if we got an interrupt
        if (result.type === 'interrupt') {
          // Remove the placeholder assistant message only if streaming started
          const currentMessages = get().messages;
          const messagesWithoutPlaceholder = streamingStarted 
            ? currentMessages.slice(0, -1) 
            : currentMessages;

          const finalConvId = result.conversationId || conversationId || `conv-${Date.now()}`;

          // Handle multi-question format (preliminary questions)
          if (result.questions && result.questions.length > 0) {
            // Create a message showing all questions
            const questionsText = result.questions
              .map((q, i) => `${i + 1}. ${q.question}`)
              .join('\n\n');
            
            const questionMessage: Message = {
              id: `question-${Date.now()}`,
              role: 'assistant',
              content: `Please answer the following questions:\n\n${questionsText}`,
              timestamp: new Date().toISOString(),
              questions: result.questions,
              isQuestion: true,
            };

            const finalMessages = [...messagesWithoutPlaceholder, questionMessage];

            set({
              messages: finalMessages,
              isWaitingForInput: true,
              pendingQuestion: null,
              pendingOptions: [],
              pendingQuestions: result.questions,
              threadId: result.threadId,
              conversationId: finalConvId,
              isStreaming: false,
              isLoading: false,
            });

            // Save to IndexedDB with interrupt state
            saveToStorage(
              finalConvId,
              finalMessages,
              result.threadId,
              true,
              null,
              [],
              result.questions
            );
            return;
          }

          // Handle single question format (refinement questions)
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: result.question || '',
            timestamp: new Date().toISOString(),
            options: result.options,
            isQuestion: true,
          };

          const finalMessages = [...messagesWithoutPlaceholder, questionMessage];

          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: result.question || null,
            pendingOptions: result.options || [],
            pendingQuestions: [],
            threadId: result.threadId,
            conversationId: finalConvId,
            isStreaming: false,
            isLoading: false,
          });

          // Save to IndexedDB with interrupt state (Requirements: 1.3, 3.2)
          saveToStorage(
            finalConvId,
            finalMessages,
            result.threadId,
            true,
            result.question || null,
            result.options || [],
            []
          );
          return;
        }

        set({ isStreaming: false, currentStreamingMessage: '' });

        // Update conversation_id from backend response
        const finalConvId = result.conversationId || conversationId || `conv-${Date.now()}`;
        if (result.conversationId) {
          set({ conversationId: result.conversationId });
        }

        // Save to IndexedDB after AI response (Requirements: 1.1, 1.3, 3.2)
        const finalMessages = get().messages;
        saveToStorage(finalConvId, finalMessages, finalConvId, false, null, [], []);
      } else {
        // Non-streaming mode
        const response = await apiService.sendMessage({
          conversation_id: conversationId || undefined,
          message: content.trim(),
        });

        // Update messages with real data from backend
        const updatedMessages = messages.filter((m) => !m.id.startsWith('temp-'));
        updatedMessages.push(response.user_message, response.assistant_message);

        set({
          messages: updatedMessages,
          conversationId: response.conversation_id,
        });

        // Save to IndexedDB (Requirements: 1.1, 1.3, 3.2)
        saveToStorage(
          response.conversation_id,
          updatedMessages,
          response.conversation_id,
          false,
          null,
          [],
          []
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      set({ error: errorMessage });

      // Remove temporary messages on error
      set({ messages: messages.filter((m) => !m.id.startsWith('temp-')) });
    } finally {
      set({ isLoading: false, isStreaming: false, currentStage: null, currentStageMessage: null });
      // Refresh conversation list to show new/updated conversation
      get().loadConversations();
    }
  },

  // Select an option (click on button)
  // Requirements: 3.3, 4.1
  selectOption: async (option: string) => {
    const { threadId, messages, conversationId, isStorageAvailable } = get();

    if (!threadId) {
      set({ error: 'No active conversation to resume' });
      return;
    }

    set({ isLoading: true, error: null, isWaitingForInput: false, pendingOptions: [], pendingQuestions: [], currentStage: null, currentStageMessage: null });

    // Mark the question message as no longer waiting
    const updatedMessages = messages.map((msg) =>
      msg.isQuestion ? { ...msg, isQuestion: false, options: undefined, questions: undefined } : msg
    );

    // Add user's selected option as a message
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: option,
      timestamp: new Date().toISOString(),
    };
    const messagesWithUser = [...updatedMessages, userMessage];
    set({ messages: messagesWithUser });

    // Helper to save conversation to IndexedDB (fire-and-forget, never blocks chat)
    const saveToStorage = (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = []
    ): void => {
      if (!isStorageAvailable || !convId) return;
      
      // Fire and forget - don't await, don't block
      safeStorageOperation(async () => {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        const storedConv = buildStoredConversation(
          convId,
          msgs,
          tId,
          isInterrupted,
          pendingQ,
          pendingOpts,
          pendingQs,
          existing?.created_at
        );
        await storageService.saveConversation(storedConv);
      }, (error) => set({ storageError: error }));
    };

    try {
      // Use streaming resume to get stage indicators
      const result = await apiService.resumeConversationStream(
        threadId,
        option,
        // Stage callback - update the stage indicator
        (stage, message) => {
          set({ currentStage: stage, currentStageMessage: message });
        }
      );

      if (result.type === 'interrupt') {
        const convId = conversationId || result.conversation_id;

        // Handle multi-question format
        if (result.questions && result.questions.length > 0) {
          const questionsText = result.questions
            .map((q, i) => `${i + 1}. ${q.question}`)
            .join('\n\n');
          
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: `Please answer the following questions:\n\n${questionsText}`,
            timestamp: new Date().toISOString(),
            questions: result.questions,
            isQuestion: true,
          };
          const finalMessages = [...get().messages, questionMessage];
          
          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: null,
            pendingOptions: [],
            pendingQuestions: result.questions,
            isLoading: false,
            currentStage: null,
            currentStageMessage: null,
          });

          saveToStorage(convId, finalMessages, threadId, true, null, [], result.questions);
          return;
        }

        // Handle single question format
        const questionMessage: Message = {
          id: `question-${Date.now()}`,
          role: 'assistant',
          content: result.question || '',
          timestamp: new Date().toISOString(),
          options: result.options,
          isQuestion: true,
        };
        const finalMessages = [...get().messages, questionMessage];
        
        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question || null,
          pendingOptions: result.options || [],
          pendingQuestions: [],
          isLoading: false,
          currentStage: null,
          currentStageMessage: null,
        });

        // Save interrupt state to IndexedDB (Requirements: 3.3, 4.1)
        saveToStorage(
          convId,
          finalMessages,
          threadId,
          true,
          result.question || null,
          result.options || [],
          []
        );
      } else {
        // Complete - add final response
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          timestamp: new Date().toISOString(),
        };
        const finalMessages = [...get().messages, assistantMessage];
        const convId = conversationId || result.conversation_id;
        
        set({
          messages: finalMessages,
          isLoading: false,
          threadId: null,
          pendingQuestion: null,
          pendingOptions: [],
          pendingQuestions: [],
          currentStage: null,
          currentStageMessage: null,
        });

        // Save to IndexedDB (Requirements: 3.3)
        saveToStorage(convId, finalMessages, convId, false, null, [], []);
        
        // Refresh conversation list
        get().loadConversations();
      }
    } catch (err) {
      if (err instanceof CheckpointExpiredError) {
        // Checkpoint expired - clear interrupt state but keep messages
        set({
          checkpointExpired: true,
          checkpointExpiredMessage: err.message,
          isWaitingForInput: false,
          pendingQuestion: null,
          pendingOptions: [],
          threadId: null,
          isLoading: false,
          currentStage: null,
          currentStageMessage: null,
        });
        // Update IndexedDB to clear interrupt state
        if (isStorageAvailable && conversationId) {
          const storageService = getStorageService();
          const existing = await storageService.getConversation(conversationId);
          if (existing) {
            await storageService.saveConversation({
              ...existing,
              is_interrupted: false,
              pending_question: undefined,
              pending_options: undefined,
            });
          }
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to resume conversation';
        set({ error: errorMessage, isLoading: false, currentStage: null, currentStageMessage: null });
      }
    }
  },

  // Resume conversation action (for free-text input during interrupts)
  // Requirements: 3.3, 4.1
  resumeConversation: async (userInput: string) => {
    const { threadId, messages, conversationId, isStorageAvailable } = get();

    if (!threadId) {
      set({ error: 'No active conversation to resume' });
      return;
    }

    set({ isLoading: true, error: null, isWaitingForInput: false, pendingOptions: [], pendingQuestions: [], currentStage: null, currentStageMessage: null });

    // Mark the question message as no longer waiting
    const updatedMessages = messages.map((msg) =>
      msg.isQuestion ? { ...msg, isQuestion: false, options: undefined, questions: undefined } : msg
    );

    // Add user's answer to messages
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: userInput,
      timestamp: new Date().toISOString(),
    };
    const messagesWithUser = [...updatedMessages, userMessage];
    set({ messages: messagesWithUser });

    // Helper to save conversation to IndexedDB (fire-and-forget, never blocks chat)
    const saveToStorage = (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = []
    ): void => {
      if (!isStorageAvailable || !convId) return;
      
      // Fire and forget - don't await, don't block
      safeStorageOperation(async () => {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        const storedConv = buildStoredConversation(
          convId,
          msgs,
          tId,
          isInterrupted,
          pendingQ,
          pendingOpts,
          pendingQs,
          existing?.created_at
        );
        await storageService.saveConversation(storedConv);
      }, (error) => set({ storageError: error }));
    };

    try {
      // Use streaming resume to get stage indicators
      const result = await apiService.resumeConversationStream(
        threadId,
        userInput,
        // Stage callback - update the stage indicator
        (stage, message) => {
          set({ currentStage: stage, currentStageMessage: message });
        }
      );

      if (result.type === 'interrupt') {
        const convId = conversationId || result.conversation_id;

        // Handle multi-question format
        if (result.questions && result.questions.length > 0) {
          const questionsText = result.questions
            .map((q, i) => `${i + 1}. ${q.question}`)
            .join('\n\n');
          
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: `Please answer the following questions:\n\n${questionsText}`,
            timestamp: new Date().toISOString(),
            questions: result.questions,
            isQuestion: true,
          };
          const finalMessages = [...get().messages, questionMessage];
          
          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: null,
            pendingOptions: [],
            pendingQuestions: result.questions,
            isLoading: false,
            currentStage: null,
            currentStageMessage: null,
          });

          saveToStorage(convId, finalMessages, threadId, true, null, [], result.questions);
          return;
        }

        // Handle single question format
        const questionMessage: Message = {
          id: `question-${Date.now()}`,
          role: 'assistant',
          content: result.question || '',
          timestamp: new Date().toISOString(),
          options: result.options,
          isQuestion: true,
        };
        const finalMessages = [...get().messages, questionMessage];
        
        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question || null,
          pendingOptions: result.options || [],
          pendingQuestions: [],
          isLoading: false,
          currentStage: null,
          currentStageMessage: null,
        });

        // Save interrupt state to IndexedDB (Requirements: 3.3, 4.1)
        saveToStorage(
          convId,
          finalMessages,
          threadId,
          true,
          result.question || null,
          result.options || [],
          []
        );
      } else {
        // Complete - add final response
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          timestamp: new Date().toISOString(),
        };
        const finalMessages = [...get().messages, assistantMessage];
        const convId = conversationId || result.conversation_id;
        
        set({
          messages: finalMessages,
          isLoading: false,
          threadId: null,
          pendingQuestion: null,
          pendingOptions: [],
          pendingQuestions: [],
          currentStage: null,
          currentStageMessage: null,
        });

        // Save to IndexedDB (Requirements: 3.3)
        saveToStorage(convId, finalMessages, convId, false, null, [], []);
        
        // Refresh conversation list
        get().loadConversations();
      }
    } catch (err) {
      if (err instanceof CheckpointExpiredError) {
        // Checkpoint expired - clear interrupt state but keep messages
        set({
          checkpointExpired: true,
          checkpointExpiredMessage: err.message,
          isWaitingForInput: false,
          pendingQuestion: null,
          pendingOptions: [],
          pendingQuestions: [],
          threadId: null,
          isLoading: false,
          currentStage: null,
          currentStageMessage: null,
        });
        // Update IndexedDB to clear interrupt state
        if (isStorageAvailable && conversationId) {
          const storageService = getStorageService();
          const existing = await storageService.getConversation(conversationId);
          if (existing) {
            await storageService.saveConversation({
              ...existing,
              is_interrupted: false,
              pending_question: undefined,
              pending_options: undefined,
              pending_questions: undefined,
            });
          }
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to resume conversation';
        set({ error: errorMessage, isLoading: false, currentStage: null, currentStageMessage: null });
      }
    }
  },

  // Submit multiple answers at once (for multi-question mode)
  submitMultipleAnswers: async (answers: string[]) => {
    const { threadId, messages, conversationId, isStorageAvailable, pendingQuestions } = get();

    if (!threadId) {
      set({ error: 'No active conversation to resume' });
      return;
    }

    set({ isLoading: true, error: null, isWaitingForInput: false, pendingOptions: [], pendingQuestions: [], currentStage: null, currentStageMessage: null });

    // Mark the question message as no longer waiting
    const updatedMessages = messages.map((msg) =>
      msg.isQuestion ? { ...msg, isQuestion: false, options: undefined, questions: undefined } : msg
    );

    // Add user's answers as a single message
    const answersText = pendingQuestions.length > 0
      ? pendingQuestions.map((q, i) => `${i + 1}. ${answers[i] || 'Not answered'}`).join('\n')
      : answers.join('\n');
    
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: answersText,
      timestamp: new Date().toISOString(),
    };
    const messagesWithUser = [...updatedMessages, userMessage];
    set({ messages: messagesWithUser });

    // Helper to save conversation to IndexedDB (fire-and-forget, never blocks chat)
    const saveToStorage = (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = []
    ): void => {
      if (!isStorageAvailable || !convId) return;
      
      // Fire and forget - don't await, don't block
      safeStorageOperation(async () => {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        const storedConv = buildStoredConversation(
          convId,
          msgs,
          tId,
          isInterrupted,
          pendingQ,
          pendingOpts,
          pendingQs,
          existing?.created_at
        );
        await storageService.saveConversation(storedConv);
      }, (error) => set({ storageError: error }));
    };

    try {
      // Use streaming resume to get stage indicators
      const result = await apiService.resumeConversationStream(
        threadId,
        answers,
        // Stage callback - update the stage indicator
        (stage, message) => {
          set({ currentStage: stage, currentStageMessage: message });
        }
      );

      if (result.type === 'interrupt') {
        const convId = conversationId || result.conversation_id;

        // Handle multi-question format
        if (result.questions && result.questions.length > 0) {
          const questionsText = result.questions
            .map((q, i) => `${i + 1}. ${q.question}`)
            .join('\n\n');
          
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: `Please answer the following questions:\n\n${questionsText}`,
            timestamp: new Date().toISOString(),
            questions: result.questions,
            isQuestion: true,
          };
          const finalMessages = [...get().messages, questionMessage];
          
          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: null,
            pendingOptions: [],
            pendingQuestions: result.questions,
            isLoading: false,
            currentStage: null,
            currentStageMessage: null,
          });

          saveToStorage(convId, finalMessages, threadId, true, null, [], result.questions);
          return;
        }

        // Handle single question format (refinement)
        const questionMessage: Message = {
          id: `question-${Date.now()}`,
          role: 'assistant',
          content: result.question || '',
          timestamp: new Date().toISOString(),
          options: result.options,
          isQuestion: true,
        };
        const finalMessages = [...get().messages, questionMessage];
        
        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question || null,
          pendingOptions: result.options || [],
          pendingQuestions: [],
          isLoading: false,
          currentStage: null,
          currentStageMessage: null,
        });

        saveToStorage(convId, finalMessages, threadId, true, result.question || null, result.options || [], []);
      } else {
        // Complete - add final response
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          timestamp: new Date().toISOString(),
        };
        const finalMessages = [...get().messages, assistantMessage];
        const convId = conversationId || result.conversation_id;
        
        set({
          messages: finalMessages,
          isLoading: false,
          threadId: null,
          pendingQuestion: null,
          pendingOptions: [],
          pendingQuestions: [],
          currentStage: null,
          currentStageMessage: null,
        });

        saveToStorage(convId, finalMessages, convId, false, null, [], []);
        get().loadConversations();
      }
    } catch (err) {
      if (err instanceof CheckpointExpiredError) {
        set({
          checkpointExpired: true,
          checkpointExpiredMessage: err.message,
          isWaitingForInput: false,
          pendingQuestion: null,
          pendingOptions: [],
          pendingQuestions: [],
          currentStage: null,
          currentStageMessage: null,
          threadId: null,
          isLoading: false,
        });
        if (isStorageAvailable && conversationId) {
          const storageService = getStorageService();
          const existing = await storageService.getConversation(conversationId);
          if (existing) {
            await storageService.saveConversation({
              ...existing,
              is_interrupted: false,
              pending_question: undefined,
              pending_options: undefined,
              pending_questions: undefined,
            });
          }
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to submit answers';
        set({ error: errorMessage, isLoading: false, currentStage: null, currentStageMessage: null });
      }
    }
  },

  // Clear conversation action
  clearConversation: () => {
    const { conversationId } = get();

    // Optionally delete server checkpoint
    if (conversationId) {
      apiService.deleteCheckpoint(conversationId).catch(console.error);
    }

    set({
      messages: [],
      conversationId: null,
      error: null,
      currentStreamingMessage: '',
      isWaitingForInput: false,
      pendingQuestion: null,
      pendingOptions: [],
      pendingQuestions: [],
      threadId: null,
    });
  },

  // Set error action
  setError: (error: string | null) => {
    set({ error });
  },

  // Load all conversations from IndexedDB
  // Requirements: 2.3
  loadConversations: async () => {
    const { isStorageAvailable } = get();
    if (!isStorageAvailable) {
      set({ isLoadingConversations: false });
      return;
    }

    set({ isLoadingConversations: true });
    try {
      const storageService = getStorageService();
      const summaries = await storageService.listConversations();
      
      // Convert StoredConversationSummary to ConversationSummary
      const conversations: ConversationSummary[] = summaries.map(s => ({
        id: s.id,
        title: s.title || undefined,
        created_at: s.created_at,
        updated_at: s.updated_at,
        message_count: s.message_count,
      }));
      
      set({ conversations, isLoadingConversations: false });
    } catch (err) {
      if (err instanceof StorageError) {
        set({ storageError: err.message, isLoadingConversations: false });
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load conversations';
        set({ error: errorMessage, isLoadingConversations: false });
      }
    }
  },

  // Select and load a conversation from IndexedDB
  // Requirements: 1.2, 4.1
  selectConversation: async (conversationId: string) => {
    const { isStorageAvailable } = get();
    if (!isStorageAvailable) {
      set({ error: 'Storage is not available' });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const storageService = getStorageService();
      const conversation = await storageService.getConversation(conversationId);
      
      if (!conversation) {
        set({ error: 'Conversation not found', isLoading: false });
        return;
      }

      // Convert stored messages to Message type
      const messages = conversation.messages.map(storedMessageToMessage);

      set({
        conversationId: conversation.id,
        messages,
        isLoading: false,
        isWaitingForInput: conversation.is_interrupted,
        pendingQuestion: conversation.pending_question || null,
        pendingOptions: conversation.pending_options || [],
        pendingQuestions: conversation.pending_questions || [],
        threadId: conversation.thread_id,
      });
    } catch (err) {
      if (err instanceof StorageError) {
        set({ storageError: err.message, isLoading: false });
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to load conversation';
        set({ error: errorMessage, isLoading: false });
      }
    }
  },

  // Start a new conversation
  newConversation: () => {
    set({
      messages: [],
      conversationId: null,
      error: null,
      currentStreamingMessage: '',
      isWaitingForInput: false,
      pendingQuestion: null,
      pendingOptions: [],
      pendingQuestions: [],
      threadId: null,
      checkpointExpired: false,
      checkpointExpiredMessage: null,
    });
  },

  // Delete a conversation from IndexedDB and server checkpoint
  // Requirements: 2.1, 2.2
  deleteConversation: async (conversationId: string) => {
    const { isStorageAvailable } = get();
    
    try {
      // Delete from IndexedDB first (Requirements: 2.1)
      if (isStorageAvailable) {
        const storageService = getStorageService();
        await storageService.deleteConversation(conversationId);
      }
      
      // Then delete server checkpoint (Requirements: 2.2)
      await apiService.deleteCheckpoint(conversationId).catch(console.error);
      
      const { conversations, conversationId: currentId } = get();
      set({
        conversations: conversations.filter((c) => c.id !== conversationId),
      });
      
      // If we deleted the current conversation, clear it
      if (currentId === conversationId) {
        set({
          messages: [],
          conversationId: null,
          threadId: null,
        });
      }
    } catch (err) {
      if (err instanceof StorageError) {
        set({ storageError: err.message });
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to delete conversation';
        set({ error: errorMessage });
      }
    }
  },

  // Initialize storage service
  // Requirements: 1.2, 1.4, 4.1
  initializeStorage: async () => {
    // Check storage support on client side only (sync check)
    const storageSupported = isStorageSupported();
    if (!storageSupported) {
      set({
        isStorageAvailable: false,
        storageError: 'Browser storage is not available. Your conversations will not be saved.',
      });
      return;
    }

    // Verify storage actually works (async check - catches private browsing, etc.)
    const storageAccessible = await verifyStorageAccess();
    if (!storageAccessible) {
      set({
        isStorageAvailable: false,
        storageError: 'Storage access is restricted. Your conversations will not be saved.',
      });
      return;
    }

    try {
      await initializeStorage();
      set({ isStorageAvailable: true, storageError: null });
      
      // Load conversations after initialization
      await get().loadConversations();
      
      // Check for interrupted conversations and restore state (Requirements: 4.1)
      try {
        const storageService = getStorageService();
        const interruptedConv = await storageService.findInterruptedConversation();
        
        if (interruptedConv) {
          // Restore the interrupted conversation state
          const messages = interruptedConv.messages.map(storedMessageToMessage);
          set({
            conversationId: interruptedConv.id,
            messages,
            isWaitingForInput: true,
            pendingQuestion: interruptedConv.pending_question || null,
            pendingOptions: interruptedConv.pending_options || [],
            pendingQuestions: interruptedConv.pending_questions || [],
            threadId: interruptedConv.thread_id,
          });
        }
      } catch (restoreErr) {
        // Don't fail initialization if restore fails
        console.error('Failed to restore interrupted conversation:', restoreErr);
      }
    } catch (err) {
      if (err instanceof StorageError) {
        set({
          isStorageAvailable: false,
          storageError: err.message,
        });
      } else {
        set({
          isStorageAvailable: false,
          storageError: 'Failed to initialize storage',
        });
      }
    }
  },

  // Clear storage error
  clearStorageError: () => {
    set({ storageError: null });
  },

  // Clear checkpoint expired state
  clearCheckpointExpired: () => {
    set({ checkpointExpired: false, checkpointExpiredMessage: null });
  },
}));
