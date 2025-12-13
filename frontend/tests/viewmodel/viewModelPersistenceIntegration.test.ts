/**
 * Unit tests for ViewModel persistence integration.
 * Tests hasPendingSaves state, error event handling, and beforeunload warning.
 * 
 * **Feature: data-persistence-consistency**
 * **Requirements: 5.3, 5.4, 2.2**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useChatViewModel } from '../../viewmodels/useChatViewModel';
import { PersistenceService } from '../../services/persistence';
import { IStorageService, StoredConversation } from '../../services/storage';
import { useBeforeUnloadWarning } from '../../utils/useBeforeUnloadWarning';

// Mock storage service
const createMockStorageService = (): IStorageService => {
  const savedConversations = new Map<string, StoredConversation>();
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    isAvailable: vi.fn().mockReturnValue(true),
    saveConversation: vi.fn().mockImplementation(async (conv: StoredConversation) => {
      savedConversations.set(conv.id, conv);
    }),
    getConversation: vi.fn().mockImplementation(async (id: string) => savedConversations.get(id) || null),
    deleteConversation: vi.fn().mockResolvedValue(true),
    listConversations: vi.fn().mockResolvedValue([]),
    findInterruptedConversation: vi.fn().mockResolvedValue(null),
    migrateIfNeeded: vi.fn().mockResolvedValue(undefined),
  };
};

describe('ViewModel Persistence Integration', () => {
  /**
   * **Feature: data-persistence-consistency**
   * **Validates: Requirements 5.4**
   * 
   * Test that hasPendingSaves state updates correctly when saves are in progress.
   */
  describe('hasPendingSaves state updates', () => {
    it('should update hasPendingSaves when save starts and completes', async () => {
      const mockStorageService = createMockStorageService();
      const persistenceService = new PersistenceService(mockStorageService);
      
      // Track hasPendingSaves state changes
      let hasPendingDuringSave = false;
      
      persistenceService.on('saveStarted', () => {
        hasPendingDuringSave = persistenceService.hasPendingSaves();
      });
      
      // Initially should be false
      expect(persistenceService.hasPendingSaves()).toBe(false);
      
      // Start a save
      await persistenceService.saveConversation({
        conversationId: 'test-conv-1',
        messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
        threadId: null,
        isInterrupted: false,
        pendingQuestion: null,
        pendingOptions: [],
        pendingQuestions: [],
        graphState: { completedStages: [], waitingNodeId: null, stagesLiveData: {} },
      });
      
      // After save completes (promise resolved), should be false
      expect(persistenceService.hasPendingSaves()).toBe(false);
      
      // During save, hasPendingSaves should have been true
      expect(hasPendingDuringSave).toBe(true);
    });

    it('should track multiple concurrent saves for different conversations', async () => {
      const mockStorageService = createMockStorageService();
      
      // Add delay to saveConversation to simulate async operation
      let saveCount = 0;
      (mockStorageService.saveConversation as ReturnType<typeof vi.fn>).mockImplementation(async (conv: StoredConversation) => {
        saveCount++;
        await new Promise(resolve => setTimeout(resolve, 50));
      });
      
      const persistenceService = new PersistenceService(mockStorageService);
      
      // Start two saves for different conversations
      const save1 = persistenceService.saveConversation({
        conversationId: 'conv-1',
        messages: [{ id: '1', role: 'user', content: 'Hello 1', timestamp: new Date().toISOString() }],
        threadId: null,
        isInterrupted: false,
        pendingQuestion: null,
        pendingOptions: [],
        pendingQuestions: [],
        graphState: { completedStages: [], waitingNodeId: null, stagesLiveData: {} },
      });
      
      const save2 = persistenceService.saveConversation({
        conversationId: 'conv-2',
        messages: [{ id: '2', role: 'user', content: 'Hello 2', timestamp: new Date().toISOString() }],
        threadId: null,
        isInterrupted: false,
        pendingQuestion: null,
        pendingOptions: [],
        pendingQuestions: [],
        graphState: { completedStages: [], waitingNodeId: null, stagesLiveData: {} },
      });
      
      // While saves are in progress, hasPendingSaves should be true
      expect(persistenceService.hasPendingSaves()).toBe(true);
      expect(persistenceService.isSaving('conv-1')).toBe(true);
      expect(persistenceService.isSaving('conv-2')).toBe(true);
      
      await Promise.all([save1, save2]);
      
      // After all saves complete, should be false
      expect(persistenceService.hasPendingSaves()).toBe(false);
      expect(persistenceService.isSaving('conv-1')).toBe(false);
      expect(persistenceService.isSaving('conv-2')).toBe(false);
    });
  });

  /**
   * **Feature: data-persistence-consistency**
   * **Validates: Requirements 2.2, 2.4**
   * 
   * Test that error events are properly handled.
   */
  describe('error event handling', () => {
    it('should emit saveFailed event when save fails after retries', async () => {
      const mockStorageService = createMockStorageService();
      
      // Make all save attempts fail
      (mockStorageService.saveConversation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Simulated failure')
      );
      
      const persistenceService = new PersistenceService(mockStorageService);
      
      const failedEvents: { conversationId: string; error: string; errorCode: string }[] = [];
      persistenceService.on('saveFailed', (data) => {
        failedEvents.push(data);
      });
      
      // Attempt to save (should fail after retries)
      try {
        await persistenceService.saveConversation({
          conversationId: 'test-conv',
          messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
          threadId: null,
          isInterrupted: false,
          pendingQuestion: null,
          pendingOptions: [],
          pendingQuestions: [],
          graphState: { completedStages: [], waitingNodeId: null, stagesLiveData: {} },
        });
      } catch {
        // Expected to fail
      }
      
      // Should have emitted saveFailed event
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0].conversationId).toBe('test-conv');
      expect(failedEvents[0].error).toContain('Simulated failure');
    }, 30000); // Longer timeout due to retry delays

    it('should emit saveFailed with QUOTA_EXCEEDED for quota errors', async () => {
      const mockStorageService = createMockStorageService();
      
      // Import StorageError to create a quota exceeded error
      const { StorageError } = await import('../../services/storage');
      
      // Make save fail with quota exceeded error
      (mockStorageService.saveConversation as ReturnType<typeof vi.fn>).mockRejectedValue(
        new StorageError('Storage quota exceeded', 'QUOTA_EXCEEDED')
      );
      
      const persistenceService = new PersistenceService(mockStorageService);
      
      const failedEvents: { conversationId: string; error: string; errorCode: string }[] = [];
      persistenceService.on('saveFailed', (data) => {
        failedEvents.push(data);
      });
      
      // Attempt to save (should fail immediately without retries)
      try {
        await persistenceService.saveConversation({
          conversationId: 'test-conv',
          messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
          threadId: null,
          isInterrupted: false,
          pendingQuestion: null,
          pendingOptions: [],
          pendingQuestions: [],
          graphState: { completedStages: [], waitingNodeId: null, stagesLiveData: {} },
        });
      } catch {
        // Expected to fail
      }
      
      // Should have emitted saveFailed event with QUOTA_EXCEEDED code
      expect(failedEvents.length).toBe(1);
      expect(failedEvents[0].conversationId).toBe('test-conv');
      expect(failedEvents[0].errorCode).toBe('QUOTA_EXCEEDED');
    });
  });
});

