/**
 * Chat ViewModel - manages chat state and business logic.
 * MVVM Pattern: This is the ViewModel layer.
 * 
 * Updated to use client-side IndexedDB storage for conversations.
 * Requirements: 1.2, 1.4
 */

import { create } from 'zustand';
import { Message, ConversationSummary, CheckpointExpiredError } from '@/types';
import { apiService } from '@/services/api';
import {
  getStorageService,
  initializeStorage,
  isStorageSupported,
  StorageError,
  StoredConversation,
  StoredMessage,
} from '@/services/storage';

interface ChatState {
  // State
  messages: Message[];
  conversationId: string | null;
  isLoading: boolean;
  error: string | null;
  isStreaming: boolean;
  currentStreamingMessage: string;

  // Conversation list state
  conversations: ConversationSummary[];
  isLoadingConversations: boolean;

  // Interrupt state (for LangGraph clarifications)
  isWaitingForInput: boolean;
  pendingQuestion: string | null;
  pendingOptions: string[];
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
  };
}

export const useChatViewModel = create<ChatState>((set, get) => ({
  // Initial state
  messages: [],
  conversationId: null,
  isLoading: false,
  error: null,
  isStreaming: false,
  currentStreamingMessage: '',

  // Conversation list state
  conversations: [],
  isLoadingConversations: false,

  // Interrupt state
  isWaitingForInput: false,
  pendingQuestion: null,
  pendingOptions: [],
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
    set({ error: null, isLoading: true, isWaitingForInput: false, pendingOptions: [] });

    // Create user message with proper ID
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    const messagesWithUser = [...messages, userMessage];
    set({ messages: messagesWithUser });

    // Helper to save conversation to IndexedDB
    const saveToStorage = async (
      convId: string,
      msgs: Message[],
      threadId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[]
    ) => {
      if (!isStorageAvailable) return;
      
      try {
        const storageService = getStorageService();
        // Try to get existing conversation to preserve created_at
        const existing = await storageService.getConversation(convId);
        const storedConv = buildStoredConversation(
          convId,
          msgs,
          threadId,
          isInterrupted,
          pendingQ,
          pendingOpts,
          existing?.created_at
        );
        await storageService.saveConversation(storedConv);
      } catch (err) {
        if (err instanceof StorageError) {
          set({ storageError: err.message });
        } else {
          console.error('Failed to save conversation to storage:', err);
        }
      }
    };

    try {
      if (useStreaming) {
        // Streaming mode
        set({ isStreaming: true, currentStreamingMessage: '' });

        // Add placeholder for assistant message
        const tempAssistantMessage: Message = {
          id: `temp-assistant-${Date.now()}`,
          role: 'assistant',
          content: '',
          timestamp: new Date().toISOString(),
        };
        set({ messages: [...get().messages, tempAssistantMessage] });

        let fullResponse = '';

        const result = await apiService.sendMessageStream(
          {
            conversation_id: conversationId || undefined,
            message: content.trim(),
          },
          (chunk) => {
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
          }
        );

        // Check if we got an interrupt
        if (result.type === 'interrupt') {
          // Remove the placeholder assistant message
          const currentMessages = get().messages;
          const messagesWithoutPlaceholder = currentMessages.slice(0, -1);

          // Add the question as an assistant message with options
          const questionMessage: Message = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: result.question,
            timestamp: new Date().toISOString(),
            options: result.options,
            isQuestion: true,
          };

          const finalMessages = [...messagesWithoutPlaceholder, questionMessage];
          const finalConvId = result.conversationId || conversationId || `conv-${Date.now()}`;

          set({
            messages: finalMessages,
            isWaitingForInput: true,
            pendingQuestion: result.question,
            pendingOptions: result.options,
            threadId: result.threadId,
            conversationId: finalConvId,
            isStreaming: false,
            isLoading: false,
          });

          // Save to IndexedDB with interrupt state (Requirements: 1.3, 3.2)
          await saveToStorage(
            finalConvId,
            finalMessages,
            result.threadId,
            true,
            result.question,
            result.options
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
        await saveToStorage(finalConvId, finalMessages, finalConvId, false, null, []);
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
        await saveToStorage(
          response.conversation_id,
          updatedMessages,
          response.conversation_id,
          false,
          null,
          []
        );
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      set({ error: errorMessage });

      // Remove temporary messages on error
      set({ messages: messages.filter((m) => !m.id.startsWith('temp-')) });
    } finally {
      set({ isLoading: false, isStreaming: false });
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

    set({ isLoading: true, error: null, isWaitingForInput: false, pendingOptions: [] });

    // Mark the question message as no longer waiting
    const updatedMessages = messages.map((msg) =>
      msg.isQuestion ? { ...msg, isQuestion: false, options: undefined } : msg
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

    // Helper to save conversation to IndexedDB
    const saveToStorage = async (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[]
    ) => {
      if (!isStorageAvailable || !convId) return;
      
      try {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        const storedConv = buildStoredConversation(
          convId,
          msgs,
          tId,
          isInterrupted,
          pendingQ,
          pendingOpts,
          existing?.created_at
        );
        await storageService.saveConversation(storedConv);
      } catch (err) {
        if (err instanceof StorageError) {
          set({ storageError: err.message });
        } else {
          console.error('Failed to save conversation to storage:', err);
        }
      }
    };

    try {
      const result = await apiService.resumeConversation(threadId, option);

      if (result.type === 'interrupt') {
        // Another interrupt - add new question message with options
        const questionMessage: Message = {
          id: `question-${Date.now()}`,
          role: 'assistant',
          content: result.question,
          timestamp: new Date().toISOString(),
          options: result.options,
          isQuestion: true,
        };
        const finalMessages = [...get().messages, questionMessage];
        const convId = conversationId || result.conversation_id;
        
        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question,
          pendingOptions: result.options || [],
          isLoading: false,
        });

        // Save interrupt state to IndexedDB (Requirements: 3.3, 4.1)
        await saveToStorage(
          convId,
          finalMessages,
          threadId,
          true,
          result.question,
          result.options || []
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
        });

        // Save to IndexedDB (Requirements: 3.3)
        await saveToStorage(convId, finalMessages, convId, false, null, []);
        
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
        set({ error: errorMessage, isLoading: false });
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

    set({ isLoading: true, error: null, isWaitingForInput: false, pendingOptions: [] });

    // Mark the question message as no longer waiting
    const updatedMessages = messages.map((msg) =>
      msg.isQuestion ? { ...msg, isQuestion: false, options: undefined } : msg
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

    // Helper to save conversation to IndexedDB
    const saveToStorage = async (
      convId: string,
      msgs: Message[],
      tId: string | null,
      isInterrupted: boolean,
      pendingQ: string | null,
      pendingOpts: string[]
    ) => {
      if (!isStorageAvailable || !convId) return;
      
      try {
        const storageService = getStorageService();
        const existing = await storageService.getConversation(convId);
        const storedConv = buildStoredConversation(
          convId,
          msgs,
          tId,
          isInterrupted,
          pendingQ,
          pendingOpts,
          existing?.created_at
        );
        await storageService.saveConversation(storedConv);
      } catch (err) {
        if (err instanceof StorageError) {
          set({ storageError: err.message });
        } else {
          console.error('Failed to save conversation to storage:', err);
        }
      }
    };

    try {
      const result = await apiService.resumeConversation(threadId, userInput);

      if (result.type === 'interrupt') {
        // Another interrupt - add new question message with options
        const questionMessage: Message = {
          id: `question-${Date.now()}`,
          role: 'assistant',
          content: result.question,
          timestamp: new Date().toISOString(),
          options: result.options,
          isQuestion: true,
        };
        const finalMessages = [...get().messages, questionMessage];
        const convId = conversationId || result.conversation_id;
        
        set({
          messages: finalMessages,
          isWaitingForInput: true,
          pendingQuestion: result.question,
          pendingOptions: result.options || [],
          isLoading: false,
        });

        // Save interrupt state to IndexedDB (Requirements: 3.3, 4.1)
        await saveToStorage(
          convId,
          finalMessages,
          threadId,
          true,
          result.question,
          result.options || []
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
        });

        // Save to IndexedDB (Requirements: 3.3)
        await saveToStorage(convId, finalMessages, convId, false, null, []);
        
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
        set({ error: errorMessage, isLoading: false });
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
    // Check storage support on client side only
    const storageSupported = isStorageSupported();
    if (!storageSupported) {
      set({
        isStorageAvailable: false,
        storageError: 'Browser storage is not available. Your conversations will not be saved.',
      });
      return;
    }

    try {
      await initializeStorage();
      set({ isStorageAvailable: true, storageError: null });
      
      // Load conversations after initialization
      await get().loadConversations();
      
      // Check for interrupted conversations and restore state (Requirements: 4.1)
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
          threadId: interruptedConv.thread_id,
        });
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
