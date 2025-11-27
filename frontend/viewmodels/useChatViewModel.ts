/**
 * Chat ViewModel - manages chat state and business logic.
 * MVVM Pattern: This is the ViewModel layer.
 */

import { create } from 'zustand';
import { Message, ConversationSummary } from '@/types';
import { apiService } from '@/services/api';

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

  // Send message action
  sendMessage: async (content: string, useStreaming: boolean = true) => {
    const { conversationId, messages } = get();

    // Validation
    if (!content.trim()) {
      set({ error: 'Message cannot be empty' });
      return;
    }

    // Clear any previous errors and waiting state
    set({ error: null, isLoading: true, isWaitingForInput: false, pendingOptions: [] });

    // Create temporary user message for immediate UI feedback
    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    set({ messages: [...messages, tempUserMessage] });

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

          set({
            messages: [...messagesWithoutPlaceholder, questionMessage],
            isWaitingForInput: true,
            pendingQuestion: result.question,
            pendingOptions: result.options,
            threadId: result.threadId,
            conversationId: result.conversationId || conversationId,
            isStreaming: false,
            isLoading: false,
          });
          return;
        }

        set({ isStreaming: false, currentStreamingMessage: '' });

        // Update conversation_id from backend response
        if (result.conversationId) {
          set({ conversationId: result.conversationId });
        }
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
  selectOption: async (option: string) => {
    const { threadId, messages } = get();

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
    set({ messages: [...updatedMessages, userMessage] });

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
        set({
          messages: [...get().messages, questionMessage],
          isWaitingForInput: true,
          pendingQuestion: result.question,
          pendingOptions: result.options || [],
          isLoading: false,
        });
      } else {
        // Complete - add final response
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          timestamp: new Date().toISOString(),
        };
        set({
          messages: [...get().messages, assistantMessage],
          isLoading: false,
          threadId: null,
          pendingQuestion: null,
          pendingOptions: [],
        });
        // Refresh conversation list
        get().loadConversations();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to resume conversation';
      set({ error: errorMessage, isLoading: false });
    }
  },

  // Resume conversation action (for free-text input during interrupts)
  resumeConversation: async (userInput: string) => {
    const { threadId, messages } = get();

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
    set({ messages: [...updatedMessages, userMessage] });

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
        set({
          messages: [...get().messages, questionMessage],
          isWaitingForInput: true,
          pendingQuestion: result.question,
          pendingOptions: result.options || [],
          isLoading: false,
        });
      } else {
        // Complete - add final response
        const assistantMessage: Message = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: result.content,
          timestamp: new Date().toISOString(),
        };
        set({
          messages: [...get().messages, assistantMessage],
          isLoading: false,
          threadId: null,
          pendingQuestion: null,
          pendingOptions: [],
        });
        // Refresh conversation list
        get().loadConversations();
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to resume conversation';
      set({ error: errorMessage, isLoading: false });
    }
  },

  // Clear conversation action
  clearConversation: () => {
    const { conversationId } = get();

    // Optionally delete from backend
    if (conversationId) {
      apiService.deleteConversation(conversationId).catch(console.error);
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

  // Load all conversations
  loadConversations: async () => {
    set({ isLoadingConversations: true });
    try {
      const response = await apiService.listConversations();
      set({ conversations: response.conversations, isLoadingConversations: false });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load conversations';
      set({ error: errorMessage, isLoadingConversations: false });
    }
  },

  // Select and load a conversation
  selectConversation: async (conversationId: string) => {
    set({ isLoading: true, error: null });
    try {
      const conversation = await apiService.getConversation(conversationId);
      set({
        conversationId: conversation.id,
        messages: conversation.messages.map((msg) => ({
          ...msg,
          id: msg.id.toString(),
        })),
        isLoading: false,
        isWaitingForInput: false,
        pendingQuestion: null,
        pendingOptions: [],
        threadId: conversationId, // Use conversation ID as thread ID
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load conversation';
      set({ error: errorMessage, isLoading: false });
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
    });
  },

  // Delete a conversation
  deleteConversation: async (conversationId: string) => {
    try {
      await apiService.deleteConversation(conversationId);
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
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete conversation';
      set({ error: errorMessage });
    }
  },
}));
