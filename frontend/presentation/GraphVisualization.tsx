/**
 * GraphVisualization Component
 * 
 * Displays a "Behind the Scenes" visualization panel showing the symptom checker's
 * graph execution flow. Users can see which processing stage they're currently in,
 * understand the purpose of each node, and track their progress through the workflow.
 * 
 * Now displayed as a right sidebar panel that can be toggled open/closed.
 * 
 * Updated to read graph state from Zustand store (single source of truth).
 * 
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.3, 5.2, 6.1, 6.2, 6.3
 */

'use client';

import { useLocale } from '@/contexts/LocaleContext';
import { GRAPH_NODES, GRAPH_EDGES, GraphNodeId, NodeStatus, GraphEdge } from '@/types/graph';
import { useChatViewModel } from '@/viewmodels/useChatViewModel';
import { Eye, EyeOff, ChevronLeft, ChevronRight, X } from 'lucide-react';

/** Live data from the backend for each stage */
export interface StageLiveData {
  // generate_questions
  question_count?: number;
  questions?: string[];
  symptom?: string;
  // collect_answers
  answers_collected?: number;
  // generate_ddx / refine_ddx
  diagnosis_count?: number;
  top_diagnosis?: string;
  top_probability?: number;
  // collect_refinement_answer
  refinement_round?: number;
  // refine_ddx
  refinement_count?: number;
  // generate_final_summary
  final_diagnosis?: string;
  confidence?: number;
}

export interface GraphVisualizationProps {
  /** Whether the visualization panel is expanded */
  isExpanded: boolean;
  /** Callback when the toggle button is clicked */
  onToggle: () => void;
  
  // Legacy props - kept for backward compatibility but Zustand state is preferred
  /** @deprecated Use Zustand store graphState.currentStage instead */
  currentStage?: GraphNodeId | null;
  /** @deprecated Use Zustand store graphState.completedStages instead */
  completedStages?: GraphNodeId[];
  /** @deprecated Use Zustand store graphState.stagesLiveData instead */
  liveData?: Record<string, unknown>;
  /** @deprecated Use Zustand store graphState.stagesLiveData instead */
  stagesLiveData?: Record<string, Record<string, unknown>>;
  /** @deprecated Use Zustand store isWaitingForInput instead */
  isWaitingForInput?: boolean;
  /** @deprecated Use Zustand store graphState.waitingNodeId instead */
  waitingNodeId?: GraphNodeId | null;
}

/**
 * Determines the status of a node based on current and completed stages.
 * Waiting state takes precedence over active state for interrupt nodes.
 */
export function getNodeStatus(
  nodeId: GraphNodeId,
  currentStage: GraphNodeId | null,
  completedStages: GraphNodeId[],
  isWaitingForInput: boolean = false,
  waitingNodeId: GraphNodeId | null = null
): NodeStatus {
  // Waiting state takes precedence for interrupt nodes
  if (isWaitingForInput && nodeId === waitingNodeId) {
    return 'waiting';
  }
  if (nodeId === currentStage) {
    return 'active';
  }
  if (completedStages.includes(nodeId)) {
    return 'completed';
  }
  return 'pending';
}

/**
 * GraphVisualization component displays the workflow diagram with node statuses.
 * 
 * Reads graph state from Zustand store (single source of truth).
 * Requirements: 1.1, 1.2
 */
