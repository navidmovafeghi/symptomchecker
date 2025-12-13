/**
 * Utility functions for graph visualization feature.
 * Provides mapping between backend stage messages and graph node IDs.
 */

import { GraphNodeId, GRAPH_NODES } from '../types/graph';

/**
 * Mapping from backend stage messages to graph node IDs.
 * These messages come from the backend's currentStageMessage field in streaming responses.
 * 
 * The backend sends stage messages in both English and Persian (Farsi).
 * We map both language variants to the same node IDs.
 */
const STAGE_TO_NODE_MAP: Record<string, GraphNodeId> = {
  // English stage messages (from backend stage_descriptions_en)
  'Preparing screening questions': 'generate_questions',
  'Processing your answers': 'collect_answers',
  'Analyzing symptoms': 'generate_ddx',
  'Preparing follow-up question': 'generate_refinement_question',
  'Collecting your response': 'collect_refinement_answer',
  'Refining diagnosis': 'refine_ddx',
  'Preparing your assessment': 'generate_final_summary',
  
  // Persian (Farsi) stage messages (from backend stage_descriptions_fa)
  'آماده‌سازی سوالات غربالگری': 'generate_questions',
  'در حال پردازش پاسخ‌های شما': 'collect_answers',
  'در حال تحلیل علائم': 'generate_ddx',
  'آماده‌سازی سوال تکمیلی': 'generate_refinement_question',
  'در حال دریافت پاسخ شما': 'collect_refinement_answer',
  'اصلاح تشخیص': 'refine_ddx',
  'آماده‌سازی ارزیابی شما': 'generate_final_summary',
};

/**
 * Maps a backend stage message to a GraphNodeId.
 * 
 * @param stageMessage - The stage message from the backend's currentStageMessage field
 * @returns The corresponding GraphNodeId, or null if the message is unknown
 * 
 * @example
 * mapStageToNode('Preparing screening questions') // returns 'generate_questions'
 * mapStageToNode('Unknown stage') // returns null and logs a warning
 */
export function mapStageToNode(stageMessage: string): GraphNodeId | null {
  // Use Object.hasOwn to avoid prototype pollution issues
  // (e.g., "toString", "valueOf" would otherwise return inherited methods)
  if (!Object.hasOwn(STAGE_TO_NODE_MAP, stageMessage)) {
    console.warn(`Unknown stage message: "${stageMessage}". Unable to map to graph node.`);
    return null;
  }
  
  return STAGE_TO_NODE_MAP[stageMessage];
}

/**
 * Gets the status message key for a given node ID.
 * This is used to display the current action message below the graph.
 * 
 * @param nodeId - The graph node ID
 * @returns The i18n key for the node's description (used as status message)
 */
export function getNodeStatusMessageKey(nodeId: GraphNodeId): string {
  const node = GRAPH_NODES.find(n => n.id === nodeId);
  if (!node) {
    console.warn(`Unknown node ID: "${nodeId}". Unable to get status message key.`);
    return 'graph.status.processing';
  }
  return node.descriptionKey;
}

/**
 * Gets all known stage messages that can be mapped to nodes.
 * Useful for testing and validation.
 * 
 * @returns Array of all known stage message strings
 */
export function getKnownStageMessages(): string[] {
  return Object.keys(STAGE_TO_NODE_MAP);
}

/**
 * Reverse mapping from node ID to stage message.
 * Useful for testing the correspondence between active nodes and status messages.
 */
const NODE_TO_STAGE_MAP: Record<GraphNodeId, string> = Object.entries(STAGE_TO_NODE_MAP).reduce(
  (acc, [stage, nodeId]) => {
    acc[nodeId] = stage;
    return acc;
  },
  {} as Record<GraphNodeId, string>
);

/**
 * Gets the stage message for a given node ID.
 * This is the inverse of mapStageToNode.
 * 
 * @param nodeId - The graph node ID
 * @returns The corresponding stage message, or null if not found
 */
export function getStageMessageForNode(nodeId: GraphNodeId): string | null {
  return NODE_TO_STAGE_MAP[nodeId] ?? null;
}
