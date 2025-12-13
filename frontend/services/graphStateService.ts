/**
 * GraphStateService - Single source of truth for graph visualization state.
 * 
 * This service manages all graph state transitions following SOLID principles:
 * - Single Responsibility: Only manages graph visualization state
 * - Dependency Inversion: ViewModel depends on IGraphStateService interface
 * 
 * Requirements: 1.1, 12.1, 12.2
 */

import { GraphNodeId } from '@/types/graph';
import { Message, InterruptResponse } from '@/types';

/**
 * Live data accumulated for each stage during execution.
 */
export interface StageLiveData {
  question_count?: number;
  diagnosis_count?: number;
  top_diagnosis?: string;
  top_probability?: number;
  refinement_round?: number;
  [key: string]: unknown;
}

/**
 * Complete graph visualization state.
 * This is the single source of truth for all graph-related state.
 */
export interface GraphState {
  /** Currently active node in the graph */
  currentStage: GraphNodeId | null;
  
  /** Array of completed node IDs in execution order */
  completedStages: GraphNodeId[];
  
  /** Node currently waiting for user input (interrupt) */
  waitingNodeId: GraphNodeId | null;
  
  /** Live data accumulated for each stage */
  stagesLiveData: Partial<Record<GraphNodeId, StageLiveData>>;
}

/** Initial/reset state for graph visualization */
export const INITIAL_GRAPH_STATE: GraphState = {
  currentStage: null,
  completedStages: [],
  waitingNodeId: null,
  stagesLiveData: {},
};


/**
 * Ordered list of graph nodes for determining completion.
 * Used to mark all nodes up to a given node as completed.
 */
export const GRAPH_NODE_ORDER: GraphNodeId[] = [
  'generate_questions',
  'collect_answers',
  'generate_ddx',
  'generate_refinement_question',
  'collect_refinement_answer',
  'refine_ddx',
  'generate_final_summary',
];

/**
 * Service interface for graph state management logic.
 * Single Responsibility: Only manages graph visualization state transitions.
 * 
 * Requirements: 12.1, 12.2
 */
export interface IGraphStateService {
  /**
   * Process a stage event and return updated graph state.
   * Marks previous stage as completed when transitioning to new stage.
   */
  processStageEvent(
    currentState: GraphState,
    stage: GraphNodeId,
    liveData?: StageLiveData
  ): GraphState;

  /**
   * Process an interrupt event and derive the waiting node.
   * Marks all nodes up to waiting node as completed.
   */
  processInterruptEvent(
    currentState: GraphState,
    interrupt: InterruptResponse
  ): GraphState;

  /**
   * Process a complete event (workflow finished).
   * Marks all nodes including final summary as completed.
   */
  processCompleteEvent(currentState: GraphState): GraphState;

  /**
   * Derive waiting node from interrupt event type.
   * - questions array → collect_answers
   * - single question → collect_refinement_answer
   */
  deriveWaitingNode(interrupt: InterruptResponse): GraphNodeId;

  /**
   * Derive completed stages from conversation messages (backward compatibility).
   */
  deriveCompletedStagesFromMessages(messages: Message[]): GraphNodeId[];

  /**
   * Reset graph state to initial values.
   */
  resetState(): GraphState;
}

/**
 * Implementation of the GraphStateService.
 */
export class GraphStateService implements IGraphStateService {
  /**
   * Derive waiting node from interrupt event type.
   * - questions array → collect_answers
   * - single question → collect_refinement_answer
   * 
   * Requirements: 4.1, 4.2
   */
  deriveWaitingNode(interrupt: InterruptResponse): GraphNodeId {
    if (interrupt.questions && interrupt.questions.length > 0) {
      return 'collect_answers';
    }
    return 'collect_refinement_answer';
  }

  /**
   * Process a stage event and return updated graph state.
   * Marks previous stage as completed when transitioning to new stage.
   * 
   * Requirements: 1.3, 5.1, 9.2
   */
  processStageEvent(
    currentState: GraphState,
    stage: GraphNodeId,
    liveData?: StageLiveData
  ): GraphState {
    const newCompletedStages = [...currentState.completedStages];
    
    // Mark previous stage as completed if transitioning to a new stage
    if (currentState.currentStage && currentState.currentStage !== stage) {
      if (!newCompletedStages.includes(currentState.currentStage)) {
        newCompletedStages.push(currentState.currentStage);
      }
    }

    // Update stagesLiveData
    const newStagesLiveData = { ...currentState.stagesLiveData };
    if (liveData) {
      newStagesLiveData[stage] = {
        ...newStagesLiveData[stage],
        ...liveData,
      };
    }

    return {
      currentStage: stage,
      completedStages: newCompletedStages,
      waitingNodeId: null, // Clear waiting node when processing stage
      stagesLiveData: newStagesLiveData,
    };
  }

  /**
   * Process an interrupt event and derive the waiting node.
   * Marks all nodes up to waiting node as completed.
   * 
   * Requirements: 5.2
   */
  processInterruptEvent(
    currentState: GraphState,
    interrupt: InterruptResponse
  ): GraphState {
    const waitingNodeId = this.deriveWaitingNode(interrupt);
    const waitingNodeIndex = GRAPH_NODE_ORDER.indexOf(waitingNodeId);
    
    // Mark all nodes before the waiting node as completed
    const newCompletedStages = [...currentState.completedStages];
    for (let i = 0; i < waitingNodeIndex; i++) {
      const nodeId = GRAPH_NODE_ORDER[i];
      if (!newCompletedStages.includes(nodeId)) {
        newCompletedStages.push(nodeId);
      }
    }

    return {
      ...currentState,
      currentStage: null,
      completedStages: newCompletedStages,
      waitingNodeId,
    };
  }

