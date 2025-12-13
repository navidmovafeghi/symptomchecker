/**
 * MessageSkeleton - Animated placeholder while waiting for AI response.
 * Shows stage-aware status text with shimmer effect bars.
 */

'use client';

import { Bot } from 'lucide-react';
import { useLocale, Direction } from '@/contexts/LocaleContext';

interface MessageSkeletonProps {
  /** Current processing stage message (e.g., "Preparing screening questions") */
  stageMessage?: string | null;
  /** Text direction for RTL support */
  direction?: Direction;
}

export function MessageSkeleton({ stageMessage, direction: directionProp }: MessageSkeletonProps) {
  const { t, direction: contextDirection } = useLocale();
  const direction = directionProp ?? contextDirection;
  const displayText = stageMessage || t('chat.thinking');
  
  return (
    <div className={`flex w-full animate-fade-in ${direction === 'rtl' ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[80%] gap-3 ${direction === 'rtl' ? 'flex-row-reverse' : 'flex-row'}`}>
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white">
            <Bot size={16} />
          </div>
        </div>

        {/* Skeleton content with animated border */}
        <div className="animated-border-wrapper">
          <div className="animated-border-content flex flex-col gap-3 items-center">
            {/* Stage-aware status text - Bold and prominent, centered */}
            <div className="flex items-center justify-center gap-2">
              {/* Pulsing indicator dot */}
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-600"></span>
              </span>
              <span className="thinking-text">{displayText}</span>
            </div>
            
            {/* Shimmer bars - varying widths for natural look */}
            <div className="h-3 w-64 bg-gray-200 rounded-full skeleton-shimmer" />
            <div className="h-3 w-48 bg-gray-200 rounded-full skeleton-shimmer delay-75" />
            <div className="h-3 w-56 bg-gray-200 rounded-full skeleton-shimmer delay-150" />
          </div>
        </div>
      </div>
    </div>
  );
}