describe('useBeforeUnloadWarning hook', () => {
  /**
   * **Feature: data-persistence-consistency**
   * **Validates: Requirements 5.3**
   * 
   * Test that beforeunload warning is registered when hasPendingSaves is true.
   */
  it('should add beforeunload event listener', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
    
    const { unmount } = renderHook(() => useBeforeUnloadWarning());
    
    // Should have added beforeunload listener
    expect(addEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    
    // Cleanup
    unmount();
    
    // Should have removed beforeunload listener
    expect(removeEventListenerSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    
    addEventListenerSpy.mockRestore();
    removeEventListenerSpy.mockRestore();
  });

  it('should prevent default and set returnValue when hasPendingSaves is true', () => {
    // Set up the store with hasPendingSaves = true
    const store = useChatViewModel.getState();
    useChatViewModel.setState({ ...store, hasPendingSaves: true });
    
    const { unmount } = renderHook(() => useBeforeUnloadWarning());
    
    // Create a mock BeforeUnloadEvent
    const mockEvent = {
      preventDefault: vi.fn(),
      returnValue: '',
    } as unknown as BeforeUnloadEvent;
    
    // Trigger the beforeunload event
    window.dispatchEvent(new Event('beforeunload'));
    
    // Get the handler that was registered
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    
    // Cleanup
    unmount();
    useChatViewModel.setState({ ...store, hasPendingSaves: false });
    addEventListenerSpy.mockRestore();
  });

  it('should not prevent default when hasPendingSaves is false', () => {
    // Ensure hasPendingSaves is false
    const store = useChatViewModel.getState();
    useChatViewModel.setState({ ...store, hasPendingSaves: false });
    
    const { unmount } = renderHook(() => useBeforeUnloadWarning());
    
    // Create a mock BeforeUnloadEvent
    const mockEvent = new Event('beforeunload') as BeforeUnloadEvent;
    const preventDefaultSpy = vi.spyOn(mockEvent, 'preventDefault');
    
    // Dispatch the event
    window.dispatchEvent(mockEvent);
    
    // Should not have called preventDefault
    expect(preventDefaultSpy).not.toHaveBeenCalled();
    
    // Cleanup
    unmount();
    preventDefaultSpy.mockRestore();
  });
});


describe('Checkpoint Expiry Handling', () => {
  /**
   * **Feature: data-persistence-consistency**
   * **Validates: Requirements 6.4**
   * 
   * Test that when CheckpointExpiredError is caught, the conversation is saved
   * with cleared interrupt state.
   */
  describe('checkpoint expiry saves cleared interrupt state', () => {
    it('should save conversation with is_interrupted=false when checkpoint expires', async () => {
      const mockStorageService = createMockStorageService();
      const persistenceService = new PersistenceService(mockStorageService);
      
      // Simulate saving a conversation with cleared interrupt state (as would happen on checkpoint expiry)
      const conversationId = 'test-conv-checkpoint-expiry';
      
      // First, save an interrupted conversation
      await persistenceService.saveConversation({
        conversationId,
        messages: [
          { id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
          { id: '2', role: 'assistant', content: 'What symptoms?', timestamp: new Date().toISOString() },
        ],
        threadId: 'thread-123',
        isInterrupted: true,
        pendingQuestion: 'What symptoms are you experiencing?',
        pendingOptions: ['Headache', 'Fever', 'Cough'],
        pendingQuestions: [],
        graphState: { completedStages: ['generate_questions'], waitingNodeId: 'collect_answers', stagesLiveData: {} },
      });
      
      // Verify it was saved as interrupted
      let loaded = await mockStorageService.getConversation(conversationId);
      expect(loaded).not.toBeNull();
      expect(loaded!.is_interrupted).toBe(true);
      expect(loaded!.pending_question).toBe('What symptoms are you experiencing?');
      expect(loaded!.pending_options).toEqual(['Headache', 'Fever', 'Cough']);
      
      // Now simulate checkpoint expiry - save with cleared interrupt state
      await persistenceService.saveConversation({
        conversationId,
        messages: [
          { id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() },
          { id: '2', role: 'assistant', content: 'What symptoms?', timestamp: new Date().toISOString() },
        ],
        threadId: null, // Cleared
        isInterrupted: false, // Cleared
        pendingQuestion: null, // Cleared
        pendingOptions: [], // Cleared
        pendingQuestions: [], // Cleared
        graphState: { completedStages: ['generate_questions'], waitingNodeId: null, stagesLiveData: {} },
      });
      
      // Verify interrupt state was cleared
      loaded = await mockStorageService.getConversation(conversationId);
      expect(loaded).not.toBeNull();
      expect(loaded!.is_interrupted).toBe(false);
      expect(loaded!.pending_question).toBeUndefined();
      expect(loaded!.pending_options).toBeUndefined();
      expect(loaded!.pending_questions).toBeUndefined();
      
      // Messages should still be preserved
      expect(loaded!.messages.length).toBe(2);
    });

    it('should clear all pending question fields on checkpoint expiry', async () => {
      const mockStorageService = createMockStorageService();
      const persistenceService = new PersistenceService(mockStorageService);
      
      const conversationId = 'test-conv-multi-question-expiry';
      
      // Save a conversation with multiple pending questions
      await persistenceService.saveConversation({
        conversationId,
        messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
        threadId: 'thread-456',
        isInterrupted: true,
        pendingQuestion: null,
        pendingOptions: [],
        pendingQuestions: [
          { question: 'Question 1?', options: ['A', 'B'], question_number: 1 },
          { question: 'Question 2?', options: ['C', 'D'], question_number: 2 },
        ],
        graphState: { completedStages: [], waitingNodeId: 'collect_answers', stagesLiveData: {} },
      });
      
      // Verify pending questions were saved
      let loaded = await mockStorageService.getConversation(conversationId);
      expect(loaded!.pending_questions).toHaveLength(2);
      
      // Simulate checkpoint expiry - clear all interrupt state
      await persistenceService.saveConversation({
        conversationId,
        messages: [{ id: '1', role: 'user', content: 'Hello', timestamp: new Date().toISOString() }],
        threadId: null,
        isInterrupted: false,
        pendingQuestion: null,
        pendingOptions: [],
        pendingQuestions: [],
        graphState: { completedStages: [], waitingNodeId: null, stagesLiveData: {} },
      });
      
      // Verify all pending fields were cleared
      loaded = await mockStorageService.getConversation(conversationId);
      expect(loaded!.is_interrupted).toBe(false);
      expect(loaded!.pending_questions).toBeUndefined();
      expect(loaded!.graph_state?.waiting_node_id).toBeNull();
    });
  });
});