  /**
   * Process a complete event (workflow finished).
   * Only marks nodes that actually executed as completed.
   * Uses stagesLiveData to determine which nodes ran.
   * 
   * Requirements: 5.3
   */
  processCompleteEvent(currentState: GraphState): GraphState {
    // Only mark nodes that actually executed as completed
    // Use stagesLiveData keys + any already completed stages + generate_final_summary
    const executedNodes = new Set<GraphNodeId>([
      ...currentState.completedStages,
      ...(Object.keys(currentState.stagesLiveData) as GraphNodeId[]),
      'generate_final_summary', // Always completed if we got a complete event
    ]);
    
    // Filter to only include nodes that actually ran, preserving order
    const newCompletedStages = GRAPH_NODE_ORDER.filter(node => executedNodes.has(node));

    return {
      ...currentState,
      currentStage: null,
      completedStages: newCompletedStages,
      waitingNodeId: null,
    };
  }

  /**
   * Derive completed stages from conversation messages (backward compatibility).
   * 
   * This method analyzes the conversation message patterns to infer which
   * stages have been completed. It's used for migrating conversations that
   * were saved before graph_state persistence was implemented.
   * 
   * Heuristics:
   * - If there are any assistant messages with questions, generate_questions completed
   * - If there are user responses, collect_answers completed
   * - If there are assistant messages after user responses, generate_ddx completed
   * - Multiple user-assistant exchanges suggest refinement loop stages
   * 
   * Requirements: 8.1
   */
  deriveCompletedStagesFromMessages(messages: Message[]): GraphNodeId[] {
    const completedStages: GraphNodeId[] = [];
    
    if (messages.length === 0) {
      return completedStages;
    }
    
    // Find assistant messages with questions (preliminary questions)
    const hasAssistantWithQuestions = messages.some(
      m => m.role === 'assistant' && (m.questions || m.options || m.isQuestion)
    );
    
    // If there are assistant messages with questions, generate_questions completed
    if (hasAssistantWithQuestions) {
      completedStages.push('generate_questions');
    }
    
    // Find user responses
    const userMessages = messages.filter(m => m.role === 'user');
    const hasUserResponses = userMessages.length > 0;
    
    // If there are user responses, collect_answers completed
    if (hasUserResponses) {
      completedStages.push('collect_answers');
    }
    
    // Find the first user message index
    const firstUserMessageIndex = messages.findIndex(m => m.role === 'user');
    
    if (firstUserMessageIndex >= 0) {
      // Check for assistant messages after first user response
      const messagesAfterFirstUser = messages.slice(firstUserMessageIndex + 1);
      const assistantAfterUser = messagesAfterFirstUser.filter(m => m.role === 'assistant');
      
      if (assistantAfterUser.length > 0) {
        // At least one assistant message after user response means generate_ddx completed
        completedStages.push('generate_ddx');
        
        // Check for refinement loop patterns (multiple user-assistant exchanges)
        const userMessagesAfterFirst = messagesAfterFirstUser.filter(m => m.role === 'user');
        
        if (userMessagesAfterFirst.length > 0) {
          // User responded to refinement questions
          completedStages.push('generate_refinement_question');
          completedStages.push('collect_refinement_answer');
          
          // Check if there are more assistant messages after refinement answers
          const lastUserIndex = messages.lastIndexOf(userMessagesAfterFirst[userMessagesAfterFirst.length - 1]);
          const messagesAfterLastUser = messages.slice(lastUserIndex + 1);
          const hasAssistantAfterRefinement = messagesAfterLastUser.some(m => m.role === 'assistant');
          
          if (hasAssistantAfterRefinement) {
            completedStages.push('refine_ddx');
          }
        }
      }
    }
    
    return completedStages;
  }

  /**
   * Reset graph state to initial values.
   * 
   * Requirements: 3.5, 10.2
   */
  resetState(): GraphState {
    return { ...INITIAL_GRAPH_STATE, stagesLiveData: {} };
  }

  /**
   * Derive waiting node from is_interrupted flag and messages.
   * Used for backward compatibility migration.
   * 
   * Requirements: 8.2
   */
  deriveWaitingNodeFromInterruptState(
    isInterrupted: boolean,
    messages: Message[]
  ): GraphNodeId | null {
    if (!isInterrupted) {
      return null;
    }
    
    // Check if the last assistant message has questions array (multi-question mode)
    const lastAssistantMessage = [...messages].reverse().find(m => m.role === 'assistant');
    
    if (lastAssistantMessage?.questions && lastAssistantMessage.questions.length > 0) {
      return 'collect_answers';
    }
    
    // Check if the last assistant message has single question (refinement mode)
    if (lastAssistantMessage?.options || lastAssistantMessage?.isQuestion) {
      // If we have user responses already, this is likely a refinement question
      const hasUserResponses = messages.some(m => m.role === 'user');
      if (hasUserResponses) {
        return 'collect_refinement_answer';
      }
      return 'collect_answers';
    }
    
    // Default to collect_answers if interrupted but can't determine type
    return 'collect_answers';
  }

  /**
   * Migrate a conversation without graph_state to include derived graph state.
   * This is used for backward compatibility with conversations saved before
   * graph_state persistence was implemented.
   * 
   * Requirements: 8.1, 8.2, 8.3
   */
  migrateConversationGraphState(
    messages: Message[],
    isInterrupted: boolean
  ): GraphState {
    const completedStages = this.deriveCompletedStagesFromMessages(messages);
    const waitingNodeId = this.deriveWaitingNodeFromInterruptState(isInterrupted, messages);
    
    return {
      currentStage: null,
      completedStages,
      waitingNodeId,
      stagesLiveData: {},
    };
  }
}

/** Singleton instance of the GraphStateService */
export const graphStateService = new GraphStateService();
