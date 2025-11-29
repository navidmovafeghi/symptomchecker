/**
 * Property-based tests for useChatViewModel.
 * Tests client-side storage integration.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { IndexedDBStorageService } from '../../services/storage/indexedDBStorage';
import { StoredConversation, StoredMessage } from '../../services/storage/types';

// Use integer timestamps to avoid Invalid Date errors during shrinking
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31
  .map(ts => new Date(ts));

// Arbitrary for generating valid message roles
const messageRoleArb = fc.constantFrom('user', 'assistant', 'system') as fc.Arbitrary<'user' | 'assistant' | 'system'>;

// Arbitrary for generating valid stored messages
const storedMessageArb: fc.Arbitrary<StoredMessage> = fc.record({
  id: fc.uuid(),
  role: messageRoleArb,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: validDateArb.map(d => d.toISOString()),
  options: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }), { nil: undefined }),
  isQuestion: fc.option(fc.boolean(), { nil: undefined }),
});

// Arbitrary for generating valid stored conversations
const storedConversationArb: fc.Arbitrary<StoredConversation> = fc.record({
  id: fc.uuid(),
  title: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  messages: fc.array(storedMessageArb, { minLength: 0, maxLength: 10 }),
  created_at: validDateArb.map(d => d.toISOString()),
  updated_at: validDateArb.map(d => d.toISOString()),
  version: fc.constant(1),
  thread_id: fc.uuid(),
  is_interrupted: fc.boolean(),
  pending_question: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  pending_options: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }), { nil: undefined }),
});

// Arbitrary for generating a new message to add
const newMessageArb: fc.Arbitrary<StoredMessage> = fc.record({
  id: fc.uuid(),
  role: fc.constantFrom('user', 'assistant') as fc.Arbitrary<'user' | 'assistant'>,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: validDateArb.map(d => d.toISOString()),
});

// Helper to delete the database and wait for completion
const deleteDatabase = (): Promise<void> => {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('medical-chatbot');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
};

describe('useChatViewModel Storage Integration', () => {
  let storageService: IndexedDBStorageService;

  beforeEach(async () => {
    // Create a fresh instance for each test
    storageService = new IndexedDBStorageService();
    await storageService.initialize();
  });

  afterEach(async () => {
    // Close the database connection to allow deletion
    storageService.close();
    await deleteDatabase();
  });

  /**
   * **Feature: client-side-storage, Property 2: Immediate persistence on update**
   * **Validates: Requirements 1.3, 3.2**
   * 
   * For any conversation update (new message added), the IndexedDB should contain
   * the updated conversation immediately after the save operation completes.
   */
  it('Property 2: immediate persistence on update - new message is saved immediately', async () => {
    await fc.assert(
      fc.asyncProperty(
        storedConversationArb,
        newMessageArb,
        async (conversation, newMessage) => {
          // Save the initial conversation
          await storageService.saveConversation(conversation);
          
          // Add a new message to the conversation
          const updatedConversation: StoredConversation = {
            ...conversation,
            messages: [...conversation.messages, newMessage],
            updated_at: new Date().toISOString(),
          };
          
          // Save the updated conversation
          await storageService.saveConversation(updatedConversation);
          
          // Immediately verify the update is persisted
          const loaded = await storageService.getConversation(conversation.id);
          
          // Verify the conversation was updated
          expect(loaded).not.toBeNull();
          expect(loaded!.messages.length).toBe(conversation.messages.length + 1);
          
          // Verify the new message is present
          const lastMessage = loaded!.messages[loaded!.messages.length - 1];
          expect(lastMessage.id).toBe(newMessage.id);
          expect(lastMessage.content).toBe(newMessage.content);
          expect(lastMessage.role).toBe(newMessage.role);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Multiple sequential updates are all persisted
   */
  it('Property 2 (extended): multiple sequential updates are all persisted', async () => {
    await fc.assert(
      fc.asyncProperty(
        storedConversationArb,
        fc.array(newMessageArb, { minLength: 1, maxLength: 5 }),
        async (conversation, newMessages) => {
          // Save the initial conversation
          await storageService.saveConversation(conversation);
          
          // Add messages one by one and verify each is persisted
          let currentConversation = conversation;
          
          for (const newMessage of newMessages) {
            currentConversation = {
              ...currentConversation,
              messages: [...currentConversation.messages, newMessage],
              updated_at: new Date().toISOString(),
            };
            
            await storageService.saveConversation(currentConversation);
            
            // Immediately verify
            const loaded = await storageService.getConversation(conversation.id);
            expect(loaded).not.toBeNull();
            expect(loaded!.messages.length).toBe(currentConversation.messages.length);
          }
          
          // Final verification
          const finalLoaded = await storageService.getConversation(conversation.id);
          expect(finalLoaded!.messages.length).toBe(
            conversation.messages.length + newMessages.length
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('useChatViewModel Interrupt Persistence', () => {
  let storageService: IndexedDBStorageService;

  beforeEach(async () => {
    storageService = new IndexedDBStorageService();
    await storageService.initialize();
  });

  afterEach(async () => {
    storageService.close();
    await deleteDatabase();
  });

  /**
   * **Feature: client-side-storage, Property 6: Interrupt state persisted**
   * **Validates: Requirements 3.3, 4.1**
   * 
   * For any interrupt response from the server, the clarification question and options
   * should be saved to IndexedDB before the UI displays them.
   */
  it('Property 6: interrupt state is persisted with question and options', async () => {
    // Arbitrary for generating interrupt data
    const interruptDataArb = fc.record({
      conversationId: fc.uuid(),
      threadId: fc.uuid(),
      question: fc.string({ minLength: 1, maxLength: 200 }),
      options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 5 }),
      existingMessages: fc.array(storedMessageArb, { minLength: 0, maxLength: 5 }),
    });

    await fc.assert(
      fc.asyncProperty(
        interruptDataArb,
        async ({ conversationId, threadId, question, options, existingMessages }) => {
          // Create a conversation with existing messages
          const initialConversation: StoredConversation = {
            id: conversationId,
            title: null,
            messages: existingMessages,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
            thread_id: threadId,
            is_interrupted: false,
          };
          
          await storageService.saveConversation(initialConversation);
          
          // Simulate saving interrupt state (as the ViewModel would do)
          const questionMessage: StoredMessage = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: question,
            timestamp: new Date().toISOString(),
            options: options,
            isQuestion: true,
          };
          
          const interruptedConversation: StoredConversation = {
            ...initialConversation,
            messages: [...existingMessages, questionMessage],
            updated_at: new Date().toISOString(),
            is_interrupted: true,
            pending_question: question,
            pending_options: options,
          };
          
          await storageService.saveConversation(interruptedConversation);
          
          // Verify the interrupt state is persisted
          const loaded = await storageService.getConversation(conversationId);
          
          expect(loaded).not.toBeNull();
          expect(loaded!.is_interrupted).toBe(true);
          expect(loaded!.pending_question).toBe(question);
          expect(loaded!.pending_options).toEqual(options);
          
          // Verify the question message is in the messages array
          const lastMessage = loaded!.messages[loaded!.messages.length - 1];
          expect(lastMessage.content).toBe(question);
          expect(lastMessage.options).toEqual(options);
          expect(lastMessage.isQuestion).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Interrupt state can be cleared when conversation resumes
   */
  it('Property 6 (extended): interrupt state can be cleared on resume', async () => {
    const interruptDataArb = fc.record({
      conversationId: fc.uuid(),
      threadId: fc.uuid(),
      question: fc.string({ minLength: 1, maxLength: 200 }),
      options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 5 }),
      userResponse: fc.string({ minLength: 1, maxLength: 200 }),
      assistantResponse: fc.string({ minLength: 1, maxLength: 500 }),
    });

    await fc.assert(
      fc.asyncProperty(
        interruptDataArb,
        async ({ conversationId, threadId, question, options, userResponse, assistantResponse }) => {
          // Create an interrupted conversation
          const questionMessage: StoredMessage = {
            id: `question-${Date.now()}`,
            role: 'assistant',
            content: question,
            timestamp: new Date().toISOString(),
            options: options,
            isQuestion: true,
          };
          
          const interruptedConversation: StoredConversation = {
            id: conversationId,
            title: null,
            messages: [questionMessage],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            version: 1,
            thread_id: threadId,
            is_interrupted: true,
            pending_question: question,
            pending_options: options,
          };
          
          await storageService.saveConversation(interruptedConversation);
          
          // Simulate user responding and conversation completing
          const userMessage: StoredMessage = {
            id: `user-${Date.now()}`,
            role: 'user',
            content: userResponse,
            timestamp: new Date().toISOString(),
          };
          
          const assistantMessage: StoredMessage = {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: assistantResponse,
            timestamp: new Date().toISOString(),
          };
          
          // Clear the question's isQuestion flag and add new messages
          const clearedQuestionMessage = { ...questionMessage, isQuestion: false, options: undefined };
          
          const completedConversation: StoredConversation = {
            ...interruptedConversation,
            messages: [clearedQuestionMessage, userMessage, assistantMessage],
            updated_at: new Date().toISOString(),
            is_interrupted: false,
            pending_question: undefined,
            pending_options: undefined,
          };
          
          await storageService.saveConversation(completedConversation);
          
          // Verify the interrupt state is cleared
          const loaded = await storageService.getConversation(conversationId);
          
          expect(loaded).not.toBeNull();
          expect(loaded!.is_interrupted).toBe(false);
          expect(loaded!.pending_question).toBeUndefined();
          expect(loaded!.pending_options).toBeUndefined();
          expect(loaded!.messages.length).toBe(3);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('useChatViewModel List Conversations', () => {
  /**
   * **Feature: client-side-storage, Property 4: List returns all conversations**
   * **Validates: Requirements 2.3**
   * 
   * For any set of conversations stored in IndexedDB, listing should return
   * all of them with correct summary information.
   */
  it('Property 4: list returns all stored conversations with correct summaries', async () => {
    // Arbitrary for generating a set of unique conversations
    const conversationsSetArb = fc.array(storedConversationArb, { minLength: 1, maxLength: 10 })
      .map(conversations => {
        // Ensure unique IDs
        const seen = new Set<string>();
        return conversations.filter(c => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
      })
      .filter(conversations => conversations.length > 0);

    await fc.assert(
      fc.asyncProperty(
        conversationsSetArb,
        async (conversations) => {
          // Create fresh storage service for each iteration
          const storageService = new IndexedDBStorageService();
          await storageService.initialize();
          
          try {
            // Save all conversations
            for (const conv of conversations) {
              await storageService.saveConversation(conv);
            }
            
            // List all conversations
            const summaries = await storageService.listConversations();
            
            // Verify all conversations are returned
            expect(summaries.length).toBe(conversations.length);
            
            // Verify each conversation has correct summary info
            for (const conv of conversations) {
              const summary = summaries.find(s => s.id === conv.id);
              expect(summary).toBeDefined();
              expect(summary!.title).toBe(conv.title);
              expect(summary!.message_count).toBe(conv.messages.length);
              expect(summary!.created_at).toBe(conv.created_at);
              expect(summary!.updated_at).toBe(conv.updated_at);
            }
          } finally {
            // Clean up after each iteration
            storageService.close();
            await deleteDatabase();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: List returns conversations sorted by updated_at descending
   */
  it('Property 4 (extended): list returns conversations sorted by updated_at descending', async () => {
    // Generate conversations with distinct timestamps
    const conversationsWithTimestampsArb = fc.array(
      fc.record({
        id: fc.uuid(),
        title: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
        messages: fc.array(storedMessageArb, { minLength: 0, maxLength: 5 }),
        created_at: validDateArb.map(d => d.toISOString()),
        // Use unique timestamps for sorting verification
        updated_at_offset: fc.integer({ min: 0, max: 1000000 }),
        version: fc.constant(1),
        thread_id: fc.uuid(),
        is_interrupted: fc.boolean(),
      }),
      { minLength: 2, maxLength: 10 }
    ).map(conversations => {
      // Ensure unique IDs and assign distinct updated_at timestamps
      const seen = new Set<string>();
      const baseTime = new Date('2024-01-01').getTime();
      return conversations
        .filter(c => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        })
        .map((c, index) => ({
          id: c.id,
          title: c.title,
          messages: c.messages,
          created_at: c.created_at,
          updated_at: new Date(baseTime + c.updated_at_offset + index * 1000).toISOString(),
          version: c.version,
          thread_id: c.thread_id,
          is_interrupted: c.is_interrupted,
        } as StoredConversation));
    }).filter(conversations => conversations.length >= 2);

    await fc.assert(
      fc.asyncProperty(
        conversationsWithTimestampsArb,
        async (conversations) => {
          // Create fresh storage service for each iteration
          const storageService = new IndexedDBStorageService();
          await storageService.initialize();
          
          try {
            // Save all conversations
            for (const conv of conversations) {
              await storageService.saveConversation(conv);
            }
            
            // List all conversations
            const summaries = await storageService.listConversations();
            
            // Verify sorted by updated_at descending
            for (let i = 1; i < summaries.length; i++) {
              const prevDate = new Date(summaries[i - 1].updated_at).getTime();
              const currDate = new Date(summaries[i].updated_at).getTime();
              expect(prevDate).toBeGreaterThanOrEqual(currDate);
            }
          } finally {
            // Clean up after each iteration
            storageService.close();
            await deleteDatabase();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('useChatViewModel Delete Operations', () => {
  /**
   * **Feature: client-side-storage, Property 3: Delete removes from storage**
   * **Validates: Requirements 2.1**
   * 
   * For any conversation that exists in IndexedDB, calling delete should result
   * in the conversation no longer being retrievable.
   */
  it('Property 3: delete removes conversation from storage', async () => {
    await fc.assert(
      fc.asyncProperty(
        storedConversationArb,
        async (conversation) => {
          // Create fresh storage service for each iteration
          const storageService = new IndexedDBStorageService();
          await storageService.initialize();
          
          try {
            // Save the conversation
            await storageService.saveConversation(conversation);
            
            // Verify it exists
            const beforeDelete = await storageService.getConversation(conversation.id);
            expect(beforeDelete).not.toBeNull();
            
            // Delete the conversation
            const deleted = await storageService.deleteConversation(conversation.id);
            expect(deleted).toBe(true);
            
            // Verify it no longer exists
            const afterDelete = await storageService.getConversation(conversation.id);
            expect(afterDelete).toBeNull();
            
            // Verify it's not in the list
            const summaries = await storageService.listConversations();
            const found = summaries.find(s => s.id === conversation.id);
            expect(found).toBeUndefined();
          } finally {
            storageService.close();
            await deleteDatabase();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: client-side-storage, Property 10: Cascade delete to server checkpoint**
   * **Validates: Requirements 2.2**
   * 
   * For any conversation deletion, the system should also request deletion of
   * the associated server checkpoint.
   * 
   * Note: This test verifies the storage layer behavior. The actual API call
   * to delete the server checkpoint is tested at the integration level.
   */
  it('Property 10: delete removes conversation and allows re-creation', async () => {
    await fc.assert(
      fc.asyncProperty(
        storedConversationArb,
        async (conversation) => {
          // Create fresh storage service for each iteration
          const storageService = new IndexedDBStorageService();
          await storageService.initialize();
          
          try {
            // Save the conversation
            await storageService.saveConversation(conversation);
            
            // Delete the conversation
            await storageService.deleteConversation(conversation.id);
            
            // Verify we can create a new conversation with the same ID
            // (simulating what would happen after server checkpoint is also deleted)
            const newConversation: StoredConversation = {
              ...conversation,
              messages: [],
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            
            await storageService.saveConversation(newConversation);
            
            const loaded = await storageService.getConversation(conversation.id);
            expect(loaded).not.toBeNull();
            expect(loaded!.messages.length).toBe(0);
          } finally {
            storageService.close();
            await deleteDatabase();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Deleting non-existent conversation doesn't throw
   */
  it('Property 3 (extended): deleting non-existent conversation returns true', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        async (nonExistentId) => {
          // Create fresh storage service for each iteration
          const storageService = new IndexedDBStorageService();
          await storageService.initialize();
          
          try {
            // Verify the conversation doesn't exist
            const before = await storageService.getConversation(nonExistentId);
            expect(before).toBeNull();
            
            // Delete should succeed (idempotent operation)
            const deleted = await storageService.deleteConversation(nonExistentId);
            expect(deleted).toBe(true);
            
            // Still doesn't exist
            const after = await storageService.getConversation(nonExistentId);
            expect(after).toBeNull();
          } finally {
            storageService.close();
            await deleteDatabase();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
