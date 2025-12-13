/**
 * Property-based tests for IndexedDB Storage Service.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { IndexedDBStorageService } from '../../services/storage/indexedDBStorage';
import { StoredConversation, StoredMessage, StoredGraphState } from '../../services/storage/types';
import { GraphNodeId } from '../../types/graph';

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

// Arbitrary for valid GraphNodeId
const graphNodeIdArb: fc.Arbitrary<GraphNodeId> = fc.constantFrom(
  'generate_questions',
  'collect_answers',
  'generate_ddx',
  'generate_refinement_question',
  'collect_refinement_answer',
  'refine_ddx',
  'generate_final_summary'
);

// Arbitrary for stage live data
const stageLiveDataArb = fc.record({
  question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  top_diagnosis: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  top_probability: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
  refinement_round: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
});

// Arbitrary for StoredGraphState
const storedGraphStateArb: fc.Arbitrary<StoredGraphState> = fc.record({
  completed_stages: fc.array(graphNodeIdArb, { maxLength: 7 }).map(stages => [...new Set(stages)]),
  waiting_node_id: fc.option(graphNodeIdArb, { nil: null }),
  stages_live_data: fc.dictionary(
    graphNodeIdArb,
    stageLiveDataArb.map(data => {
      // Convert to Record<string, unknown> by filtering out undefined values
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          result[key] = value;
        }
      }
      return result;
    })
  ),
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

// Arbitrary for generating valid stored conversations with graph state
const storedConversationWithGraphStateArb: fc.Arbitrary<StoredConversation> = fc.record({
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
  graph_state: storedGraphStateArb,
});

// Helper to delete the database and wait for completion
const deleteDatabase = (): Promise<void> => {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase('medical-chatbot');
    request.onsuccess = () => resolve();
    request.onerror = () => resolve(); // Resolve even on error to avoid hanging
    request.onblocked = () => resolve();
  });
};

describe('IndexedDBStorageService', () => {
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
   * **Feature: client-side-storage, Property 1: Conversation persistence round-trip**
   * **Validates: Requirements 1.1, 1.2, 6.1**
   * 
   * For any valid conversation object, saving to IndexedDB and then loading
   * should return an equivalent conversation with all messages preserved.
   */
  it('Property 1: conversation round-trip preserves all data', async () => {
    await fc.assert(
      fc.asyncProperty(
        storedConversationArb,
        async (conversation) => {
          // Save the conversation
          await storageService.saveConversation(conversation);
          
          // Load it back
          const loaded = await storageService.getConversation(conversation.id);
          
          // Verify it matches
          expect(loaded).not.toBeNull();
          expect(loaded).toEqual(conversation);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: client-side-storage, Property 8: Data structure validation**
   * **Validates: Requirements 6.2**
   * 
   * For any data loaded from IndexedDB, the system should validate it has
   * required fields (id, messages, timestamps) before use.
   */
  it('Property 8: data validation rejects invalid data', async () => {
    // Arbitrary for generating invalid conversation data (missing required fields)
    const invalidConversationArb = fc.oneof(
      // Missing messages (not an array)
      fc.record({
        id: fc.uuid(),
        title: fc.string(),
        messages: fc.string(), // Invalid: should be array
        created_at: validDateArb.map(d => d.toISOString()),
        updated_at: validDateArb.map(d => d.toISOString()),
      }),
      // Missing created_at
      fc.record({
        id: fc.uuid(),
        title: fc.string(),
        messages: fc.array(storedMessageArb),
        updated_at: validDateArb.map(d => d.toISOString()),
      }),
      // Missing updated_at
      fc.record({
        id: fc.uuid(),
        title: fc.string(),
        messages: fc.array(storedMessageArb),
        created_at: validDateArb.map(d => d.toISOString()),
      }),
      // Invalid message in array (missing role)
      fc.record({
        id: fc.uuid(),
        title: fc.string(),
        messages: fc.constant([{ id: 'msg-1', content: 'test', timestamp: new Date().toISOString() }]),
        created_at: validDateArb.map(d => d.toISOString()),
        updated_at: validDateArb.map(d => d.toISOString()),
      })
    );

    await fc.assert(
      fc.asyncProperty(
        invalidConversationArb,
        async (invalidData) => {
          const testId = (invalidData as { id: string }).id;
          
          // Insert invalid data using the storage service's internal method
          // We use saveConversation with type assertion to bypass TypeScript checks
          // This simulates corrupted data that might exist in the database
          await storageService.saveConversation(invalidData as unknown as StoredConversation);

          // Try to load the invalid data - should return null due to validation
          const loaded = await storageService.getConversation(testId);
          
          // Validation should reject invalid data and return null
          expect(loaded).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: graph-visualization-fixes, Property 6: Graph State Persistence Round-Trip**
   * **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 4.3, 4.4**
   * 
   * For any conversation with graph state saved to IndexedDB, loading that conversation
   * SHALL restore the exact same completedStages array, waitingNodeId, and stagesLiveData.
   */
  it('Property 6: graph state persistence round-trip', async () => {
    await fc.assert(
      fc.asyncProperty(
        storedConversationWithGraphStateArb,
        async (conversation) => {
          // Save the conversation with graph state
          await storageService.saveConversation(conversation);
          
          // Load it back
          const loaded = await storageService.getConversation(conversation.id);
          
          // Verify it matches
          expect(loaded).not.toBeNull();
          expect(loaded!.graph_state).toBeDefined();
          expect(loaded!.graph_state!.completed_stages).toEqual(conversation.graph_state!.completed_stages);
          expect(loaded!.graph_state!.waiting_node_id).toEqual(conversation.graph_state!.waiting_node_id);
          expect(loaded!.graph_state!.stages_live_data).toEqual(conversation.graph_state!.stages_live_data);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: client-side-storage, Property 9: Schema migration preserves data**
   * **Validates: Requirements 6.4**
   * 
   * For any conversation stored in an older schema version, migration should
   * preserve all message content and metadata.
   */
  it('Property 9: schema migration preserves message content', async () => {
    // Arbitrary for generating conversations with version 0 (pre-migration)
    const oldSchemaConversationArb = fc.record({
      id: fc.uuid(),
      title: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
      messages: fc.array(storedMessageArb, { minLength: 1, maxLength: 10 }),
      created_at: validDateArb.map(d => d.toISOString()),
      updated_at: validDateArb.map(d => d.toISOString()),
      version: fc.constant(0), // Old version
      // Intentionally missing thread_id and is_interrupted to simulate old schema
    });

    await fc.assert(
      fc.asyncProperty(
        oldSchemaConversationArb,
        async (oldConversation) => {
          // Save the old schema conversation
          await storageService.saveConversation(oldConversation as unknown as StoredConversation);
          
          // Run migration
          await storageService.migrateIfNeeded();
          
          // Load the migrated conversation
          const migrated = await storageService.getConversation(oldConversation.id);
          
          // Verify migration preserved all message content
          expect(migrated).not.toBeNull();
          expect(migrated!.id).toEqual(oldConversation.id);
          expect(migrated!.messages.length).toEqual(oldConversation.messages.length);
          
          // Verify each message content is preserved
          for (let i = 0; i < oldConversation.messages.length; i++) {
            expect(migrated!.messages[i].id).toEqual(oldConversation.messages[i].id);
            expect(migrated!.messages[i].role).toEqual(oldConversation.messages[i].role);
            expect(migrated!.messages[i].content).toEqual(oldConversation.messages[i].content);
            expect(migrated!.messages[i].timestamp).toEqual(oldConversation.messages[i].timestamp);
          }
          
          // Verify migration added new fields
          expect(migrated!.version).toEqual(1);
          expect(migrated!.thread_id).toBeDefined();
          expect(typeof migrated!.is_interrupted).toBe('boolean');
        }
      ),
      { numRuns: 100 }
    );
  });
});