export function GraphVisualization({
  isExpanded,
  onToggle,
  // Legacy props - kept for backward compatibility but Zustand state is preferred
  currentStage: propCurrentStage,
  completedStages: propCompletedStages,
  liveData: propLiveData,
  stagesLiveData: propStagesLiveData,
  isWaitingForInput: propIsWaitingForInput,
  waitingNodeId: propWaitingNodeId,
}: GraphVisualizationProps) {
  const { t, direction, locale } = useLocale();
  
  // Read graph state from Zustand store (single source of truth)
  // Requirements: 1.1, 1.2
  const graphState = useChatViewModel((state) => state.graphState);
  const zustandIsWaitingForInput = useChatViewModel((state) => state.isWaitingForInput);
  
  // Use Zustand state as primary source, fall back to props for backward compatibility
  const currentStage = graphState.currentStage ?? propCurrentStage ?? null;
  const completedStages = graphState.completedStages.length > 0 
    ? graphState.completedStages 
    : (propCompletedStages ?? []);
  const waitingNodeId = graphState.waitingNodeId ?? propWaitingNodeId ?? null;
  const isWaitingForInput = zustandIsWaitingForInput || (propIsWaitingForInput ?? false);
  
  // Merge stagesLiveData from Zustand and props
  const stagesLiveData = {
    ...(propStagesLiveData ?? {}),
    ...(graphState.stagesLiveData as Record<string, Record<string, unknown>>),
  };
  
  // For active node, use current stage's live data from stagesLiveData
  const liveData = currentStage 
    ? stagesLiveData[currentStage] ?? propLiveData 
    : propLiveData;
  
  // Format live data for display based on node type
  const formatLiveData = (nodeId: GraphNodeId, data?: Record<string, unknown>): string | null => {
    if (!data || Object.keys(data).length === 0) return null;
    
    const d = data as StageLiveData;
    
    switch (nodeId) {
      case 'generate_questions':
        if (d.question_count) {
          return locale === 'fa' 
            ? `${d.question_count} سوال آماده شد`
            : `${d.question_count} questions prepared`;
        }
        break;
      case 'collect_answers':
        if (d.answers_collected) {
          return locale === 'fa'
            ? `${d.answers_collected} پاسخ دریافت شد`
            : `${d.answers_collected} answers collected`;
        }
        break;
      case 'generate_ddx':
        if (d.top_diagnosis && d.top_probability !== undefined) {
          return locale === 'fa'
            ? `تشخیص اصلی: ${d.top_diagnosis} (${d.top_probability}%)`
            : `Top: ${d.top_diagnosis} (${d.top_probability}%)`;
        }
        break;
      case 'generate_refinement_question':
        // Requirements: 6.1, 6.2, 6.3 - Show refinement round
        if (d.refinement_round) {
          const isFinalRound = d.refinement_round >= 5;
          if (isFinalRound) {
            return locale === 'fa'
              ? `دور نهایی (${d.refinement_round} از 5)`
              : `Final round (${d.refinement_round} of 5)`;
          }
          return locale === 'fa'
            ? `دور ${d.refinement_round} از 5`
            : `Round ${d.refinement_round} of 5`;
        }
        break;
      case 'collect_refinement_answer':
        if (d.refinement_round) {
          // Requirements: 6.1, 6.2, 6.3 - Show "Round X of 5" and indicate final round
          const isFinalRound = d.refinement_round >= 5;
          if (isFinalRound) {
            return locale === 'fa'
              ? `دور نهایی (${d.refinement_round} از 5)`
              : `Final round (${d.refinement_round} of 5)`;
          }
          return locale === 'fa'
            ? `دور ${d.refinement_round} از 5`
            : `Round ${d.refinement_round} of 5`;
        }
        break;
      case 'refine_ddx':
        if (d.top_diagnosis && d.top_probability !== undefined) {
          // Requirements: 6.1, 6.2, 6.3 - Show refinement round with "of 5" indicator
          const round = d.refinement_round || d.refinement_count || 1;
          const isFinalRound = round >= 5;
          if (isFinalRound) {
            return locale === 'fa'
              ? `دور نهایی: ${d.top_diagnosis} (${d.top_probability}%)`
              : `Final round: ${d.top_diagnosis} (${d.top_probability}%)`;
          }
          return locale === 'fa'
            ? `دور ${round} از 5: ${d.top_diagnosis} (${d.top_probability}%)`
            : `Round ${round} of 5: ${d.top_diagnosis} (${d.top_probability}%)`;
        }
        break;
      case 'generate_final_summary':
        if (d.final_diagnosis && d.confidence !== undefined) {
          return locale === 'fa'
            ? `نتیجه: ${d.final_diagnosis} (${d.confidence}% اطمینان)`
            : `Result: ${d.final_diagnosis} (${d.confidence}% confidence)`;
        }
        break;
    }
    return null;
  };

  // Debug logging removed for production (Requirements: 7.1, 7.2, 7.3)

  // Get the active node for status message display
  const activeNode = currentStage 
    ? GRAPH_NODES.find(n => n.id === currentStage) 
    : null;

  // Get the waiting node for status message display
  const waitingNode = isWaitingForInput && waitingNodeId
    ? GRAPH_NODES.find(n => n.id === waitingNodeId)
    : null;

  return (
    <>
      {/* Toggle Button - Fixed position on the edge of the sidebar (always on right side) */}
      <button
        onClick={onToggle}
        className={`fixed top-1/2 -translate-y-1/2 z-40 p-2 bg-violet-600 text-white rounded-l-lg shadow-lg 
          hover:bg-violet-700 transition-all duration-300 right-0
          ${isExpanded ? 'right-80' : ''}
        `}
        aria-expanded={isExpanded}
        aria-controls="graph-panel"
        data-testid="graph-toggle-button"
        title={isExpanded ? t('graph.toggle.hide') : t('graph.toggle.show')}
      >
        {isExpanded ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
      </button>

      {/* Right Sidebar Panel (always on right side, regardless of locale) */}
      <div
        id="graph-panel"
        className={`fixed top-0 right-0 h-full w-80 bg-white/95 backdrop-blur-md shadow-xl z-30 
          transition-transform duration-300 ease-in-out overflow-y-auto
          ${isExpanded ? 'translate-x-0' : 'translate-x-full'}
        `}
        data-testid="graph-panel"
      >
        {/* Sidebar Header */}
        <div className={`sticky top-0 z-10 bg-white/95 backdrop-blur-md border-b border-gray-200 p-4 flex items-center justify-between ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
          <div className={`flex items-center gap-2 ${direction === 'rtl' ? 'flex-row-reverse' : ''}`}>
            <Eye size={18} className="text-violet-600" />
            <h2 className="font-semibold text-gray-800">{t('graph.toggle.show')}</h2>
          </div>
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Close panel"
          >
            <X size={18} />
          </button>
        </div>

        {/* Graph Container */}
        <div className={`p-4 ${direction === 'rtl' ? 'rtl' : 'ltr'}`}>
          {/* Status Message - Requirements: 3.1, 3.2, 3.3, 4.3 - Moved to top for visibility */}
          {waitingNode ? (
            <div 
              className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200"
              data-testid="graph-status-message"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full" />
                <span className="text-sm font-medium text-blue-700">
                  {t('graph.status.waiting')}
                </span>
              </div>
            </div>
          ) : activeNode && (
            <div 
              className="mb-4 p-3 bg-violet-50 rounded-xl border border-violet-200"
              data-testid="graph-status-message"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
                <span className="text-sm font-medium text-violet-700">
                  {t(activeNode.descriptionKey)}
                </span>
              </div>
            </div>
          )}

          {/* Nodes - Vertical layout for sidebar - Requirements: 2.1, 2.2, 3.1, 3.2, 3.3 */}
          <div className="space-y-3">
            {GRAPH_NODES.map((node, index) => {
              const status = getNodeStatus(node.id, currentStage, completedStages, isWaitingForInput, waitingNodeId);

              return (
                <div key={node.id} className="relative">
                  {/* Vertical Edge connector (before node, except first) */}
                  {index > 0 && (
                    <div className="absolute -top-3 left-4 w-0.5 h-3 bg-gray-300" />
                  )}

                  {/* Node */}
                  <div
                    className={`graph-node node-status-${status} relative p-3 rounded-lg border-2
                      transition-all duration-200
                      ${status === 'waiting'
                        ? 'border-blue-500 bg-blue-50 shadow-md ring-2 ring-blue-200'
                        : status === 'active' 
                          ? 'border-violet-500 bg-violet-50 shadow-md ring-2 ring-violet-200' 
                          : status === 'completed'
                            ? 'border-green-500 bg-green-50'
                            : 'border-gray-200 bg-gray-50 opacity-60'
                      }
                    `}
                    data-status={status}
                    data-node-id={node.id}
                    data-testid={`graph-node-${node.id}`}
                    role="article"
                    aria-label={`${t(node.nameKey)}: ${t(node.descriptionKey)}`}
                  >
                    {/* Status indicator */}
                    <div className={`absolute -top-1 ${direction === 'rtl' ? '-left-1' : '-right-1'} w-3 h-3 rounded-full
                      ${status === 'waiting'
                        ? 'bg-blue-500'
                        : status === 'active' 
                          ? 'bg-violet-500 animate-pulse' 
                          : status === 'completed'
                            ? 'bg-green-500'
                            : 'bg-gray-300'
                      }
                    `} />

                    {/* Node content - Requirements: 2.2 */}
                    <div className="node-content">
                      <span className={`node-name block text-sm font-semibold ${
                        status === 'waiting'
                          ? 'text-blue-700'
                          : status === 'active' 
                            ? 'text-violet-700' 
                            : status === 'completed'
                              ? 'text-green-700'
                              : 'text-gray-600'
                      }`}>
                        {t(node.nameKey)}
                      </span>
                      <span className={`node-description block text-xs mt-1 ${
                        status === 'waiting'
                          ? 'text-blue-600'
                          : status === 'active' 
                            ? 'text-violet-600' 
                            : status === 'completed'
                              ? 'text-green-600'
                              : 'text-gray-500'
                      }`}>
                        {t(node.descriptionKey)}
                      </span>
                    </div>

                    {/* Description - Shows live data when available, static description otherwise */}
                    <div
                      className={`mt-2 pt-2 border-t text-xs ${
                        status === 'waiting'
                          ? 'border-blue-200 text-blue-600'
                          : status === 'active' 
                            ? 'border-violet-200 text-violet-600' 
                            : status === 'completed'
                              ? 'border-green-200 text-green-600'
                              : 'border-gray-200 text-gray-500'
                      }`}
                      data-testid={`description-${node.id}`}
                    >
                      {/* Show live data for active or completed nodes */}
                      {(() => {
                        // For active node, use current liveData
                        if (status === 'active' && liveData) {
                          const formatted = formatLiveData(node.id, liveData);
                          if (formatted) return <span className="font-medium">{formatted}</span>;
                        }
                        // For completed nodes, use accumulated stagesLiveData
                        if (status === 'completed' && stagesLiveData?.[node.id]) {
                          const stageData = stagesLiveData[node.id];
                          const formatted = formatLiveData(node.id, stageData);
                          if (formatted) return <span className="font-medium">{formatted}</span>;
                        }
                        // Fallback to static description
                        return t(node.tooltipKey);
                      })()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend - Requirements: 2.4, 4.1, 4.2 */}
          <div className="mt-6 pt-4 border-t border-gray-200">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">{t('graph.status.processing')}</h3>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-violet-500 animate-pulse" />
                <span className="text-gray-600">{t('graph.status.active')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-500" />
                <span className="text-gray-600">{t('graph.status.waiting')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-gray-600">{t('graph.status.completed')}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-gray-300" />
                <span className="text-gray-600">{t('graph.status.pending')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Overlay for mobile when sidebar is open */}
      {isExpanded && (
        <div
          className="fixed inset-0 bg-black/20 z-20 md:hidden"
          onClick={onToggle}
        />
      )}
    </>
  );
}

/**
 * EdgeConnector component renders directional connections between nodes.
 * Requirements: 2.3, 2.4
 */
interface EdgeConnectorProps {
  edge: GraphEdge | undefined;
  direction: 'ltr' | 'rtl';
  className?: string;
}

function EdgeConnector({ edge, direction, className = '' }: EdgeConnectorProps) {
  if (!edge) return null;

  const isConditional = edge.isConditional;

  return (
    <div 
      className={`edge-connector flex items-center mx-1 ${className}`}
      data-from={edge.from}
      data-to={edge.to}
      data-conditional={isConditional}
    >
      <div className={`w-6 h-0.5 ${
        isConditional 
          ? 'border-t-2 border-dashed border-amber-400' 
          : 'bg-gray-300'
      }`} />
      <div className={`w-0 h-0 border-t-4 border-b-4 border-transparent ${
        direction === 'rtl'
          ? `border-r-4 ${isConditional ? 'border-r-amber-400' : 'border-r-gray-300'}`
          : `border-l-4 ${isConditional ? 'border-l-amber-400' : 'border-l-gray-300'}`
      }`} />
    </div>
  );
}

export default GraphVisualization;
