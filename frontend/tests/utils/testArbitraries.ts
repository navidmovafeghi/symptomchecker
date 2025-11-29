/**
 * Shared fast-check arbitraries for property-based testing.
 * These arbitraries generate valid test data for IndexedDB storage tests.
 */
import fc from 'fast-check';
import { StoredConversation, StoredMessage } from '../../services/storage/types';

/**
 * Arbitrary for generating valid timestamps within a reasonable range.
 * Uses integer timestamps to avoid Invalid Date errors during shrinking.
 */
export const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31
  .map(ts => new Date(ts));

/**
 * Arbitrary for generating valid ISO timestamp strings.
 */
export const isoTimestampArb = validDateArb.map(d => d.toISOString());

/**
 * Arbitrary for generating valid message roles.
 */
export const messageRoleArb = fc.constantFrom('user', 'assistant', 'system') as fc.Arbitrary<'user' | 'assistant' | 'system'>;

/**
 * Arbitrary for generating user/assistant message roles (no system).
 */
export const userAssistantRoleArb = fc.constantFrom('user', 'assistant') as fc.Arbitrary<'user' | 'assistant'>;

/**
 * Arbitrary for generating valid stored messages.
 */
export const storedMessageArb: fc.Arbitrary<StoredMessage> = fc.record({
  id: fc.uuid(),
  role: messageRoleArb,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: isoTimestampArb,
  options: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }), { nil: undefined }),
  isQuestion: fc.option(fc.boolean(), { nil: undefined }),
});

/**
 * Arbitrary for generating a new message to add (user or assistant only).
 */
export const newMessageArb: fc.Arbitrary<StoredMessage> = fc.record({
  id: fc.uuid(),
  role: userAssistantRoleArb,
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: isoTimestampArb,
});


/**
 * Arbitrary for generating valid stored conversations.
 */
export const storedConversationArb: fc.Arbitrary<StoredConversation> = fc.record({
  id: fc.uuid(),
  title: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  messages: fc.array(storedMessageArb, { minLength: 0, maxLength: 10 }),
  created_at: isoTimestampArb,
  updated_at: isoTimestampArb,
  version: fc.constant(1),
  thread_id: fc.uuid(),
  is_interrupted: fc.boolean(),
  pending_question: fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: undefined }),
  pending_options: fc.option(fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 1, maxLength: 5 }), { nil: undefined }),
});

/**
 * Arbitrary for generating a set of unique conversations.
 * Ensures all conversation IDs are unique.
 */
export const uniqueConversationsArb = fc.array(storedConversationArb, { minLength: 1, maxLength: 10 })
  .map(conversations => {
    const seen = new Set<string>();
    return conversations.filter(c => {
      if (seen.has(c.id)) return false;
      seen.add(c.id);
      return true;
    });
  })
  .filter(conversations => conversations.length > 0);

/**
 * Arbitrary for generating conversation history entries (for API requests).
 */
export const historyEntryArb = fc.record({
  role: messageRoleArb,
  content: fc.string({ minLength: 1, maxLength: 500 }),
});

/**
 * Arbitrary for generating conversation history arrays.
 */
export const conversationHistoryArb = fc.array(historyEntryArb, { minLength: 1, maxLength: 20 });

/**
 * Arbitrary for generating interrupt data.
 */
export const interruptDataArb = fc.record({
  conversationId: fc.uuid(),
  threadId: fc.uuid(),
  question: fc.string({ minLength: 1, maxLength: 200 }),
  options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 5 }),
  existingMessages: fc.array(storedMessageArb, { minLength: 0, maxLength: 5 }),
});

/**
 * Arbitrary for generating resume request data.
 */
export const resumeDataArb = fc.record({
  threadId: fc.uuid(),
  userInput: fc.string({ minLength: 1, maxLength: 500 }),
});
