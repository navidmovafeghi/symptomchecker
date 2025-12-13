/**
 * Type definitions for the graph visualization feature.
 * Defines the structure of graph nodes, edges, and their states.
 */

/**
 * Unique identifiers for each node in the symptom checker graph.
 */
export type GraphNodeId =
  | 'generate_questions'
  | 'collect_answers'
  | 'generate_ddx'
  | 'generate_refinement_question'
  | 'collect_refinement_answer'
  | 'refine_ddx'
  | 'generate_final_summary';

/**
 * Possible states for a graph node during execution.
 */
export type NodeStatus = 'pending' | 'active' | 'waiting' | 'completed';

/**
 * Represents a node in the graph visualization.
 */
export interface GraphNode {
  id: GraphNodeId;
  nameKey: string;        // i18n key for node name
  descriptionKey: string; // i18n key for description
  tooltipKey: string;     // i18n key for detailed tooltip
}

/**
 * Represents a directional edge between two nodes.
 */
export interface GraphEdge {
  from: GraphNodeId;
  to: GraphNodeId;
  isConditional?: boolean; // For the refinement loop
}

/**
 * Configuration array defining all 7 nodes in the symptom checker graph.
 * Nodes are listed in their typical execution order.
 */
export const GRAPH_NODES: GraphNode[] = [
  {
    id: 'generate_questions',
    nameKey: 'graph.nodes.generateQuestions.name',
    descriptionKey: 'graph.nodes.generateQuestions.description',
    tooltipKey: 'graph.nodes.generateQuestions.tooltip',
  },
  {
    id: 'collect_answers',
    nameKey: 'graph.nodes.collectAnswers.name',
    descriptionKey: 'graph.nodes.collectAnswers.description',
    tooltipKey: 'graph.nodes.collectAnswers.tooltip',
  },
  {
    id: 'generate_ddx',
    nameKey: 'graph.nodes.generateDdx.name',
    descriptionKey: 'graph.nodes.generateDdx.description',
    tooltipKey: 'graph.nodes.generateDdx.tooltip',
  },
  {
    id: 'generate_refinement_question',
    nameKey: 'graph.nodes.refinementQuestion.name',
    descriptionKey: 'graph.nodes.refinementQuestion.description',
    tooltipKey: 'graph.nodes.refinementQuestion.tooltip',
  },
  {
    id: 'collect_refinement_answer',
    nameKey: 'graph.nodes.collectRefinementAnswer.name',
    descriptionKey: 'graph.nodes.collectRefinementAnswer.description',
    tooltipKey: 'graph.nodes.collectRefinementAnswer.tooltip',
  },
  {
    id: 'refine_ddx',
    nameKey: 'graph.nodes.refineDdx.name',
    descriptionKey: 'graph.nodes.refineDdx.description',
    tooltipKey: 'graph.nodes.refineDdx.tooltip',
  },
  {
    id: 'generate_final_summary',
    nameKey: 'graph.nodes.finalSummary.name',
    descriptionKey: 'graph.nodes.finalSummary.description',
    tooltipKey: 'graph.nodes.finalSummary.tooltip',
  },
];

/**
 * Configuration array defining all edges (connections) between nodes.
 * Includes conditional edges for the refinement loop.
 */
export const GRAPH_EDGES: GraphEdge[] = [
  { from: 'generate_questions', to: 'collect_answers' },
  { from: 'collect_answers', to: 'generate_ddx' },
  { from: 'generate_ddx', to: 'generate_refinement_question' },
  { from: 'generate_refinement_question', to: 'collect_refinement_answer' },
  { from: 'collect_refinement_answer', to: 'refine_ddx' },
  // Conditional edge: refinement loop back to generate more questions
  { from: 'refine_ddx', to: 'generate_refinement_question', isConditional: true },
  // Conditional edge: exit refinement loop to final summary
  { from: 'generate_refinement_question', to: 'generate_final_summary', isConditional: true },
];
