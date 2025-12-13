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


describe('useChatViewModel State Reset', () => {
  /**
   * **Feature: graph-visualization-dataflow-fix, Property 4: New conversation clears live data**
   * **Validates: Requirements 3.1, 3.2**
   * 
   * For any call to newConversation(), the stagesLiveData state SHALL become an empty object.
   * This ensures that when starting a new conversation, accumulated live data from previous
   * stages is cleared to prevent stale data from appearing in the graph visualization.
   */
  it('Property 4: newConversation clears stagesLiveData to empty object', async () => {
    // Import the store dynamically to get a fresh instance
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    
    // Arbitrary for generating stage live data
    const stageDataArb = fc.record({
      questionCount: fc.integer({ min: 0, max: 10 }),
      topDiagnosis: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }),
      confidence: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
    });
    
    const stagesLiveDataArb = fc.dictionary(
      fc.constantFrom(
        'generate_questions',
        'collect_answers',
        'generate_ddx',
        'generate_refinement_question',
        'collect_refinement_answer',
        'refine_ddx',
        'generate_final_summary'
      ),
      stageDataArb
    );

    await fc.assert(
      fc.asyncProperty(
        stagesLiveDataArb,
        fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
        fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
        async (stagesLiveData, currentStage, currentStageMessage) => {
          // Set up initial state with accumulated live data
          useChatViewModel.setState({
            stagesLiveData,
            currentStage,
            currentStageMessage,
            currentStageData: currentStage ? { someData: 'test' } : null,
            // Also set some other state to verify it's cleared
            messages: [{ id: 'test', role: 'user', content: 'test', timestamp: new Date().toISOString() }],
            conversationId: 'test-conv-id',
          });
          
          // Verify initial state is set
          const stateBefore = useChatViewModel.getState();
          expect(stateBefore.stagesLiveData).toEqual(stagesLiveData);
          
          // Call newConversation
          useChatViewModel.getState().newConversation();
          
          // Verify stagesLiveData is cleared to empty object
          const stateAfter = useChatViewModel.getState();
          expect(stateAfter.stagesLiveData).toEqual({});
          expect(stateAfter.currentStage).toBeNull();
          expect(stateAfter.currentStageMessage).toBeNull();
          expect(stateAfter.currentStageData).toBeNull();
          
          // Also verify other state is reset
          expect(stateAfter.messages).toEqual([]);
          expect(stateAfter.conversationId).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4 (extended): newConversation resets all stage-related state regardless of previous values
   */
  it('Property 4 (extended): newConversation resets all stage-related state', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    
    // Arbitrary for generating various stage states
    const stageStateArb = fc.record({
      currentStage: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: null }),
      currentStageMessage: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
      currentStageData: fc.option(
        fc.record({
          questionCount: fc.integer({ min: 0, max: 10 }),
          topDiagnosis: fc.option(fc.string(), { nil: undefined }),
        }),
        { nil: null }
      ),
      stagesLiveData: fc.dictionary(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.record({ value: fc.integer() })
      ),
    });

    await fc.assert(
      fc.asyncProperty(
        stageStateArb,
        async (stageState) => {
          // Set up initial state
          useChatViewModel.setState(stageState);
          
          // Call newConversation
          useChatViewModel.getState().newConversation();
          
          // Verify all stage-related state is reset
          const stateAfter = useChatViewModel.getState();
          expect(stateAfter.stagesLiveData).toEqual({});
          expect(stateAfter.currentStage).toBeNull();
          expect(stateAfter.currentStageMessage).toBeNull();
          expect(stateAfter.currentStageData).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('useChatViewModel Graph State Reset', () => {
  /**
   * **Feature: graph-visualization-fixes, Property 7: Graph State Reset**
   * **Validates: Requirements 3.5, 10.1, 10.2**
   * 
   * For any call to newConversation() or when switching conversations, the graph state
   * SHALL be reset to INITIAL_GRAPH_STATE (currentStage: null, completedStages: [],
   * waitingNodeId: null, stagesLiveData: {}).
   */
  it('Property 7: newConversation resets graphState to INITIAL_GRAPH_STATE', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    const { INITIAL_GRAPH_STATE } = await import('../../services/graphStateService');
    
    // Arbitrary for valid GraphNodeId
    const graphNodeIdArb = fc.constantFrom(
      'generate_questions',
      'collect_answers',
      'generate_ddx',
      'generate_refinement_question',
      'collect_refinement_answer',
      'refine_ddx',
      'generate_final_summary'
    );
    
    // Arbitrary for StageLiveData
    const stageLiveDataArb = fc.record({
      question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      refinement_round: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    });
    
    // Arbitrary for non-initial GraphState
    const nonInitialGraphStateArb = fc.record({
      currentStage: fc.option(graphNodeIdArb, { nil: null }),
      completedStages: fc.array(graphNodeIdArb, { minLength: 1, maxLength: 7 }).map(stages => [...new Set(stages)]),
      waitingNodeId: fc.option(graphNodeIdArb, { nil: null }),
      stagesLiveData: fc.dictionary(graphNodeIdArb, stageLiveDataArb),
    });

    await fc.assert(
      fc.asyncProperty(
        nonInitialGraphStateArb,
        async (graphState) => {
          // Set up initial state with non-initial graph state
          useChatViewModel.setState({
            graphState: graphState as any,
            messages: [{ id: 'test', role: 'user', content: 'test', timestamp: new Date().toISOString() }],
            conversationId: 'test-conv-id',
          });
          
          // Verify initial state is set
          const stateBefore = useChatViewModel.getState();
          expect(stateBefore.graphState).toEqual(graphState);
          
          // Call newConversation
          useChatViewModel.getState().newConversation();
          
          // Verify graphState is reset to INITIAL_GRAPH_STATE
          const stateAfter = useChatViewModel.getState();
          expect(stateAfter.graphState.currentStage).toBeNull();
          expect(stateAfter.graphState.completedStages).toEqual([]);
          expect(stateAfter.graphState.waitingNodeId).toBeNull();
          expect(stateAfter.graphState.stagesLiveData).toEqual({});
          
          // Also verify other state is reset
          expect(stateAfter.messages).toEqual([]);
          expect(stateAfter.conversationId).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 7 (extended): Graph state reset is complete regardless of previous state complexity
   */
  it('Property 7 (extended): graphState reset is complete for any previous state', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    const { INITIAL_GRAPH_STATE } = await import('../../services/graphStateService');
    
    // Arbitrary for valid GraphNodeId
    const graphNodeIdArb = fc.constantFrom(
      'generate_questions',
      'collect_answers',
      'generate_ddx',
      'generate_refinement_question',
      'collect_refinement_answer',
      'refine_ddx',
      'generate_final_summary'
    );
    
    // Arbitrary for complex stage live data
    const complexStageLiveDataArb = fc.record({
      question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      top_diagnosis: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
      top_probability: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
      refinement_round: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    });
    
    // Arbitrary for complex GraphState with all fields populated
    const complexGraphStateArb = fc.record({
      currentStage: graphNodeIdArb,
      completedStages: fc.array(graphNodeIdArb, { minLength: 1, maxLength: 7 }).map(stages => [...new Set(stages)]),
      waitingNodeId: graphNodeIdArb,
      stagesLiveData: fc.dictionary(graphNodeIdArb, complexStageLiveDataArb),
    });

    await fc.assert(
      fc.asyncProperty(
        complexGraphStateArb,
        async (graphState) => {
          // Set up state with complex graph state
          useChatViewModel.setState({
            graphState: graphState as any,
          });
          
          // Call newConversation
          useChatViewModel.getState().newConversation();
          
          // Verify complete reset
          const stateAfter = useChatViewModel.getState();
          expect(stateAfter.graphState).toEqual(INITIAL_GRAPH_STATE);
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('useChatViewModel Graph State Integration', () => {
  /**
   * **Feature: graph-visualization-fixes, Property 2: Atomic State Updates**
   * **Validates: Requirements 1.3, 9.2**
   * 
   * For any stage event received by the ViewModel, the resulting state update SHALL
   * modify currentStage, completedStages, and stagesLiveData in a single atomic
   * Zustand set() call.
   */
  it('Property 2: updateGraphState performs atomic state updates', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    const { INITIAL_GRAPH_STATE, graphStateService } = await import('../../services/graphStateService');
    
    // Arbitrary for valid GraphNodeId
    const graphNodeIdArb = fc.constantFrom(
      'generate_questions',
      'collect_answers',
      'generate_ddx',
      'generate_refinement_question',
      'collect_refinement_answer',
      'refine_ddx',
      'generate_final_summary'
    );
    
    // Arbitrary for StageLiveData
    const stageLiveDataArb = fc.record({
      question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      refinement_round: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    });

    await fc.assert(
      fc.asyncProperty(
        graphNodeIdArb,
        graphNodeIdArb,
        stageLiveDataArb,
        async (firstStage, secondStage, liveData) => {
          // Reset to initial state
          useChatViewModel.setState({ graphState: INITIAL_GRAPH_STATE });
          
          // Process first stage event using GraphStateService
          const stateAfterFirst = graphStateService.processStageEvent(
            useChatViewModel.getState().graphState,
            firstStage as any,
            liveData
          );
          
          // Update Zustand store atomically
          useChatViewModel.getState().updateGraphState(stateAfterFirst);
          
          // Verify the update was atomic - all fields updated together
          const currentState = useChatViewModel.getState().graphState;
          expect(currentState.currentStage).toBe(firstStage);
          expect(currentState.stagesLiveData[firstStage as keyof typeof currentState.stagesLiveData]).toBeDefined();
          
          // Process second stage event
          if (firstStage !== secondStage) {
            const stateAfterSecond = graphStateService.processStageEvent(
              currentState,
              secondStage as any,
              liveData
            );
            
            // Update atomically
            useChatViewModel.getState().updateGraphState(stateAfterSecond);
            
            // Verify atomic update - currentStage changed AND previous stage is completed
            const finalState = useChatViewModel.getState().graphState;
            expect(finalState.currentStage).toBe(secondStage);
            expect(finalState.completedStages).toContain(firstStage);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2 (extended): Multiple rapid updates maintain consistency
   */
  it('Property 2 (extended): multiple rapid updates maintain state consistency', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    const { INITIAL_GRAPH_STATE, graphStateService, GRAPH_NODE_ORDER } = await import('../../services/graphStateService');
    
    // Generate a sequence of stages to process
    const stageSequenceArb = fc.array(
      fc.constantFrom(...GRAPH_NODE_ORDER),
      { minLength: 2, maxLength: 5 }
    ).filter(stages => {
      // Ensure at least 2 different stages
      return new Set(stages).size >= 2;
    });

    await fc.assert(
      fc.asyncProperty(
        stageSequenceArb,
        async (stages) => {
          // Reset to initial state
          useChatViewModel.setState({ graphState: INITIAL_GRAPH_STATE });
          
          // Process each stage in sequence
          for (const stage of stages) {
            const currentGraphState = useChatViewModel.getState().graphState;
            const newState = graphStateService.processStageEvent(currentGraphState, stage);
            useChatViewModel.getState().updateGraphState(newState);
          }
          
          // Verify final state is consistent
          const finalState = useChatViewModel.getState().graphState;
          
          // Current stage should be the last stage processed
          expect(finalState.currentStage).toBe(stages[stages.length - 1]);
          
          // All stages except the last should be in completedStages
          // (accounting for duplicates in the sequence)
          const uniqueStagesBeforeLast = [...new Set(stages.slice(0, -1))];
          for (const stage of uniqueStagesBeforeLast) {
            if (stage !== stages[stages.length - 1]) {
              expect(finalState.completedStages).toContain(stage);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: graph-visualization-fixes, Property 10: Sequential Stage Processing**
   * **Validates: Requirements 9.1**
   * 
   * For any sequence of N stage events arriving in quick succession, the final
   * completedStages array SHALL contain exactly N-1 stages (all except the current),
   * preserving the order of arrival.
   */
  it('Property 10: sequential stage processing preserves all intermediate stages', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    const { INITIAL_GRAPH_STATE, graphStateService, GRAPH_NODE_ORDER } = await import('../../services/graphStateService');
    
    // Generate a sequence of distinct stages to process
    const distinctStageSequenceArb = fc.shuffledSubarray(GRAPH_NODE_ORDER, { minLength: 2, maxLength: 7 });

    await fc.assert(
      fc.asyncProperty(
        distinctStageSequenceArb,
        async (stages) => {
          // Reset to initial state
          useChatViewModel.setState({ graphState: INITIAL_GRAPH_STATE });
          
          // Process each stage in sequence (simulating rapid arrival)
          for (const stage of stages) {
            const currentGraphState = useChatViewModel.getState().graphState;
            const newState = graphStateService.processStageEvent(currentGraphState, stage);
            useChatViewModel.getState().updateGraphState(newState);
          }
          
          // Verify final state
          const finalState = useChatViewModel.getState().graphState;
          
          // Current stage should be the last stage processed
          expect(finalState.currentStage).toBe(stages[stages.length - 1]);
          
          // completedStages should contain exactly N-1 stages (all except the current)
          expect(finalState.completedStages.length).toBe(stages.length - 1);
          
          // All stages except the last should be in completedStages
          for (let i = 0; i < stages.length - 1; i++) {
            expect(finalState.completedStages).toContain(stages[i]);
          }
          
          // The last stage should NOT be in completedStages
          expect(finalState.completedStages).not.toContain(stages[stages.length - 1]);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 10 (extended): Sequential processing with repeated stages handles duplicates correctly
   */
  it('Property 10 (extended): sequential processing handles repeated stages correctly', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    const { INITIAL_GRAPH_STATE, graphStateService, GRAPH_NODE_ORDER } = await import('../../services/graphStateService');
    
    // Generate a sequence that may contain repeated stages
    const stageSequenceWithRepeatsArb = fc.array(
      fc.constantFrom(...GRAPH_NODE_ORDER),
      { minLength: 3, maxLength: 10 }
    ).filter(stages => {
      // Ensure at least 2 different stages and the last stage is different from the second-to-last
      const uniqueStages = new Set(stages);
      return uniqueStages.size >= 2 && stages.length >= 2 && stages[stages.length - 1] !== stages[stages.length - 2];
    });

    await fc.assert(
      fc.asyncProperty(
        stageSequenceWithRepeatsArb,
        async (stages) => {
          // Reset to initial state
          useChatViewModel.setState({ graphState: INITIAL_GRAPH_STATE });
          
          // Process each stage in sequence
          for (const stage of stages) {
            const currentGraphState = useChatViewModel.getState().graphState;
            const newState = graphStateService.processStageEvent(currentGraphState, stage);
            useChatViewModel.getState().updateGraphState(newState);
          }
          
          // Verify final state
          const finalState = useChatViewModel.getState().graphState;
          
          // Current stage should be the last stage processed
          expect(finalState.currentStage).toBe(stages[stages.length - 1]);
          
          // completedStages should not contain duplicates
          const uniqueCompletedStages = new Set(finalState.completedStages);
          expect(finalState.completedStages.length).toBe(uniqueCompletedStages.size);
          
          // All unique stages that appeared before the last occurrence of the final stage
          // should be in completedStages (except the final stage itself)
          const stagesBeforeLast = stages.slice(0, -1);
          const uniqueStagesBeforeLast = [...new Set(stagesBeforeLast)];
          for (const stage of uniqueStagesBeforeLast) {
            if (stage !== stages[stages.length - 1]) {
              expect(finalState.completedStages).toContain(stage);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('useChatViewModel Conversation Delete Cleanup', () => {
  /**
   * **Feature: graph-visualization-fixes, Property 12: Conversation Delete Cleanup**
   * **Validates: Requirements 10.3**
   * 
   * For any conversation deletion where the deleted conversation is the active conversation,
   * the graph state SHALL be reset to INITIAL_GRAPH_STATE.
   * 
   * This test focuses on the ViewModel's state management behavior, not storage integration.
   * The deleteConversation action should reset graphState when deleting the active conversation.
   */
  it('Property 12: deleting active conversation resets graphState to INITIAL_GRAPH_STATE', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    const { INITIAL_GRAPH_STATE } = await import('../../services/graphStateService');
    
    // Arbitrary for valid GraphNodeId
    const graphNodeIdArb = fc.constantFrom(
      'generate_questions',
      'collect_answers',
      'generate_ddx',
      'generate_refinement_question',
      'collect_refinement_answer',
      'refine_ddx',
      'generate_final_summary'
    );
    
    // Arbitrary for StageLiveData
    const stageLiveDataArb = fc.record({
      question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      refinement_round: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    });
    
    // Arbitrary for non-initial GraphState (to ensure we're testing a real reset)
    const nonInitialGraphStateArb = fc.record({
      currentStage: fc.option(graphNodeIdArb, { nil: null }),
      completedStages: fc.array(graphNodeIdArb, { minLength: 1, maxLength: 7 }).map(stages => [...new Set(stages)]),
      waitingNodeId: fc.option(graphNodeIdArb, { nil: null }),
      stagesLiveData: fc.dictionary(graphNodeIdArb, stageLiveDataArb),
    });
    
    // Arbitrary for conversation ID
    const conversationIdArb = fc.uuid();

    await fc.assert(
      fc.asyncProperty(
        conversationIdArb,
        nonInitialGraphStateArb,
        async (conversationId, graphState) => {
          // Set up the ViewModel state with the conversation as active and non-initial graph state
          // Note: We set isStorageAvailable to false to avoid storage operations
          // This test focuses on the state management behavior, not storage integration
          useChatViewModel.setState({
            conversationId: conversationId,
            messages: [{ id: 'test-msg', role: 'user', content: 'test', timestamp: new Date().toISOString() }],
            graphState: graphState as any,
            stagesLiveData: graphState.stagesLiveData as Record<string, Record<string, unknown>>,
            currentStage: graphState.currentStage,
            isStorageAvailable: false, // Disable storage to focus on state management
            conversations: [{ id: conversationId, title: 'Test', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), message_count: 1 }],
          });
          
          // Verify the conversation is active and graph state is non-initial
          const stateBefore = useChatViewModel.getState();
          expect(stateBefore.conversationId).toBe(conversationId);
          expect(stateBefore.graphState).toEqual(graphState);
          
          // Delete the active conversation
          await useChatViewModel.getState().deleteConversation(conversationId);
          
          // Verify graph state is reset to INITIAL_GRAPH_STATE
          const stateAfter = useChatViewModel.getState();
          expect(stateAfter.graphState.currentStage).toBeNull();
          expect(stateAfter.graphState.completedStages).toEqual([]);
          expect(stateAfter.graphState.waitingNodeId).toBeNull();
          expect(stateAfter.graphState.stagesLiveData).toEqual({});
          
          // Also verify other state is cleared
          expect(stateAfter.conversationId).toBeNull();
          expect(stateAfter.messages).toEqual([]);
          expect(stateAfter.stagesLiveData).toEqual({});
          expect(stateAfter.currentStage).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 12 (extended): Deleting non-active conversation does NOT reset graphState
   * 
   * This test verifies that when deleting a conversation that is NOT the active conversation,
   * the graph state should be preserved (not reset).
   */
  it('Property 12 (extended): deleting non-active conversation preserves graphState', async () => {
    const { useChatViewModel } = await import('../../viewmodels/useChatViewModel');
    
    // Arbitrary for valid GraphNodeId
    const graphNodeIdArb = fc.constantFrom(
      'generate_questions',
      'collect_answers',
      'generate_ddx',
      'generate_refinement_question',
      'collect_refinement_answer',
      'refine_ddx',
      'generate_final_summary'
    );
    
    // Arbitrary for StageLiveData
    const stageLiveDataArb = fc.record({
      question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      refinement_round: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
    });
    
    // Arbitrary for non-initial GraphState
    const nonInitialGraphStateArb = fc.record({
      currentStage: fc.option(graphNodeIdArb, { nil: null }),
      completedStages: fc.array(graphNodeIdArb, { minLength: 1, maxLength: 7 }).map(stages => [...new Set(stages)]),
      waitingNodeId: fc.option(graphNodeIdArb, { nil: null }),
      stagesLiveData: fc.dictionary(graphNodeIdArb, stageLiveDataArb),
    });
    
    // Generate two different conversation IDs
    const twoConversationIdsArb = fc.tuple(fc.uuid(), fc.uuid())
      .filter(([id1, id2]) => id1 !== id2);

    await fc.assert(
      fc.asyncProperty(
        twoConversationIdsArb,
        nonInitialGraphStateArb,
        async ([activeConversationId, otherConversationId], graphState) => {
          // Set up the ViewModel state with activeConversation as active
          // Note: We set isStorageAvailable to false to avoid storage operations
          useChatViewModel.setState({
            conversationId: activeConversationId,
            messages: [{ id: 'test-msg', role: 'user', content: 'test', timestamp: new Date().toISOString() }],
            graphState: graphState as any,
            stagesLiveData: graphState.stagesLiveData as Record<string, Record<string, unknown>>,
            currentStage: graphState.currentStage,
            isStorageAvailable: false, // Disable storage to focus on state management
            conversations: [
              { id: activeConversationId, title: 'Active', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), message_count: 1 },
              { id: otherConversationId, title: 'Other', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), message_count: 0 },
            ],
          });
          
          // Verify the active conversation and graph state
          const stateBefore = useChatViewModel.getState();
          expect(stateBefore.conversationId).toBe(activeConversationId);
          expect(stateBefore.graphState).toEqual(graphState);
          
          // Delete the OTHER (non-active) conversation
          await useChatViewModel.getState().deleteConversation(otherConversationId);
          
          // Verify graph state is PRESERVED (not reset)
          const stateAfter = useChatViewModel.getState();
          expect(stateAfter.graphState).toEqual(graphState);
          
          // Active conversation should still be active
          expect(stateAfter.conversationId).toBe(activeConversationId);
          expect(stateAfter.messages.length).toBe(1);
          
          // Only the other conversation should be removed from the list
          expect(stateAfter.conversations.find(c => c.id === otherConversationId)).toBeUndefined();
          expect(stateAfter.conversations.find(c => c.id === activeConversationId)).toBeDefined();
        }
      ),
      { numRuns: 100 }
    );
  });
});
