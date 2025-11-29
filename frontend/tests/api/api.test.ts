/**
 * Property-based tests for API service.
 * Tests client-side storage integration with API requests.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { SendMessageRequest } from '../../types';

// Arbitrary for generating valid message roles
const messageRoleArb = fc.constantFrom('user', 'assistant', 'system');

// Arbitrary for generating conversation history entries
const historyEntryArb = fc.record({
  role: messageRoleArb,
  content: fc.string({ minLength: 1, maxLength: 500 }),
});

// Arbitrary for generating conversation history
const conversationHistoryArb = fc.array(historyEntryArb, { minLength: 1, maxLength: 20 });

// Arbitrary for generating a valid SendMessageRequest with history
const sendMessageRequestWithHistoryArb: fc.Arbitrary<SendMessageRequest> = fc.record({
  message: fc.string({ minLength: 1, maxLength: 500 }),
  conversation_id: fc.option(fc.uuid(), { nil: undefined }),
  conversation_history: fc.option(conversationHistoryArb, { nil: undefined }),
});

describe('API Service - sendMessageStream', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  /**
   * **Feature: client-side-storage, Property 5: API requests include conversation history**
   * **Validates: Requirements 3.1**
   * 
   * For any message sent to the AI, the API request should include the full
   * conversation history from IndexedDB.
   */
  it('Property 5: API requests include conversation history when provided', async () => {
    await fc.assert(
      fc.asyncProperty(
        sendMessageRequestWithHistoryArb,
        async (request) => {
          // Track what was sent to fetch
          let capturedBody: SendMessageRequest | null = null;
          
          // Create a fresh mock for each iteration
          const mockFetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
            capturedBody = JSON.parse(options.body as string);
            
            // Return a mock streaming response
            const mockReader = {
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('Hello') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
              releaseLock: vi.fn(),
            };
            
            return {
              ok: true,
              body: {
                getReader: () => mockReader,
              },
            };
          });
          
          global.fetch = mockFetch;
          
          // Import ApiService fresh
          const { ApiService } = await import('../../services/api');
          const apiService = new ApiService('http://test-api');
          
          // Call sendMessageStream
          await apiService.sendMessageStream(request, () => {});
          
          // Verify fetch was called
          expect(mockFetch).toHaveBeenCalledTimes(1);
          
          // Verify the message is included
          expect(capturedBody?.message).toBe(request.message);
          
          // Verify conversation_history is included when provided
          if (request.conversation_history) {
            expect(capturedBody?.conversation_history).toEqual(request.conversation_history);
            
            // Verify each history entry has role and content
            for (let i = 0; i < request.conversation_history.length; i++) {
              expect(capturedBody?.conversation_history?.[i].role).toBe(request.conversation_history[i].role);
              expect(capturedBody?.conversation_history?.[i].content).toBe(request.conversation_history[i].content);
            }
          }
          
          // Verify conversation_id is included when provided
          if (request.conversation_id) {
            expect(capturedBody?.conversation_id).toBe(request.conversation_id);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Empty history is not sent (undefined is omitted)
   */
  it('Property 5 (extended): conversation_history is omitted when undefined', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          message: fc.string({ minLength: 1, maxLength: 500 }),
          conversation_id: fc.option(fc.uuid(), { nil: undefined }),
        }),
        async (request) => {
          // Track what was sent to fetch
          let capturedBody: Record<string, unknown> | null = null;
          
          // Create a fresh mock for each iteration
          const mockFetch = vi.fn().mockImplementation(async (_url: string, options: RequestInit) => {
            capturedBody = JSON.parse(options.body as string);
            
            // Return a mock streaming response
            const mockReader = {
              read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('Hello') })
                .mockResolvedValueOnce({ done: true, value: undefined }),
              releaseLock: vi.fn(),
            };
            
            return {
              ok: true,
              body: {
                getReader: () => mockReader,
              },
            };
          });
          
          global.fetch = mockFetch;
          
          // Import ApiService fresh
          const { ApiService } = await import('../../services/api');
          const apiService = new ApiService('http://test-api');
          
          // Call sendMessageStream without conversation_history
          await apiService.sendMessageStream(request, () => {});
          
          // Verify conversation_history is not present in the request
          expect(capturedBody).not.toHaveProperty('conversation_history');
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('API Service - resumeConversation', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  /**
   * **Feature: client-side-storage, Property 7: Resume sends conversation context**
   * **Validates: Requirements 3.4, 4.2, 4.4**
   * 
   * For any resume operation, the API request should include the conversation_id.
   * After a successful resume, the AI response should be saved to IndexedDB before being displayed.
   */
  it('Property 7: resume sends thread_id and user_input to server', async () => {
    // Arbitrary for generating resume request data
    const resumeDataArb = fc.record({
      threadId: fc.uuid(),
      userInput: fc.string({ minLength: 1, maxLength: 500 }),
    });

    await fc.assert(
      fc.asyncProperty(
        resumeDataArb,
        async ({ threadId, userInput }) => {
          // Track what was sent to fetch
          let capturedBody: { thread_id: string; user_input: string } | null = null;
          let capturedUrl: string | null = null;
          
          // Create a fresh mock for each iteration
          const mockFetch = vi.fn().mockImplementation(async (url: string, options: RequestInit) => {
            capturedUrl = url;
            capturedBody = JSON.parse(options.body as string);
            
            return {
              ok: true,
              json: async () => ({
                type: 'complete',
                content: 'AI response',
                conversation_id: threadId,
              }),
            };
          });
          
          global.fetch = mockFetch;
          
          // Import ApiService fresh
          const { ApiService } = await import('../../services/api');
          const apiService = new ApiService('http://test-api');
          
          // Call resumeConversation
          const result = await apiService.resumeConversation(threadId, userInput);
          
          // Verify fetch was called with correct endpoint
          expect(mockFetch).toHaveBeenCalledTimes(1);
          expect(capturedUrl).toBe('http://test-api/api/chat/resume');
          
          // Verify the request body contains thread_id and user_input
          expect(capturedBody?.thread_id).toBe(threadId);
          expect(capturedBody?.user_input).toBe(userInput);
          
          // Verify the response is returned correctly
          expect(result.type).toBe('complete');
          if (result.type === 'complete') {
            expect(result.conversation_id).toBe(threadId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Resume handles interrupt response correctly
   */
  it('Property 7 (extended): resume handles interrupt response', async () => {
    const resumeDataArb = fc.record({
      threadId: fc.uuid(),
      userInput: fc.string({ minLength: 1, maxLength: 500 }),
      question: fc.string({ minLength: 1, maxLength: 200 }),
      options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 5 }),
    });

    await fc.assert(
      fc.asyncProperty(
        resumeDataArb,
        async ({ threadId, userInput, question, options }) => {
          // Create a fresh mock for each iteration
          const mockFetch = vi.fn().mockImplementation(async () => {
            return {
              ok: true,
              json: async () => ({
                type: 'interrupt',
                question,
                options,
                conversation_id: threadId,
              }),
            };
          });
          
          global.fetch = mockFetch;
          
          // Import ApiService fresh
          const { ApiService } = await import('../../services/api');
          const apiService = new ApiService('http://test-api');
          
          // Call resumeConversation
          const result = await apiService.resumeConversation(threadId, userInput);
          
          // Verify interrupt response is returned correctly
          expect(result.type).toBe('interrupt');
          if (result.type === 'interrupt') {
            expect(result.question).toBe(question);
            expect(result.options).toEqual(options);
            expect(result.conversation_id).toBe(threadId);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


describe('API Service - Checkpoint Expiry Handling', () => {
  let originalFetch: typeof global.fetch;

  beforeAll(() => {
    originalFetch = global.fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  /**
   * **Feature: client-side-storage, Property 11: Checkpoint missing graceful degradation**
   * **Validates: Requirements 3.5, 4.3**
   * 
   * For any resume operation where the server checkpoint is missing, the system
   * should notify the user that the conversation cannot be resumed from the exact
   * workflow state and offer to start a new conversation with the previous context.
   */
  it('Property 11: checkpoint expiry throws CheckpointExpiredError on 404', async () => {
    // Import CheckpointExpiredError
    const { CheckpointExpiredError } = await import('../../types');
    
    const resumeDataArb = fc.record({
      threadId: fc.uuid(),
      userInput: fc.string({ minLength: 1, maxLength: 500 }),
    });

    await fc.assert(
      fc.asyncProperty(
        resumeDataArb,
        async ({ threadId, userInput }) => {
          // Create a fresh mock that returns 404
          const mockFetch = vi.fn().mockImplementation(async () => {
            return {
              ok: false,
              status: 404,
              json: async () => ({ detail: 'Checkpoint not found' }),
            };
          });
          
          global.fetch = mockFetch;
          
          // Import ApiService fresh
          const { ApiService } = await import('../../services/api');
          const apiService = new ApiService('http://test-api');
          
          // Call resumeConversation and expect CheckpointExpiredError
          let thrownError: Error | null = null;
          try {
            await apiService.resumeConversation(threadId, userInput);
          } catch (error) {
            thrownError = error as Error;
          }
          
          // Verify CheckpointExpiredError was thrown
          expect(thrownError).not.toBeNull();
          expect(thrownError).toBeInstanceOf(CheckpointExpiredError);
          expect(thrownError?.message).toContain('expired');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Additional test: Other errors are thrown as regular Error
   */
  it('Property 11 (extended): non-404 errors throw regular Error', async () => {
    const { CheckpointExpiredError } = await import('../../types');
    
    const errorDataArb = fc.record({
      threadId: fc.uuid(),
      userInput: fc.string({ minLength: 1, maxLength: 500 }),
      statusCode: fc.constantFrom(400, 401, 403, 500, 502, 503),
      errorMessage: fc.string({ minLength: 1, maxLength: 100 }),
    });

    await fc.assert(
      fc.asyncProperty(
        errorDataArb,
        async ({ threadId, userInput, statusCode, errorMessage }) => {
          // Create a fresh mock that returns non-404 error
          const mockFetch = vi.fn().mockImplementation(async () => {
            return {
              ok: false,
              status: statusCode,
              json: async () => ({ detail: errorMessage }),
            };
          });
          
          global.fetch = mockFetch;
          
          // Import ApiService fresh
          const { ApiService } = await import('../../services/api');
          const apiService = new ApiService('http://test-api');
          
          // Call resumeConversation and expect regular Error
          let thrownError: Error | null = null;
          try {
            await apiService.resumeConversation(threadId, userInput);
          } catch (error) {
            thrownError = error as Error;
          }
          
          // Verify regular Error was thrown (not CheckpointExpiredError)
          expect(thrownError).not.toBeNull();
          expect(thrownError).not.toBeInstanceOf(CheckpointExpiredError);
          expect(thrownError?.message).toBe(errorMessage);
        }
      ),
      { numRuns: 100 }
    );
  });
});
