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
import {
  GraphState,
  INITIAL_GRAPH_STATE,
  graphStateService,
} from '@/services/graphStateService';
import { getPersistenceService, SaveRequest } from '@/services/persistence';
import { GraphNodeId } from '@/types/graph';

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
  currentStageData: Record<string, unknown> | null;
  /** Live data accumulated for each completed stage */
  stagesLiveData: Record<string, Record<string, unknown>>;

  // Graph visualization state (single source of truth)
  // Requirements: 1.1, 1.2
  graphState: GraphState;

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

  // Storage state (NEW - Requirements: 1.4, 5.4)
  storageError: string | null;
  isStorageAvailable: boolean;
  checkpointExpired: boolean;
  checkpointExpiredMessage: string | null;
  /** Whether any conversation has pending saves - Requirements: 5.4 */
  hasPendingSaves: boolean;

  // Actions
  sendMessage: (content: string, useStreaming?: boolean, locale?: string, questionsHeader?: string) => Promise<void>;
  resumeConversation: (userInput: string, locale?: string, questionsHeader?: string) => Promise<void>;
  selectOption: (option: string, locale?: string, questionsHeader?: string) => Promise<void>;
  /** Submit answers to multiple questions at once */
  submitMultipleAnswers: (answers: string[], locale?: string, questionsHeader?: string) => Promise<void>;
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
  
  // Graph state actions (Requirements: 1.1, 1.2, 1.3)
  /** Update graph state atomically */
  updateGraphState: (updates: Partial<GraphState>) => void;
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
  currentStageData: null,
  stagesLiveData: {},

  // Graph visualization state (single source of truth)
  // Requirements: 1.1, 1.2
  graphState: INITIAL_GRAPH_STATE,

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
  hasPendingSaves: false,

  // Send message action
  // Requirements: 1.1, 1.3, 3.2, 3.4 (Persian localization)
  sendMessage: async (content: string, useStreaming: boolean = true, locale?: string, questionsHeader?: string) => {
    const defaultQuestionsHeader = questionsHeader || 'Please answer the following questions:';
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

    // Helper to save conversation using PersistenceService
    // Requirements: 1.4, 4.1, 6.1 - Centralized persistence with graph state
    const saveConversation = async (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = [],
      currentGraphState: GraphState
    ): Promise<void> => {
      if (!isStorageAvailable) return;
      
      try {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        
        const saveRequest: SaveRequest = {
          conversationId: convId,
          messages: msgs,
          threadId: tId,
          isInterrupted,
          pendingQuestion: pendingQ,
          pendingOptions: pendingOpts,
          pendingQuestions: pendingQs,
          graphState: {
            completedStages: currentGraphState.completedStages,
            waitingNodeId: currentGraphState.waitingNodeId,
            stagesLiveData: currentGraphState.stagesLiveData as Record<string, Record<string, unknown>>,
          },
          existingCreatedAt: existing?.created_at,
        };
        
        await getPersistenceService().saveConversation(saveRequest);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Storage operation failed';
        console.error('Storage operation failed:', errorMessage);
        set({ storageError: errorMessage });
      }
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
          // Stage callback - update the stage indicator with live data
          // Requirements: 1.3, 5.1 - Use GraphStateService for atomic updates
          (stage, message, data) => {
            const currentGraphState = get().graphState;
            const newGraphState = graphStateService.processStageEvent(
              currentGraphState,
              stage as any,
              data
            );
            
            // Update both legacy state and new graphState atomically
            const currentLiveData = get().stagesLiveData;
            const existingStageData = currentLiveData[stage] || {};
            const updatedLiveData = data 
              ? { ...currentLiveData, [stage]: { ...existingStageData, ...data } }
              : currentLiveData;
            set({ 
              currentStage: stage, 
              currentStageMessage: message, 
              currentStageData: data || null,
              stagesLiveData: updatedLiveData,
              graphState: newGraphState,
            });
          },
          // Pass locale for Persian language support (Requirements: 3.4)
          locale
        );

        // Check if we got an interrupt
        if (result.type === 'interrupt') {
          // Remove the placeholder assistant message only if streaming started
          const currentMessages = get().messages;
          const messagesWithoutPlaceholder = streamingStarted 
            ? currentMessages.slice(0, -1) 
            : currentMessages;

          const finalConvId = result.conversationId || conversationId || `conv-${Date.now()}`;

          // Process interrupt event using GraphStateService
          // Requirements: 1.4, 4.1, 4.2, 5.2
          const currentGraphState = get().graphState;
          const interruptForGraphState = {
            ...result,
            thread_id: result.threadId,
          };
          const newGraphState = graphStateService.processInterruptEvent(currentGraphState, interruptForGraphState);

          // Handle multi-question format (preliminary questions)
          if (result.questions && result.questions.length > 0) {
            // Create a message showing all questions
            const questionsText = result.questions
              .map((q, i) => `${i + 1}. ${q.question}`)
              .join('\n\n');
            
            const questionMessage: Message = {
              id: `question-${Date.now()}`,
              role: 'assistant',
              content: `${defaultQuestionsHeader}\n\n${questionsText}`,
              timestamp: new Date().toISOString(),
              questions: result.questions,
              isQuestion: true,
            };

            const finalMessages = [...messagesWithoutPlaceholder, questionMessage];

            // Save to IndexedDB with interrupt state BEFORE setting isWaitingForInput
            // Requirements: 6.1 - Await save completion for interrupt state
            await saveConversation(
              finalConvId,
              finalMessages,
              result.threadId,
              true,
              null,
              [],
              result.questions,
              newGraphState
            );

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
              graphState: newGraphState,
            });
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

          // Save to IndexedDB with interrupt state BEFORE setting isWaitingForInput
          // Requirements: 6.1 - Await save completion for interrupt state
          await saveConversation(
            finalConvId,
            finalMessages,
            result.threadId,
            true,
            result.question || null,
            result.options || [],
            [],
            newGraphState
          );

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
            graphState: newGraphState,
          });
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
        const currentGraphState = get().graphState;
        // Fire and forget for non-interrupt saves - don't block the UI
        saveConversation(finalConvId, finalMessages, finalConvId, false, null, [], [], currentGraphState);
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
        const currentGraphState = get().graphState;
        // Fire and forget for non-interrupt saves - don't block the UI
        saveConversation(
          response.conversation_id,
          updatedMessages,
          response.conversation_id,
          false,
          null,
          [],
          [],
          currentGraphState
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
  // Requirements: 3.3, 4.1, 3.4 (Persian localization)
  selectOption: async (option: string, locale?: string, questionsHeader?: string) => {
    const defaultQuestionsHeader = questionsHeader || 'Please answer the following questions:';
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

    // Helper to save conversation using PersistenceService
    // Requirements: 1.4, 4.1, 6.1 - Centralized persistence with graph state
    const saveConversation = async (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = [],
      currentGraphState: GraphState
    ): Promise<void> => {
      if (!isStorageAvailable || !convId) return;
      
      try {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        
        const saveRequest: SaveRequest = {
          conversationId: convId,
          messages: msgs,
          threadId: tId,
          isInterrupted,
          pendingQuestion: pendingQ,
          pendingOptions: pendingOpts,
          pendingQuestions: pendingQs,
          graphState: {
            completedStages: currentGraphState.completedStages,
            waitingNodeId: currentGraphState.waitingNodeId,
            stagesLiveData: currentGraphState.stagesLiveData as Record<string, Record<string, unknown>>,
          },
          existingCreatedAt: existing?.created_at,
        };
        
        await getPersistenceService().saveConversation(saveRequest);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Storage operation failed';
        console.error('Storage operation failed:', errorMessage);
        set({ storageError: errorMessage });
      }
    };

    try {
      // Use streaming resume to get stage indicators (selectOption)
      const result = await apiService.resumeConversationStream(
        threadId,
        option,
        // Stage callback - update the stage indicator with live data
        // Requirements: 1.3, 5.1 - Use GraphStateService for atomic updates
        (stage, message, data) => {
          const currentGraphState = get().graphState;
          const newGraphState = graphStateService.processStageEvent(
            currentGraphState,
            stage as any,
            data
          );
          
          const currentLiveData = get().stagesLiveData;
          const existingStageData = currentLiveData[stage] || {};
          const updatedLiveData = data 
            ? { ...currentLiveData, [stage]: { ...existingStageData, ...data } }
            : currentLiveData;
          set({ 
            currentStage: stage, 
            currentStageMessage: message, 
            currentStageData: data || null,
            stagesLiveData: updatedLiveData,
            graphState: newGraphState,
          });
        },
        // Pass locale for Persian language support (Requirements: 3.4)
        locale
      );

      if (result.type === 'interrupt') {
        const convId = conversationId || result.conversation_id;

        // Process interrupt event using GraphStateService (selectOption)
        // Requirements: 1.4, 4.1, 4.2, 5.2
        const selectOptionCurrentGraphState = get().graphState;
        const selectOptionInterruptForGraphState = {
          ...result,
          thread_id: threadId,
        };
        const selectOptionInterruptGraphState = graphStateService.processInterruptEvent(selectOptionCurrentGraphState, selectOptionInterruptForGraphState);

        // Handle multi-question format
        if (result.questions && result.questions.length > 0) {
          const questionsText = result.questions
            .map((q, i) => `${i + 1}. ${q.question}`)
            .join('\n\n');
          
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: `${defaultQuestionsHeader}\n\n${questionsText}`,
            timestamp: new Date().toISOString(),
            questions: result.questions,
            isQuestion: true,
          };
          const finalMessages = [...get().messages, questionMessage];
          
          // Save to IndexedDB with interrupt state BEFORE setting isWaitingForInput
          // Requirements: 6.1 - Await save completion for interrupt state
          await saveConversation(convId, finalMessages, threadId, true, null, [], result.questions, selectOptionInterruptGraphState);

          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: null,
            pendingOptions: [],
            pendingQuestions: result.questions,
            isLoading: false,
            currentStage: null,
            currentStageMessage: null,
            graphState: selectOptionInterruptGraphState,
          });
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
        
        // Save interrupt state to IndexedDB BEFORE setting isWaitingForInput
        // Requirements: 6.1 - Await save completion for interrupt state
        await saveConversation(
          convId,
          finalMessages,
          threadId,
          true,
          result.question || null,
          result.options || [],
          [],
          selectOptionInterruptGraphState
        );

        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question || null,
          pendingOptions: result.options || [],
          pendingQuestions: [],
          isLoading: false,
          currentStage: null,
          currentStageMessage: null,
          graphState: selectOptionInterruptGraphState,
        });
      } else {
        // Complete - add final response (selectOption)
        // Process complete event using GraphStateService
        // Requirements: 5.3
        const selectOptionCompleteGraphState = graphStateService.processCompleteEvent(get().graphState);

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
          graphState: selectOptionCompleteGraphState,
        });

        // Save to IndexedDB (Requirements: 3.3)
        // Fire and forget for non-interrupt saves - don't block the UI
        saveConversation(convId, finalMessages, convId, false, null, [], [], selectOptionCompleteGraphState);
        
        // Refresh conversation list
        get().loadConversations();
      }
    } catch (err) {
      if (err instanceof CheckpointExpiredError) {
        // Checkpoint expired - clear interrupt state but keep messages (selectOption)
        // Requirements: 6.4 - Save conversation with cleared interrupt state
        const currentGraphState = get().graphState;
        const currentMessages = get().messages;
        
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
        
        // Save cleared interrupt state using PersistenceService
        if (conversationId) {
          saveConversation(
            conversationId,
            currentMessages,
            null, // Clear threadId
            false, // is_interrupted = false
            null, // Clear pending_question
            [], // Clear pending_options
            [], // Clear pending_questions
            currentGraphState
          );
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to resume conversation';
        set({ error: errorMessage, isLoading: false, currentStage: null, currentStageMessage: null });
      }
    }
  },

  // Resume conversation action (for free-text input during interrupts)
  // Requirements: 3.3, 4.1, 3.4 (Persian localization)
  resumeConversation: async (userInput: string, locale?: string, questionsHeader?: string) => {
    const defaultQuestionsHeader = questionsHeader || 'Please answer the following questions:';
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

    // Helper to save conversation using PersistenceService
    // Requirements: 1.4, 4.1, 6.1 - Centralized persistence with graph state
    const saveConversation = async (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = [],
      currentGraphState: GraphState
    ): Promise<void> => {
      if (!isStorageAvailable || !convId) return;
      
      try {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        
        const saveRequest: SaveRequest = {
          conversationId: convId,
          messages: msgs,
          threadId: tId,
          isInterrupted,
          pendingQuestion: pendingQ,
          pendingOptions: pendingOpts,
          pendingQuestions: pendingQs,
          graphState: {
            completedStages: currentGraphState.completedStages,
            waitingNodeId: currentGraphState.waitingNodeId,
            stagesLiveData: currentGraphState.stagesLiveData as Record<string, Record<string, unknown>>,
          },
          existingCreatedAt: existing?.created_at,
        };
        
        await getPersistenceService().saveConversation(saveRequest);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Storage operation failed';
        console.error('Storage operation failed:', errorMessage);
        set({ storageError: errorMessage });
      }
    };

    try {
      // Use streaming resume to get stage indicators (resumeConversation)
      const result = await apiService.resumeConversationStream(
        threadId,
        userInput,
        // Stage callback - update the stage indicator with live data
        // Requirements: 1.3, 5.1 - Use GraphStateService for atomic updates
        (stage, message, data) => {
          const currentGraphState = get().graphState;
          const newGraphState = graphStateService.processStageEvent(
            currentGraphState,
            stage as any,
            data
          );
          
          const currentLiveData = get().stagesLiveData;
          const existingStageData = currentLiveData[stage] || {};
          const updatedLiveData = data 
            ? { ...currentLiveData, [stage]: { ...existingStageData, ...data } }
            : currentLiveData;
          set({ 
            currentStage: stage, 
            currentStageMessage: message, 
            currentStageData: data || null,
            stagesLiveData: updatedLiveData,
            graphState: newGraphState,
          });
        },
        // Pass locale for Persian language support (Requirements: 3.4)
        locale
      );

      if (result.type === 'interrupt') {
        const convId = conversationId || result.conversation_id;

        // Process interrupt event using GraphStateService (resumeConversation)
        // Requirements: 1.4, 4.1, 4.2, 5.2
        const resumeCurrentGraphState = get().graphState;
        const resumeInterruptForGraphState = {
          ...result,
          thread_id: threadId,
        };
        const resumeInterruptGraphState = graphStateService.processInterruptEvent(resumeCurrentGraphState, resumeInterruptForGraphState);

        // Handle multi-question format
        if (result.questions && result.questions.length > 0) {
          const questionsText = result.questions
            .map((q, i) => `${i + 1}. ${q.question}`)
            .join('\n\n');
          
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: `${defaultQuestionsHeader}\n\n${questionsText}`,
            timestamp: new Date().toISOString(),
            questions: result.questions,
            isQuestion: true,
          };
          const finalMessages = [...get().messages, questionMessage];
          
          // Save to IndexedDB with interrupt state BEFORE setting isWaitingForInput
          // Requirements: 6.1 - Await save completion for interrupt state
          await saveConversation(convId, finalMessages, threadId, true, null, [], result.questions, resumeInterruptGraphState);

          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: null,
            pendingOptions: [],
            pendingQuestions: result.questions,
            isLoading: false,
            currentStage: null,
            currentStageMessage: null,
            graphState: resumeInterruptGraphState,
          });
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
        
        // Save interrupt state to IndexedDB BEFORE setting isWaitingForInput
        // Requirements: 6.1 - Await save completion for interrupt state
        await saveConversation(
          convId,
          finalMessages,
          threadId,
          true,
          result.question || null,
          result.options || [],
          [],
          resumeInterruptGraphState
        );

        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question || null,
          pendingOptions: result.options || [],
          pendingQuestions: [],
          isLoading: false,
          currentStage: null,
          currentStageMessage: null,
          graphState: resumeInterruptGraphState,
        });
      } else {
        // Complete - add final response (resumeConversation)
        // Process complete event using GraphStateService
        // Requirements: 5.3
        const resumeCompleteGraphState = graphStateService.processCompleteEvent(get().graphState);

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
          graphState: resumeCompleteGraphState,
        });

        // Save to IndexedDB (Requirements: 3.3)
        // Fire and forget for non-interrupt saves - don't block the UI
        saveConversation(convId, finalMessages, convId, false, null, [], [], resumeCompleteGraphState);
        
        // Refresh conversation list
        get().loadConversations();
      }
    } catch (err) {
      if (err instanceof CheckpointExpiredError) {
        // Checkpoint expired - clear interrupt state but keep messages (resumeConversation)
        // Requirements: 6.4 - Save conversation with cleared interrupt state
        const currentGraphState = get().graphState;
        const currentMessages = get().messages;
        
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
        
        // Save cleared interrupt state using PersistenceService
        if (conversationId) {
          saveConversation(
            conversationId,
            currentMessages,
            null, // Clear threadId
            false, // is_interrupted = false
            null, // Clear pending_question
            [], // Clear pending_options
            [], // Clear pending_questions
            currentGraphState
          );
        }
      } else {
        const errorMessage = err instanceof Error ? err.message : 'Failed to resume conversation';
        set({ error: errorMessage, isLoading: false, currentStage: null, currentStageMessage: null });
      }
    }
  },

  // Submit multiple answers at once (for multi-question mode)
  // Requirements: 3.4 (Persian localization)
  submitMultipleAnswers: async (answers: string[], locale?: string, questionsHeader?: string) => {
    const defaultQuestionsHeader = questionsHeader || 'Please answer the following questions:';
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

    // Helper to save conversation using PersistenceService
    // Requirements: 1.4, 4.1, 6.1 - Centralized persistence with graph state
    const saveConversation = async (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[],
      pendingQs: QuestionWithOptions[] = [],
      currentGraphState: GraphState
    ): Promise<void> => {
      if (!isStorageAvailable || !convId) return;
      
      try {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        
        const saveRequest: SaveRequest = {
          conversationId: convId,
          messages: msgs,
          threadId: tId,
          isInterrupted,
          pendingQuestion: pendingQ,
          pendingOptions: pendingOpts,
          pendingQuestions: pendingQs,
          graphState: {
            completedStages: currentGraphState.completedStages,
            waitingNodeId: currentGraphState.waitingNodeId,
            stagesLiveData: currentGraphState.stagesLiveData as Record<string, Record<string, unknown>>,
          },
          existingCreatedAt: existing?.created_at,
        };
        
        await getPersistenceService().saveConversation(saveRequest);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Storage operation failed';
        console.error('Storage operation failed:', errorMessage);
        set({ storageError: errorMessage });
      }
    };

    try {
      // Use streaming resume to get stage indicators (submitMultipleAnswers)
      const result = await apiService.resumeConversationStream(
        threadId,
        answers,
        // Stage callback - update the stage indicator with live data
        // Requirements: 1.3, 5.1 - Use GraphStateService for atomic updates
        (stage, message, data) => {
          const currentGraphState = get().graphState;
          const newGraphState = graphStateService.processStageEvent(
            currentGraphState,
            stage as any,
            data
          );
          
          const currentLiveData = get().stagesLiveData;
          const existingStageData = currentLiveData[stage] || {};
          const updatedLiveData = data 
            ? { ...currentLiveData, [stage]: { ...existingStageData, ...data } }
            : currentLiveData;
          set({ 
            currentStage: stage, 
            currentStageMessage: message, 
            currentStageData: data || null,
            stagesLiveData: updatedLiveData,
            graphState: newGraphState,
          });
        },
        // Pass locale for Persian language support (Requirements: 3.4)
        locale
      );

      if (result.type === 'interrupt') {
        const convId = conversationId || result.conversation_id;

        // Process interrupt event using GraphStateService (submitMultipleAnswers)
        // Requirements: 1.4, 4.1, 4.2, 5.2
        const submitCurrentGraphState = get().graphState;
        const submitInterruptForGraphState = {
          ...result,
          thread_id: threadId,
        };
        const submitInterruptGraphState = graphStateService.processInterruptEvent(submitCurrentGraphState, submitInterruptForGraphState);

        // Handle multi-question format
        if (result.questions && result.questions.length > 0) {
          const questionsText = result.questions
            .map((q, i) => `${i + 1}. ${q.question}`)
            .join('\n\n');
          
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: `${defaultQuestionsHeader}\n\n${questionsText}`,
            timestamp: new Date().toISOString(),
            questions: result.questions,
            isQuestion: true,
          };
          const finalMessages = [...get().messages, questionMessage];
          
          // Save to IndexedDB with interrupt state BEFORE setting isWaitingForInput
          // Requirements: 6.1 - Await save completion for interrupt state
          await saveConversation(convId, finalMessages, threadId, true, null, [], result.questions, submitInterruptGraphState);

          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: null,
            pendingOptions: [],
            pendingQuestions: result.questions,
            isLoading: false,
            currentStage: null,
            currentStageMessage: null,
            graphState: submitInterruptGraphState,
          });
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
        
        // Save interrupt state to IndexedDB BEFORE setting isWaitingForInput
        // Requirements: 6.1 - Await save completion for interrupt state
        await saveConversation(convId, finalMessages, threadId, true, result.question || null, result.options || [], [], submitInterruptGraphState);

        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question || null,
          pendingOptions: result.options || [],
          pendingQuestions: [],
          isLoading: false,
          graphState: submitInterruptGraphState,
          currentStage: null,
          currentStageMessage: null,
        });
      } else {
        // Complete - add final response (submitMultipleAnswers)
        // Process complete event using GraphStateService
        // Requirements: 5.3
        const submitCompleteGraphState = graphStateService.processCompleteEvent(get().graphState);

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
          graphState: submitCompleteGraphState,
        });

        // Fire and forget for non-interrupt saves - don't block the UI
        saveConversation(convId, finalMessages, convId, false, null, [], [], submitCompleteGraphState);
        get().loadConversations();
      }
    } catch (err) {
      if (err instanceof CheckpointExpiredError) {
        // Checkpoint expired (submitMultipleAnswers)
        // Requirements: 6.4 - Save conversation with cleared interrupt state
        const currentGraphState = get().graphState;
        const currentMessages = get().messages;
        
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
        
        // Save cleared interrupt state using PersistenceService
        if (conversationId) {
          saveConversation(
            conversationId,
            currentMessages,
            null, // Clear threadId
            false, // is_interrupted = false
            null, // Clear pending_question
            [], // Clear pending_options
            [], // Clear pending_questions
            currentGraphState
          );
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
  // Requirements: 1.2, 3.4, 4.1, 4.4, 8.1, 8.2 - Restore graph state from storage or migrate
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

      // Restore or migrate graph state
      // Requirements: 4.2, 4.3, 4.4
      let restoredGraphState: GraphState;
      
      if (conversation.graph_state) {
        // Validate graph state from storage (Requirements: 4.4)
        const storedGraphState = conversation.graph_state;
        
        // Validate completed_stages is an array
        const completedStages = Array.isArray(storedGraphState.completed_stages)
          ? storedGraphState.completed_stages as GraphNodeId[]
          : [];
        
        // Validate waiting_node_id is a string or null
        const waitingNodeId = (typeof storedGraphState.waiting_node_id === 'string' || storedGraphState.waiting_node_id === null)
          ? storedGraphState.waiting_node_id as GraphNodeId | null
          : null;
        
        // Restore graph state from storage (Requirements: 4.2)
        restoredGraphState = {
          currentStage: null,
          completedStages,
          waitingNodeId,
          stagesLiveData: storedGraphState.stages_live_data as Partial<Record<GraphNodeId, Record<string, unknown>>> || {},
        };
      } else {
        // Apply migration for legacy conversations without graph_state (Requirements: 4.3)
        restoredGraphState = graphStateService.migrateConversationGraphState(
          messages,
          conversation.is_interrupted
        );
      }

      set({
        conversationId: conversation.id,
        messages,
        isLoading: false,
        isWaitingForInput: conversation.is_interrupted,
        pendingQuestion: conversation.pending_question || null,
        pendingOptions: conversation.pending_options || [],
        pendingQuestions: conversation.pending_questions || [],
        threadId: conversation.thread_id,
        // Restore graph state from storage or migration
        graphState: restoredGraphState,
        // Also update legacy stage-related state for backward compatibility
        stagesLiveData: restoredGraphState.stagesLiveData as Record<string, Record<string, unknown>>,
        currentStage: null,
        currentStageMessage: null,
        currentStageData: null,
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
  // Requirements: 3.1, 3.2, 3.5, 10.2 - Clear all accumulated live data and reset graph state
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
      // Reset stage-related state for graph visualization
      stagesLiveData: {},
      currentStage: null,
      currentStageMessage: null,
      currentStageData: null,
      // Reset graph state to initial values (Requirements: 3.5, 10.2)
      graphState: graphStateService.resetState(),
    });
  },

  // Delete a conversation from IndexedDB and server checkpoint
  // Requirements: 2.1, 2.2, 10.3
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
      
      // If we deleted the current conversation, clear it and reset graph state
      // Requirements: 10.3
      if (currentId === conversationId) {
        set({
          messages: [],
          conversationId: null,
          threadId: null,
          // Reset graph state when deleting active conversation (Requirements: 10.3)
          graphState: graphStateService.resetState(),
          stagesLiveData: {},
          currentStage: null,
          currentStageMessage: null,
          currentStageData: null,
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
      
      // Subscribe to PersistenceService events - Requirements: 5.4, 2.2, 2.4
      const persistenceService = getPersistenceService();
      
      // Update hasPendingSaves state when queue changes
      persistenceService.on('saveStarted', () => {
        set({ hasPendingSaves: persistenceService.hasPendingSaves() });
      });
      
      persistenceService.on('saveCompleted', () => {
        set({ hasPendingSaves: persistenceService.hasPendingSaves() });
      });
      
      // Handle save failures - Requirements: 2.2, 2.4
      persistenceService.on('saveFailed', ({ error, errorCode }) => {
        if (errorCode === 'QUOTA_EXCEEDED') {
          set({ storageError: 'Storage full. Please delete old conversations.' });
        } else {
          set({ storageError: `Failed to save: ${error}` });
        }
        set({ hasPendingSaves: persistenceService.hasPendingSaves() });
      });
      
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

  // Update graph state atomically
  // Requirements: 1.1, 1.2, 1.3
  updateGraphState: (updates: Partial<GraphState>) => {
    const currentGraphState = get().graphState;
    set({
      graphState: {
        ...currentGraphState,
        ...updates,
      },
    });
  },
}));
