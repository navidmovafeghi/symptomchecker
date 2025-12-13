/**
 * Property-based tests for GraphStateService.
 * Tests the core graph state management logic.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  GraphStateService,
  GraphState,
  INITIAL_GRAPH_STATE,
  GRAPH_NODE_ORDER,
  StageLiveData,
} from '../../services/graphStateService';
import { GraphNodeId } from '../../types/graph';
import { InterruptResponse, QuestionWithOptions, Message } from '../../types';

// Create service instance for testing
const graphStateService = new GraphStateService();

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

// Arbitrary for StageLiveData
const stageLiveDataArb: fc.Arbitrary<StageLiveData> = fc.record({
  question_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  diagnosis_count: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
  top_diagnosis: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  top_probability: fc.option(fc.float({ min: 0, max: 1 }), { nil: undefined }),
  refinement_round: fc.option(fc.integer({ min: 1, max: 5 }), { nil: undefined }),
});

// Arbitrary for valid GraphState
const graphStateArb: fc.Arbitrary<GraphState> = fc.record({
  currentStage: fc.option(graphNodeIdArb, { nil: null }),
  completedStages: fc.array(graphNodeIdArb, { maxLength: 7 }).map(stages => {
    // Ensure unique stages
    return [...new Set(stages)];
  }),
  waitingNodeId: fc.option(graphNodeIdArb, { nil: null }),
  stagesLiveData: fc.dictionary(
    graphNodeIdArb,
    stageLiveDataArb
  ) as fc.Arbitrary<Partial<Record<GraphNodeId, StageLiveData>>>,
});

// Arbitrary for QuestionWithOptions
const questionWithOptionsArb: fc.Arbitrary<QuestionWithOptions> = fc.record({
  question: fc.string({ minLength: 1, maxLength: 200 }),
  options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 4 }),
  question_number: fc.nat({ max: 5 }),
});

// Arbitrary for multi-question interrupt (preliminary questions)
const multiQuestionInterruptArb: fc.Arbitrary<InterruptResponse> = fc.record({
  type: fc.constant('interrupt' as const),
  questions: fc.array(questionWithOptionsArb, { minLength: 1, maxLength: 5 }),
  total_questions: fc.nat({ max: 5 }),
  thread_id: fc.uuid(),
});

// Arbitrary for single-question interrupt (refinement questions)
const singleQuestionInterruptArb: fc.Arbitrary<InterruptResponse> = fc.record({
  type: fc.constant('interrupt' as const),
  question: fc.string({ minLength: 1, maxLength: 200 }),
  options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 4 }),
  thread_id: fc.uuid(),
});

// Use integer timestamps to avoid Invalid Date errors during shrinking
const validDateArb = fc.integer({ min: 1577836800000, max: 1924905600000 }) // 2020-01-01 to 2030-12-31
  .map(ts => new Date(ts).toISOString());

// Arbitrary for generating messages with questions (assistant with questions)
const assistantMessageWithQuestionsArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: fc.constant('assistant' as const),
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: validDateArb,
  questions: fc.array(
    fc.record({
      question: fc.string({ minLength: 1, maxLength: 200 }),
      options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 4 }),
      question_number: fc.nat({ max: 5 }),
    }),
    { minLength: 1, maxLength: 5 }
  ),
});

// Arbitrary for generating user messages
const userMessageArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: fc.constant('user' as const),
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: validDateArb,
});

// Arbitrary for generating assistant messages without questions
const assistantMessageArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: fc.constant('assistant' as const),
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: validDateArb,
});

// Arbitrary for generating assistant messages with single question (refinement)
const assistantMessageWithSingleQuestionArb: fc.Arbitrary<Message> = fc.record({
  id: fc.uuid(),
  role: fc.constant('assistant' as const),
  content: fc.string({ minLength: 1, maxLength: 500 }),
  timestamp: validDateArb,
  options: fc.array(fc.string({ minLength: 1, maxLength: 50 }), { minLength: 2, maxLength: 4 }),
  isQuestion: fc.constant(true),
});

describe('GraphStateService', () => {
  /**
   * **Feature: graph-visualization-fixes, Property 3: Waiting Node Derivation**
   * **Validates: Requirements 1.4, 4.1, 4.2**
   * 
   * For any interrupt event, the ViewModel SHALL derive the waiting node as follows:
   * - if the interrupt contains a `questions` array, waitingNodeId SHALL be `collect_answers`
   * - if it contains a single `question` field, waitingNodeId SHALL be `collect_refinement_answer`
   */
  describe('Property 3: Waiting Node Derivation', () => {
    it('returns collect_answers when interrupt has questions array', () => {
      fc.assert(
        fc.property(
          multiQuestionInterruptArb,
          (interrupt) => {
            const waitingNode = graphStateService.deriveWaitingNode(interrupt);
            expect(waitingNode).toBe('collect_answers');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns collect_refinement_answer when interrupt has single question', () => {
      fc.assert(
        fc.property(
          singleQuestionInterruptArb,
          (interrupt) => {
            const waitingNode = graphStateService.deriveWaitingNode(interrupt);
            expect(waitingNode).toBe('collect_refinement_answer');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: graph-visualization-fixes, Property 8: Stage Completion Tracking**
   * **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
   * 
   * For any stage transition from node A to node B, node A SHALL be added to completedStages.
   * For any interrupt event, all nodes up to and including the node before the waiting node SHALL be marked as completed.
   * For any complete event, all nodes including generate_final_summary SHALL be marked as completed.
   */
  describe('Property 8: Stage Completion Tracking', () => {
    it('marks previous stage as completed when transitioning to new stage', () => {
      fc.assert(
        fc.property(
          graphStateArb,
          graphNodeIdArb,
          graphNodeIdArb.filter(n => n !== 'generate_questions'), // Ensure different from first
          (initialState, firstStage, secondStage) => {
            // Skip if stages are the same
            if (firstStage === secondStage) return true;
            
            // Process first stage
            const afterFirst = graphStateService.processStageEvent(
              initialState,
              firstStage
            );
            
            // Process second stage
            const afterSecond = graphStateService.processStageEvent(
              afterFirst,
              secondStage
            );
            
            // First stage should now be in completedStages
            expect(afterSecond.completedStages).toContain(firstStage);
            expect(afterSecond.currentStage).toBe(secondStage);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('marks all nodes up to waiting node as completed on interrupt', () => {
      fc.assert(
        fc.property(
          graphStateArb,
          fc.oneof(multiQuestionInterruptArb, singleQuestionInterruptArb),
          (initialState, interrupt) => {
            const result = graphStateService.processInterruptEvent(initialState, interrupt);
            const waitingNode = graphStateService.deriveWaitingNode(interrupt);
            const waitingIndex = GRAPH_NODE_ORDER.indexOf(waitingNode);
            
            // All nodes before waiting node should be completed
            for (let i = 0; i < waitingIndex; i++) {
              expect(result.completedStages).toContain(GRAPH_NODE_ORDER[i]);
            }
            
            // Waiting node should be set
            expect(result.waitingNodeId).toBe(waitingNode);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('marks only executed nodes as completed on complete event', () => {
      fc.assert(
        fc.property(
          graphStateArb,
          (initialState) => {
            const result = graphStateService.processCompleteEvent(initialState);
            
            // Only nodes that were in completedStages, stagesLiveData, or generate_final_summary should be completed
            const expectedExecutedNodes = new Set([
              ...initialState.completedStages,
              ...Object.keys(initialState.stagesLiveData),
              'generate_final_summary', // Always added on complete
            ]);
            
            // All expected nodes should be in completedStages
            for (const nodeId of expectedExecutedNodes) {
              expect(result.completedStages).toContain(nodeId);
            }
            
            // No unexpected nodes should be in completedStages
            for (const nodeId of result.completedStages) {
              expect(expectedExecutedNodes.has(nodeId)).toBe(true);
            }
            
            // Current stage and waiting node should be cleared
            expect(result.currentStage).toBeNull();
            expect(result.waitingNodeId).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Feature: graph-visualization-fixes, Property 9: Backward Compatibility Migration**
   * **Validates: Requirements 8.1, 8.2, 8.3**
   * 
   * For any conversation loaded from IndexedDB that lacks graph_state, the ViewModel SHALL
   * derive completedStages from conversation messages and waitingNodeId from the is_interrupted flag.
   */
  describe('Property 9: Backward Compatibility Migration', () => {
    it('derives generate_questions as completed when assistant has questions', () => {
      fc.assert(
        fc.property(
          assistantMessageWithQuestionsArb,
          (assistantMsg) => {
            const messages: Message[] = [assistantMsg];
            const completedStages = graphStateService.deriveCompletedStagesFromMessages(messages);
            
            // generate_questions should be completed when there are assistant messages with questions
            expect(completedStages).toContain('generate_questions');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('derives collect_answers as completed when user has responded', () => {
      fc.assert(
        fc.property(
          assistantMessageWithQuestionsArb,
          userMessageArb,
          (assistantMsg, userMsg) => {
            const messages: Message[] = [assistantMsg, userMsg];
            const completedStages = graphStateService.deriveCompletedStagesFromMessages(messages);
            
            // collect_answers should be completed when there are user responses
            expect(completedStages).toContain('collect_answers');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('derives generate_ddx as completed when assistant responds after user', () => {
      fc.assert(
        fc.property(
          assistantMessageWithQuestionsArb,
          userMessageArb,
          assistantMessageArb,
          (firstAssistant, userMsg, secondAssistant) => {
            const messages: Message[] = [firstAssistant, userMsg, secondAssistant];
            const completedStages = graphStateService.deriveCompletedStagesFromMessages(messages);
            
            // generate_ddx should be completed when assistant responds after user
            expect(completedStages).toContain('generate_ddx');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('derives waiting node from is_interrupted flag with multi-question', () => {
      fc.assert(
        fc.property(
          assistantMessageWithQuestionsArb,
          (assistantMsg) => {
            const messages: Message[] = [assistantMsg];
            const waitingNode = graphStateService.deriveWaitingNodeFromInterruptState(true, messages);
            
            // When interrupted with questions array, waiting node should be collect_answers
            expect(waitingNode).toBe('collect_answers');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('derives waiting node from is_interrupted flag with single question after user response', () => {
      fc.assert(
        fc.property(
          assistantMessageWithQuestionsArb,
          userMessageArb,
          assistantMessageWithSingleQuestionArb,
          (firstAssistant, userMsg, refinementAssistant) => {
            const messages: Message[] = [firstAssistant, userMsg, refinementAssistant];
            const waitingNode = graphStateService.deriveWaitingNodeFromInterruptState(true, messages);
            
            // When interrupted with single question after user response, waiting node should be collect_refinement_answer
            expect(waitingNode).toBe('collect_refinement_answer');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('returns null waiting node when not interrupted', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(assistantMessageArb, userMessageArb), { minLength: 0, maxLength: 5 }),
          (messages) => {
            const waitingNode = graphStateService.deriveWaitingNodeFromInterruptState(false, messages);
            
            // When not interrupted, waiting node should be null
            expect(waitingNode).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('migrateConversationGraphState produces valid graph state', () => {
      fc.assert(
        fc.property(
          fc.array(fc.oneof(assistantMessageWithQuestionsArb, userMessageArb, assistantMessageArb), { minLength: 0, maxLength: 10 }),
          fc.boolean(),
          (messages, isInterrupted) => {
            const graphState = graphStateService.migrateConversationGraphState(messages, isInterrupted);
            
            // Graph state should have valid structure
            expect(graphState.currentStage).toBeNull();
            expect(Array.isArray(graphState.completedStages)).toBe(true);
            expect(typeof graphState.stagesLiveData).toBe('object');
            
            // If interrupted, waiting node should be set
            if (isInterrupted) {
              expect(graphState.waitingNodeId).not.toBeNull();
            }
            
            // All completed stages should be valid GraphNodeIds
            for (const stage of graphState.completedStages) {
              expect(GRAPH_NODE_ORDER).toContain(stage);
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
