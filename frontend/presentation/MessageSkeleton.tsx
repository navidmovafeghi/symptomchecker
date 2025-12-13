/**
 * MessageSkeleton - Animated placeholder while waiting for AI response.
 * Shows stage-aware status text with shimmer effect bars.
 */

'use client';

import { Bot } from 'lucide-react';

interface MessageSkeletonProps {
  /** Current processing stage message (e.g., "Preparing screening questions") */
  stageMessage?: string | null;
}

export function MessageSkeleton({ stageMessage }: MessageSkeletonProps) {
  const displayText = stageMessage || 'Thinking';
  
  return (
    <div className="flex w-full justify-start animate-fade-in">
      <div className="flex max-w-[80%] gap-3">
        {/* Avatar */}
        <div className="flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-violet-600 flex items-center justify-center text-white">
            <Bot size={16} />
          </div>
        </div>

        {/* Skeleton content */}
        <div className="flex flex-col gap-2 py-2">
          {/* Stage-aware status text */}
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <span className="thinking-text">{displayText}</span>
            <span className="thinking-dots">
              <span className="dot-bounce dot-bounce-1">.</span>
              <span className="dot-bounce dot-bounce-2">.</span>
              <span className="dot-bounce dot-bounce-3">.</span>
            </span>
          </div>
          
          {/* Shimmer bars - varying widths for natural look */}
          <div className="h-3 w-64 bg-gray-200 rounded-full skeleton-shimmer" />
          <div className="h-3 w-48 bg-gray-200 rounded-full skeleton-shimmer delay-75" />
          <div className="h-3 w-56 bg-gray-200 rounded-full skeleton-shimmer delay-150" />
        </div>
      </div>
    </div>
  );
}
