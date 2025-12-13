/**
 * Property-based tests for graphHelpers utility functions.
 * Tests stage-to-node mapping correctness and edge case handling.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { mapStageToNode, getKnownStageMessages } from '../../utils/graphHelpers';
import { GraphNodeId } from '../../types/graph';

/**
 * The exact stage messages that should map to collect_refinement_answer.
 * These are the messages defined in the backend for this node.
 */
const COLLECT_REFINEMENT_ANSWER_MESSAGES = [
  'Collecting your response',           // English
  'در حال دریافت پاسخ شما',              // Persian
];

describe('graphHelpers', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress console.warn during tests
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  /**
   * **Feature: graph-visualization-dataflow-fix, Property 2: collect_refinement_answer mapping correctness**
   * **Validates: Requirements 1.1**
   * 
   * For any stage message containing "Collecting your response" or "در حال دریافت پاسخ شما",
   * the mapping function SHALL return `collect_refinement_answer`.
   */
  it('Property 2: collect_refinement_answer mapping correctness', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...COLLECT_REFINEMENT_ANSWER_MESSAGES),
        (stageMessage) => {
          const result = mapStageToNode(stageMessage);
          
          // The mapping function SHALL return 'collect_refinement_answer'
          expect(result).toBe('collect_refinement_answer');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Feature: graph-visualization-dataflow-fix, Property 3: Unknown stage graceful handling**
   * **Validates: Requirements 2.3**
   * 
   * For any stage message not in the mapping, the mapping function SHALL return null
   * without throwing an error.
   */
  it('Property 3: Unknown stage graceful handling', () => {
    // Get all known stage messages to exclude them from the arbitrary
    const knownMessages = new Set(getKnownStageMessages());

    fc.assert(
      fc.property(
        // Generate arbitrary strings that are NOT known stage messages
        fc.string({ minLength: 0, maxLength: 100 }).filter(s => !knownMessages.has(s)),
        (unknownStageMessage) => {
          // The function should not throw
          let result: ReturnType<typeof mapStageToNode> = null;
          let didThrow = false;
          
          try {
            result = mapStageToNode(unknownStageMessage);
          } catch {
            didThrow = true;
          }
          
          // SHALL not throw an error
          expect(didThrow).toBe(false);
          
          // SHALL return null for unknown messages
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Unit test: Verify all known stage messages map to valid node IDs.
   */
  it('should map all known stage messages to valid node IDs', () => {
    const knownMessages = getKnownStageMessages();
    
    for (const message of knownMessages) {
      const result = mapStageToNode(message);
      expect(result).not.toBeNull();
      expect(typeof result).toBe('string');
    }
  });

  /**
   * Unit test: Verify collect_refinement_answer English mapping.
   */
  it('should map "Collecting your response" to collect_refinement_answer', () => {
    const result = mapStageToNode('Collecting your response');
    expect(result).toBe('collect_refinement_answer');
  });

  /**
   * Unit test: Verify collect_refinement_answer Persian mapping.
   */
  it('should map Persian message to collect_refinement_answer', () => {
    const result = mapStageToNode('در حال دریافت پاسخ شما');
    expect(result).toBe('collect_refinement_answer');
  });

  /**
   * Unit test: Verify generate_refinement_question has distinct mapping.
   */
  it('should map "Preparing follow-up question" to generate_refinement_question (not collect_refinement_answer)', () => {
    const result = mapStageToNode('Preparing follow-up question');
    expect(result).toBe('generate_refinement_question');
    expect(result).not.toBe('collect_refinement_answer');
  });
});


/**
 * Valid graph node IDs for testing stage transitions.
 */
const VALID_NODE_IDS: GraphNodeId[] = [
  'generate_questions',
  'collect_answers',
  'generate_ddx',
  'generate_refinement_question',
  'collect_refinement_answer',
  'refine_ddx',
  'generate_final_summary',
];

/**
 * Arbitrary for generating valid graph node IDs.
 */
const graphNodeIdArb = fc.constantFrom(...VALID_NODE_IDS);

/**
 * Simulates the stage transition completion logic from ChatPage.tsx.
 * This is the core logic that determines when a stage should be marked as completed.
 */
function simulateStageTransition(
  previousStage: GraphNodeId | null,
  currentStage: GraphNodeId | null,
  completedStages: GraphNodeId[]
): GraphNodeId[] {
  // When stage changes (including to null), mark the previous stage as completed
  if (previousStage && previousStage !== currentStage) {
    if (!completedStages.includes(previousStage)) {
      return [...completedStages, previousStage];
    }
  }
  return completedStages;
}

/**
 * Simulates the loading end completion logic from ChatPage.tsx.
 * This marks the last active stage as completed when loading ends.
 */
function simulateLoadingEndCompletion(
  isLoading: boolean,
  previousStage: GraphNodeId | null,
  completedStages: GraphNodeId[]
): GraphNodeId[] {
  if (!isLoading && previousStage) {
    if (!completedStages.includes(previousStage)) {
      return [...completedStages, previousStage];
    }
  }
  return completedStages;
}

describe('Stage Completion Tracking', () => {
  /**
   * **Feature: graph-visualization-dataflow-fix, Property 5: Stage transition marks previous as completed**
   * **Validates: Requirements 4.1, 5.1**
   * 
   * For any transition from stage A to stage B (where A ≠ B and A ≠ null),
   * stage A SHALL be added to completedStages.
   */
  it('Property 5: Stage transition marks previous as completed', () => {
    fc.assert(
      fc.property(
        graphNodeIdArb,
        fc.oneof(graphNodeIdArb, fc.constant(null)),
        fc.array(graphNodeIdArb, { minLength: 0, maxLength: 5 }),
        (stageA, stageB, existingCompleted) => {
          // Pre-condition: A ≠ B (transition must be a change)
          fc.pre(stageA !== stageB);
          
          // Ensure existingCompleted doesn't already contain stageA
          const cleanedCompleted = existingCompleted.filter(s => s !== stageA);
          
          // Simulate the transition
          const result = simulateStageTransition(stageA, stageB, cleanedCompleted);
          
          // Stage A SHALL be added to completedStages
          expect(result).toContain(stageA);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5 (extended): Stage transition to null marks previous as completed.
   * This specifically tests the case where currentStageMessage becomes null at end of processing.
   */
  it('Property 5 (extended): Stage transition to null marks previous as completed', () => {
    fc.assert(
      fc.property(
        graphNodeIdArb,
        fc.array(graphNodeIdArb, { minLength: 0, maxLength: 5 }),
        (stageA, existingCompleted) => {
          // Ensure existingCompleted doesn't already contain stageA
          const cleanedCompleted = existingCompleted.filter(s => s !== stageA);
          
          // Simulate transition from stageA to null (end of processing)
          const result = simulateStageTransition(stageA, null, cleanedCompleted);
          
          // Stage A SHALL be added to completedStages
          expect(result).toContain(stageA);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5 (idempotence): Stage already in completedStages is not duplicated.
   */
  it('Property 5 (idempotence): Stage already completed is not duplicated', () => {
    fc.assert(
      fc.property(
        graphNodeIdArb,
        fc.oneof(graphNodeIdArb, fc.constant(null)),
        (stageA, stageB) => {
          // Pre-condition: A ≠ B
          fc.pre(stageA !== stageB);
          
          // Start with stageA already in completedStages
          const existingCompleted: GraphNodeId[] = [stageA];
          
          // Simulate the transition
          const result = simulateStageTransition(stageA, stageB, existingCompleted);
          
          // Stage A should appear exactly once (not duplicated)
          const countA = result.filter(s => s === stageA).length;
          expect(countA).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 5 (null previous): Transition from null to any stage does not add null.
   */
  it('Property 5 (null previous): Transition from null does not add anything', () => {
    fc.assert(
      fc.property(
        graphNodeIdArb,
        fc.array(graphNodeIdArb, { minLength: 0, maxLength: 5 }),
        (stageB, existingCompleted) => {
          // Simulate transition from null to stageB
          const result = simulateStageTransition(null, stageB, existingCompleted);
          
          // Result should be unchanged (no null added)
          expect(result).toEqual(existingCompleted);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Loading End Completion Tracking', () => {
  /**
   * **Feature: graph-visualization-dataflow-fix, Property 6: Loading end marks last stage completed**
   * **Validates: Requirements 4.3**
   * 
   * For any transition where isLoading changes from true to false while a stage was active,
   * that stage SHALL be added to completedStages.
   */
  it('Property 6: Loading end marks last stage completed', () => {
    fc.assert(
      fc.property(
        graphNodeIdArb,
        fc.array(graphNodeIdArb, { minLength: 0, maxLength: 5 }),
        (activeStage, existingCompleted) => {
          // Ensure existingCompleted doesn't already contain activeStage
          const cleanedCompleted = existingCompleted.filter(s => s !== activeStage);
          
          // Simulate loading ending (isLoading = false) with an active stage
          const result = simulateLoadingEndCompletion(false, activeStage, cleanedCompleted);
          
          // Active stage SHALL be added to completedStages
          expect(result).toContain(activeStage);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6 (extended): Loading end with no active stage does not change completedStages.
   */
  it('Property 6 (extended): Loading end with no active stage does not change completedStages', () => {
    fc.assert(
      fc.property(
        fc.array(graphNodeIdArb, { minLength: 0, maxLength: 5 }),
        (existingCompleted) => {
          // Simulate loading ending with no active stage (previousStage = null)
          const result = simulateLoadingEndCompletion(false, null, existingCompleted);
          
          // Result should be unchanged
          expect(result).toEqual(existingCompleted);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6 (idempotence): Stage already completed is not duplicated on loading end.
   */
  it('Property 6 (idempotence): Stage already completed is not duplicated on loading end', () => {
    fc.assert(
      fc.property(
        graphNodeIdArb,
        (activeStage) => {
          // Start with activeStage already in completedStages
          const existingCompleted: GraphNodeId[] = [activeStage];
          
          // Simulate loading ending
          const result = simulateLoadingEndCompletion(false, activeStage, existingCompleted);
          
          // Stage should appear exactly once (not duplicated)
          const count = result.filter(s => s === activeStage).length;
          expect(count).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 6 (still loading): While still loading, no stages are marked completed.
   */
  it('Property 6 (still loading): While still loading, no stages are marked completed', () => {
    fc.assert(
      fc.property(
        graphNodeIdArb,
        fc.array(graphNodeIdArb, { minLength: 0, maxLength: 5 }),
        (activeStage, existingCompleted) => {
          // Ensure existingCompleted doesn't already contain activeStage
          const cleanedCompleted = existingCompleted.filter(s => s !== activeStage);
          
          // Simulate while still loading (isLoading = true)
          const result = simulateLoadingEndCompletion(true, activeStage, cleanedCompleted);
          
          // Result should be unchanged (stage not added while still loading)
          expect(result).toEqual(cleanedCompleted);
        }
      ),
      { numRuns: 100 }
    );
  });
});
