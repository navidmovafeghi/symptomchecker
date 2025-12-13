/**
 * Property-based tests for PersistenceService.
 * 
 * **Feature: data-persistence-consistency**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { PersistenceService, SaveRequest, GraphState } from '../../services/persistence';
import { IndexedDBStorageService } from '../../services/storage/indexedDBStorage';
import { getStorageService, initializeStorage, StorageError, IStorageService, StoredConversation } from '../../services/storage';
import { Message, QuestionWithOptions } from '../../types';
import { GraphNodeId } from '../../types/graph';

// Use integer timestamps to avoid Invalid Date errors during shrinking
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 })
  .map(ts => new Date(ts));

const isoTimestampArb = validDateArb.map(d => d.toISOString());

const messageRoleArb = fc.constantFrom('user', 'assistant', 'system') as fc.Arbitrary<'user' | 'assistant' | 'system'>;

const messageArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: messageRoleArb,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: isoTimestampArb,
  options: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }), { nil: undefined }),
  isQuestion: fc.option(fc.boolean(), { nil: undefined }),
});

const graphNodeIdArb: fc.Arbitrary<GraphNodeId> = fc.constantFrom(
  'generate_questions', 'collect_answers', 'generate_ddx',
  'generate_refinement_question', 'collect_refinement_answer',
  'refine_ddx', 'generate_final_summary'
);

const stageLiveDataArb = fc.record({
  question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  top_diagnosis: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
});

const graphStateArb: fc.Arbitrary<GraphState> = fc.record({
  completedStages: fc.array(graphNodeIdArb, { maxLength: 7 }).map(stages => [...new Set(stages)]),
  waitingNodeId: fc.option(graphNodeIdArb, { nil: null }),
  stagesLiveData: fc.dictionary(graphNodeIdArb, stageLiveDataArb.map(data => {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) result[key] = value;
    }
    return result;
  })),
});

const questionWithOptionsArb: fc.Arbitrary<QuestionWithOptions> = fc.record({
  question: fc.string({ minLength: 1, maxLength: 200 }),
  options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 5 }),
  question_number: fc.integer({ min: 1, max: 10 }),
});

const saveRequestArb: fc.Arbitrary<SaveRequest> = fc.record({
  conversationId: fc.uuid(),
  messages: fc.array(messageArb, { minLength: 1, maxLength: 10 }),
  threadId: fc.option(fc.uuid(), { nil: null }),
  isInterrupted: fc.boolean(),
  pendingQuestion: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null }),
  pendingOptions: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { maxLength: 5 }),
  pendingQuestions: fc.array(questionWithOptionsArb, { maxLength: 3 }),
  graphState: graphStateArb,
  existingCreatedAt: fc.option(isoTimestampArb, { nil: undefined }),
});

const deleteDatabase = (): Promise<void> => {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('medical-chatbot');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
};

const createMockStorageService = (): IStorageService => {
  const savedConversations = new Map<string, StoredConversation>();
  return {
    initialize: async () => {},
    isAvailable: () => true,
    saveConversation: vi.fn().mockImplementation(async (conv: StoredConversation) => {
      savedConversations.set(conv.id, conv);
    }),
    getConversation: vi.fn().mockImplementation(async (id: string) => savedConversations.get(id) || null),
    deleteConversation: vi.fn().mockResolvedValue(true),
    listConversations: vi.fn().mockResolvedValue([]),
    findInterruptedConversation: vi.fn().mockResolvedValue(null),
    migrateIfNeeded: async () => {},
  };
};

describe('PersistenceService', () => {
  let storageService: IndexedDBStorageService;

  beforeEach(async () => {
    await initializeStorage();
    storageService = getStorageService() as IndexedDBStorageService;
  });

  afterEach(async () => {
    if (storageService?.close) storageService.close();
    await deleteDatabase();
  });

  /**
   * **Feature: data-persistence-consistency, Property 1: Round-trip data preservation**
   * **Validates: Requirements 1.2, 4.1, 4.2, 6.3**
   */
  it('Property 1: round-trip data preservation', async () => {
    await fc.assert(
      fc.asyncProperty(saveRequestArb, async (request) => {
        const persistenceService = new PersistenceService(storageService);
        await persistenceService.saveConversation(request);
        const loaded = await storageService.getConversation(request.conversationId);
        
        expect(loaded).not.toBeNull();
        expect(loaded!.messages.length).toEqual(request.messages.length);
        expect(loaded!.is_interrupted).toEqual(request.isInterrupted);
        expect(loaded!.graph_state).toBeDefined();
        expect(loaded!.graph_state!.completed_stages).toEqual(request.graphState.completedStages);
        expect(loaded!.thread_id).toEqual(request.threadId || request.conversationId);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: data-persistence-consistency, Property 2: Retry with exponential backoff**
   * **Validates: Requirements 2.1**
   */
  it('Property 2: retry with exponential backoff', async () => {
    await fc.assert(
      fc.asyncProperty(
        saveRequestArb,
        fc.integer({ min: 1, max: 3 }),
        async (request, failuresBeforeSuccess) => {
          const attemptTimes: number[] = [];
          let attemptCount = 0;
          
          const mockStorageService = createMockStorageService();
          (mockStorageService.saveConversation as ReturnType<typeof vi.fn>).mockImplementation(async () => {
            attemptTimes.push(Date.now());
            attemptCount++;
            if (attemptCount <= failuresBeforeSuccess) {
              throw new StorageError('Transient error', 'UNKNOWN');
            }
          });
          
          const testService = new PersistenceService(mockStorageService);
          await testService.saveConversation(request);
          
          expect(attemptCount).toBe(failuresBeforeSuccess + 1);
          
          const expectedDelays = [100, 200, 400];
          for (let i = 1; i < attemptTimes.length && i <= failuresBeforeSuccess; i++) {
            const actualDelay = attemptTimes[i] - attemptTimes[i - 1];
            expect(actualDelay).toBeGreaterThanOrEqual(expectedDelays[i - 1] - 50);
            expect(actualDelay).toBeLessThan(expectedDelays[i - 1] + 150);
          }
        }
      ),
      { numRuns: 20 }
    );
  }, 60000);

  /**
   * **Feature: data-persistence-consistency, Property 3: Sequential queue processing**
   * **Validates: Requirements 3.1, 3.2**
   */
  it('Property 3: sequential queue processing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(saveRequestArb, { minLength: 2, maxLength: 5 }),
        async (conversationId, requests) => {
          const mockStorageService = createMockStorageService();
          const persistenceService = new PersistenceService(mockStorageService);
          
          const normalizedRequests = requests.map((req, index) => ({
            ...req, conversationId,
            messages: [{ ...req.messages[0], content: `Message ${index}` }],
          }));
          
          let saveInProgress = false;
          let overlappingDetected = false;
          
          const unsubStart = persistenceService.on('saveStarted', (data) => {
            if (data.conversationId === conversationId) {
              if (saveInProgress) overlappingDetected = true;
              saveInProgress = true;
            }
          });
          
          const unsubComplete = persistenceService.on('saveCompleted', (data) => {
            if (data.conversationId === conversationId) saveInProgress = false;
          });
          
          try {
            await Promise.all(normalizedRequests.map(req => persistenceService.saveConversation(req)));
            expect(overlappingDetected).toBe(false);
          } finally {
            unsubStart();
            unsubComplete();
          }
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Feature: data-persistence-consistency, Property 4: Queue optimization (newer replaces pending)**
   * **Validates: Requirements 3.3**
   */
  it('Property 4: queue optimization (newer replaces pending)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        saveRequestArb,
        saveRequestArb,
        async (conversationId, oldRequest, newRequest) => {
          const mockStorageService = createMockStorageService();
          const persistenceService = new PersistenceService(mockStorageService);
          
          const oldReq = { ...oldRequest, conversationId };
          const newReq = { ...newRequest, conversationId };
          
          const queueUpdates: { conversationId: string; queueDepth: number }[] = [];
          const unsubQueue = persistenceService.on('queueUpdated', (data) => queueUpdates.push(data));
          
          try {
            await Promise.all([
              persistenceService.saveConversation(oldReq),
              persistenceService.saveConversation(newReq),
            ]);
            
            const loaded = await mockStorageService.getConversation(conversationId);
            expect(loaded).not.toBeNull();
            expect(loaded!.is_interrupted).toBe(newReq.isInterrupted);
            
            for (const update of queueUpdates) {
              if (update.conversationId === conversationId) {
                expect(update.queueDepth).toBeLessThanOrEqual(1);
              }
            }
          } finally {
            unsubQueue();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: data-persistence-consistency, Property 5: Parallel saves for different conversations**
   * **Validates: Requirements 3.4**
   */
  it('Property 5: parallel saves for different conversations', async () => {
    await fc.assert(
      fc.asyncProperty(
        saveRequestArb,
        saveRequestArb,
        async (request1, request2) => {
          const mockStorageService = createMockStorageService();
          const persistenceService = new PersistenceService(mockStorageService);
          
          const req1 = { ...request1, conversationId: `conv-1-${request1.conversationId}` };
          const req2 = { ...request2, conversationId: `conv-2-${request2.conversationId}` };
          
          const activeConversations = new Set<string>();
          let maxConcurrent = 0;
          
          const unsubStart = persistenceService.on('saveStarted', (data) => {
            activeConversations.add(data.conversationId);
            maxConcurrent = Math.max(maxConcurrent, activeConversations.size);
          });
          
          const unsubComplete = persistenceService.on('saveCompleted', (data) => {
            activeConversations.delete(data.conversationId);
          });
          
          try {
            await Promise.all([
              persistenceService.saveConversation(req1),
              persistenceService.saveConversation(req2),
            ]);
            
            const loaded1 = await mockStorageService.getConversation(req1.conversationId);
            const loaded2 = await mockStorageService.getConversation(req2.conversationId);
            
            expect(loaded1).not.toBeNull();
            expect(loaded2).not.toBeNull();
            expect(maxConcurrent).toBeGreaterThanOrEqual(1);
          } finally {
            unsubStart();
            unsubComplete();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: data-persistence-consistency, Property 6: isSaving state consistency**
   * **Validates: Requirements 5.1, 5.2**
   * 
   * For any conversation, the `isSaving` state SHALL be true while a save is in progress
   * and false when all saves complete.
   */
  it('Property 6: isSaving state consistency', async () => {
    await fc.assert(
      fc.asyncProperty(
        saveRequestArb,
        async (request) => {
          const mockStorageService = createMockStorageService();
          const persistenceService = new PersistenceService(mockStorageService);
          const { conversationId } = request;
          
          // Track isSaving state changes
          const isSavingStates: { event: string; isSaving: boolean; hasPending: boolean }[] = [];
          
          const unsubStart = persistenceService.on('saveStarted', (data) => {
            if (data.conversationId === conversationId) {
              isSavingStates.push({
                event: 'saveStarted',
                isSaving: persistenceService.isSaving(conversationId),
                hasPending: persistenceService.hasPendingSaves(),
              });
            }
          });
          
          const unsubComplete = persistenceService.on('saveCompleted', (data) => {
            if (data.conversationId === conversationId) {
              isSavingStates.push({
                event: 'saveCompleted',
                isSaving: persistenceService.isSaving(conversationId),
                hasPending: persistenceService.hasPendingSaves(),
              });
            }
          });
          
          try {
            // Before save: isSaving should be false
            expect(persistenceService.isSaving(conversationId)).toBe(false);
            expect(persistenceService.hasPendingSaves()).toBe(false);
            
            // Start save
            const savePromise = persistenceService.saveConversation(request);
            
            // Wait for save to complete
            await savePromise;
            
            // After save: isSaving should be false
            expect(persistenceService.isSaving(conversationId)).toBe(false);
            expect(persistenceService.hasPendingSaves()).toBe(false);
            
            // Verify state during save: isSaving should have been true when saveStarted was emitted
            const startState = isSavingStates.find(s => s.event === 'saveStarted');
            expect(startState).toBeDefined();
            expect(startState!.isSaving).toBe(true);
            expect(startState!.hasPending).toBe(true);
          } finally {
            unsubStart();
            unsubComplete();
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: data-persistence-consistency, Property 7: Event emission lifecycle**
   * **Validates: Requirements 7.1, 7.2, 7.3**
   * 
   * For any save operation, the PersistenceService SHALL emit `saveStarted` when beginning,
   * and either `saveCompleted` on success or `saveFailed` after all retries are exhausted.
   */
  it('Property 7: event emission lifecycle', async () => {
    await fc.assert(
      fc.asyncProperty(
        saveRequestArb,
        fc.boolean(), // shouldFail - whether the save should fail
        async (request, shouldFail) => {
          const mockStorageService = createMockStorageService();
          const { conversationId } = request;
          
          // Track events
          const events: { type: string; data: unknown }[] = [];
          
          if (shouldFail) {
            // Make all save attempts fail
            (mockStorageService.saveConversation as ReturnType<typeof vi.fn>).mockRejectedValue(
              new StorageError('Simulated failure', 'UNKNOWN')
            );
          }
          
          const persistenceService = new PersistenceService(mockStorageService);
          
          const unsubStart = persistenceService.on('saveStarted', (data) => {
            if (data.conversationId === conversationId) {
              events.push({ type: 'saveStarted', data });
            }
          });
          
          const unsubComplete = persistenceService.on('saveCompleted', (data) => {
            if (data.conversationId === conversationId) {
              events.push({ type: 'saveCompleted', data });
            }
          });
          
          const unsubFailed = persistenceService.on('saveFailed', (data) => {
            if (data.conversationId === conversationId) {
              events.push({ type: 'saveFailed', data });
            }
          });
          
          try {
            try {
              await persistenceService.saveConversation(request);
            } catch {
              // Expected for shouldFail case
            }
            
            // Verify saveStarted was always emitted first
            expect(events.length).toBeGreaterThanOrEqual(2);
            expect(events[0].type).toBe('saveStarted');
            
            // Verify saveStarted has correct data
            const startEvent = events[0].data as { conversationId: string; messageCount: number; hasGraphState: boolean };
            expect(startEvent.conversationId).toBe(conversationId);
            expect(startEvent.messageCount).toBe(request.messages.length);
            expect(startEvent.hasGraphState).toBe(!!request.graphState);
            
            // Verify either saveCompleted or saveFailed was emitted (not both)
            const completedEvents = events.filter(e => e.type === 'saveCompleted');
            const failedEvents = events.filter(e => e.type === 'saveFailed');
            
            if (shouldFail) {
              expect(completedEvents.length).toBe(0);
              expect(failedEvents.length).toBe(1);
              
              const failEvent = failedEvents[0].data as { conversationId: string; error: string; errorCode: string };
              expect(failEvent.conversationId).toBe(conversationId);
              expect(failEvent.error).toBeDefined();
              expect(failEvent.errorCode).toBeDefined();
            } else {
              expect(completedEvents.length).toBe(1);
              expect(failedEvents.length).toBe(0);
              
              const completeEvent = completedEvents[0].data as { conversationId: string; durationMs: number };
              expect(completeEvent.conversationId).toBe(conversationId);
              expect(completeEvent.durationMs).toBeGreaterThanOrEqual(0);
            }
          } finally {
            unsubStart();
            unsubComplete();
            unsubFailed();
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 120000); // Longer timeout due to retry delays when shouldFail is true
});


describe('PersistenceService ViewModel Integration', () => {
  /**
   * **Feature: data-persistence-consistency, Property 8: Interrupt save ordering**
   * **Validates: Requirements 6.1**
   * 
   * For any interrupt event, the ViewModel SHALL await save completion before setting
   * `isWaitingForInput` to true in the UI state.
   * 
   * This test verifies that when saveConversation is called with isInterrupted=true,
   * the save completes (data is persisted) before the promise resolves, ensuring
   * the ViewModel can safely set isWaitingForInput after awaiting.
   */
  it('Property 8: interrupt save ordering - save completes before promise resolves', async () => {
    await fc.assert(
      fc.asyncProperty(
        saveRequestArb.filter(req => req.isInterrupted), // Only test interrupt saves
        async (request) => {
          // Create fresh storage service for each iteration
          const localStorageService = new IndexedDBStorageService();
          await localStorageService.initialize();
          
          try {
            const persistenceService = new PersistenceService(localStorageService);
            const { conversationId } = request;
            
            // Track the order of events
            const events: string[] = [];
            
            // Subscribe to save events
            const unsubStart = persistenceService.on('saveStarted', (data) => {
              if (data.conversationId === conversationId) {
                events.push('saveStarted');
              }
            });
            
            const unsubComplete = persistenceService.on('saveCompleted', (data) => {
              if (data.conversationId === conversationId) {
                events.push('saveCompleted');
              }
            });
            
            try {
              // Simulate the ViewModel pattern: await save, then set isWaitingForInput
              await persistenceService.saveConversation(request);
              events.push('promiseResolved');
              
              // Verify the data is actually persisted before promise resolved
              const loaded = await localStorageService.getConversation(conversationId);
              
              // The save must have completed before the promise resolved
              expect(events).toContain('saveStarted');
              expect(events).toContain('saveCompleted');
              expect(events).toContain('promiseResolved');
              
              // saveCompleted must come before promiseResolved
              const completedIndex = events.indexOf('saveCompleted');
              const resolvedIndex = events.indexOf('promiseResolved');
              expect(completedIndex).toBeLessThan(resolvedIndex);
              
              // Data must be persisted
              expect(loaded).not.toBeNull();
              expect(loaded!.is_interrupted).toBe(true);
              expect(loaded!.id).toBe(conversationId);
              
              // If there's a pending question, it should be saved
              if (request.pendingQuestion) {
                expect(loaded!.pending_question).toBe(request.pendingQuestion);
              }
              
              // If there are pending options, they should be saved
              if (request.pendingOptions.length > 0) {
                expect(loaded!.pending_options).toEqual(request.pendingOptions);
              }
              
              // Graph state should be saved
              expect(loaded!.graph_state).toBeDefined();
              expect(loaded!.graph_state!.completed_stages).toEqual(request.graphState.completedStages);
            } finally {
              unsubStart();
              unsubComplete();
            }
          } finally {
            localStorageService.close();
            await deleteDatabase();
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 120000); // Longer timeout for property tests

  /**
   * Property 8 (extended): Multiple interrupt saves maintain ordering
   * 
   * When multiple interrupt saves are queued for the same conversation,
   * each save must complete before its promise resolves.
   */
  it('Property 8 (extended): multiple interrupt saves maintain ordering', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.array(saveRequestArb.filter(req => req.isInterrupted), { minLength: 2, maxLength: 4 }),
        async (conversationId, requests) => {
          // Create fresh storage service for each iteration
          const localStorageService = new IndexedDBStorageService();
          await localStorageService.initialize();
          
          try {
            const persistenceService = new PersistenceService(localStorageService);
            
            // Normalize all requests to use the same conversation ID
            const normalizedRequests = requests.map((req, index) => ({
              ...req,
              conversationId,
              pendingQuestion: `Question ${index + 1}`,
            }));
            
            // Track completion order
            const completionOrder: number[] = [];
            
            // Save all requests and track when each promise resolves
            const savePromises = normalizedRequests.map(async (req, index) => {
              await persistenceService.saveConversation(req);
              completionOrder.push(index);
              
              // Verify data is persisted when promise resolves
              const loaded = await localStorageService.getConversation(conversationId);
              expect(loaded).not.toBeNull();
              expect(loaded!.is_interrupted).toBe(true);
            });
            
            await Promise.all(savePromises);
            
            // All saves should have completed
            expect(completionOrder.length).toBe(normalizedRequests.length);
            
            // Final state should reflect the last save (due to queue optimization)
            const finalLoaded = await localStorageService.getConversation(conversationId);
            expect(finalLoaded).not.toBeNull();
            expect(finalLoaded!.is_interrupted).toBe(true);
          } finally {
            localStorageService.close();
            await deleteDatabase();
          }
        }
      ),
      { numRuns: 50 }
    );
  }, 120000); // Longer timeout for property tests
});
