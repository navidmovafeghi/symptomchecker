/**
 * API Service Layer - handles communication with backend.
 */

import {
  SendMessageRequest,
  SendMessageResponse,
  CheckpointExpiredError,
} from '@/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class ApiService {
  private baseUrl: string;

  constructor(baseUrl: string = API_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Send a message and get response (non-streaming).
   */
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to send message');
    }

    return response.json();
  }

  /**
   * Send a message and stream the response.
   * Returns interrupt info if the LLM needs clarification.
   * 
   * @param request - The message request including optional conversation_history
   *                  for LLM context (since server doesn't store conversations)
   * @param onChunk - Callback for streaming response chunks
   * @param onStage - Optional callback for stage updates (e.g., "Preparing screening questions")
   */
  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: string) => void,
    onStage?: (stage: string, message: string) => void
  ): Promise<
    | { type: 'complete'; conversationId?: string }
    | { type: 'interrupt'; question?: string; options?: string[]; questions?: Array<{ question: string; options: string[]; question_number: number }>; totalQuestions?: number; threadId: string; conversationId?: string }
  > {
    // Build request body, including conversation_history if provided
    const requestBody: SendMessageRequest = {
      message: request.message,
      ...(request.conversation_id && { conversation_id: request.conversation_id }),
      ...(request.conversation_history && { conversation_history: request.conversation_history }),
    };

    const response = await fetch(`${this.baseUrl}/api/chat/message/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to send message');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let conversationId: string | undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Check for conversation_id prefix
        if (buffer.includes('__CONV_ID__:')) {
          const convIdMatch = buffer.match(/__CONV_ID__:(\{[^}]+\})\n?/);
          if (convIdMatch) {
            try {
              const convData = JSON.parse(convIdMatch[1]);
              conversationId = convData.conversation_id;
            } catch {
              // Ignore parse errors
            }
            // Remove the conv_id prefix from buffer
            buffer = buffer.replace(/__CONV_ID__:\{[^}]+\}\n?/, '');
          }
        }

        // Try to parse each line as JSON to detect interrupts and stage updates
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'interrupt') {
              // Interrupt detected - handle both single and multi-question formats
              if (parsed.questions) {
                // Multi-question format (preliminary questions)
                return {
                  type: 'interrupt',
                  questions: parsed.questions,
                  totalQuestions: parsed.total_questions,
                  threadId: parsed.thread_id,
                  conversationId,
                };
              } else {
                // Single question format (refinement questions)
                return {
                  type: 'interrupt',
                  question: parsed.question,
                  options: parsed.options || [],
                  threadId: parsed.thread_id,
                  conversationId,
                };
              }
            } else if (parsed.type === 'stage') {
              // Stage update - notify callback
              onStage?.(parsed.stage, parsed.message);
              continue; // Don't send stage JSON as chunk
            }
          } catch {
            // Not valid JSON, send as normal chunk for streaming text
            if (!line.includes('__CONV_ID__:')) {
              onChunk(line);
            }
          }
        }
      }
      
      // After stream ends, check if buffer contains final data
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.type === 'interrupt') {
            if (parsed.questions) {
              return {
                type: 'interrupt',
                questions: parsed.questions,
                totalQuestions: parsed.total_questions,
                threadId: parsed.thread_id,
                conversationId,
              };
            } else {
              return {
                type: 'interrupt',
                question: parsed.question,
                options: parsed.options || [],
                threadId: parsed.thread_id,
                conversationId,
              };
            }
          }
        } catch {
          // Not JSON, send as final chunk
          if (!buffer.includes('__CONV_ID__:') && !buffer.includes('"type":"stage"')) {
            onChunk(buffer);
          }
        }
      }

      return { type: 'complete', conversationId };
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Resume an interrupted conversation with user's answer.
   * 
   * @throws {CheckpointExpiredError} When the server checkpoint is missing (404)
   */
  async resumeConversation(
    threadId: string,
    userInput: string | string[]
  ): Promise<
    | { type: 'complete'; content: string; conversation_id: string }
    | { type: 'interrupt'; question?: string; options?: string[]; questions?: Array<{ question: string; options: string[]; question_number: number }>; total_questions?: number; conversation_id: string }
  > {
    // For multi-question mode, send answers as JSON array
    const userInputPayload = Array.isArray(userInput) 
      ? JSON.stringify({ answers: userInput })
      : userInput;

    const response = await fetch(`${this.baseUrl}/api/chat/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        thread_id: threadId,
        user_input: userInputPayload,
      }),
    });

    if (!response.ok) {
      // Handle checkpoint not found (expired)
      if (response.status === 404) {
        throw new CheckpointExpiredError(
          'This conversation cannot be resumed. The server session has expired.'
        );
      }
      
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to resume conversation');
    }

    return response.json();
  }

  /**
   * Resume an interrupted conversation with streaming stage indicators.
   * 
   * @param threadId - The thread ID to resume
   * @param userInput - User's answer(s) to the interrupt question
   * @param onStage - Optional callback for stage updates (e.g., "Analyzing symptoms...")
   * @throws {CheckpointExpiredError} When the server checkpoint is missing (404)
   */
  async resumeConversationStream(
    threadId: string,
    userInput: string | string[],
    onStage?: (stage: string, message: string) => void
  ): Promise<
    | { type: 'complete'; content: string; conversation_id: string }
    | { type: 'interrupt'; question?: string; options?: string[]; questions?: Array<{ question: string; options: string[]; question_number: number }>; total_questions?: number; conversation_id: string }
  > {
    // For multi-question mode, send answers as JSON array
    const userInputPayload = Array.isArray(userInput) 
      ? JSON.stringify({ answers: userInput })
      : userInput;

    const response = await fetch(`${this.baseUrl}/api/chat/resume/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        thread_id: threadId,
        user_input: userInputPayload,
      }),
    });

    if (!response.ok) {
      // Handle checkpoint not found (expired)
      if (response.status === 404) {
        throw new CheckpointExpiredError(
          'This conversation cannot be resumed. The server session has expired.'
        );
      }
      
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to resume conversation');
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // Parse each line as JSON
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (!line.trim()) continue;
          
          try {
            const parsed = JSON.parse(line);
            
            if (parsed.type === 'stage') {
              // Stage update - notify callback
              onStage?.(parsed.stage, parsed.message);
            } else if (parsed.type === 'interrupt') {
              // Interrupt - return result
              if (parsed.questions) {
                return {
                  type: 'interrupt',
                  questions: parsed.questions,
                  total_questions: parsed.total_questions,
                  conversation_id: parsed.thread_id,
                };
              } else {
                return {
                  type: 'interrupt',
                  question: parsed.question,
                  options: parsed.options || [],
                  conversation_id: parsed.thread_id,
                };
              }
            } else if (parsed.type === 'complete') {
              // Complete - return result
              return {
                type: 'complete',
                content: parsed.content,
                conversation_id: parsed.thread_id,
              };
            }
          } catch {
            // Not valid JSON, ignore
          }
        }
      }
      
      // Check remaining buffer
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.type === 'interrupt') {
            if (parsed.questions) {
              return {
                type: 'interrupt',
                questions: parsed.questions,
                total_questions: parsed.total_questions,
                conversation_id: parsed.thread_id,
              };
            } else {
              return {
                type: 'interrupt',
                question: parsed.question,
                options: parsed.options || [],
                conversation_id: parsed.thread_id,
              };
            }
          } else if (parsed.type === 'complete') {
            return {
              type: 'complete',
              content: parsed.content,
              conversation_id: parsed.thread_id,
            };
          }
        } catch {
          // Ignore parse errors
        }
      }

      // Fallback if no valid response received
      throw new Error('No valid response received from resume stream');
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Delete only the server checkpoint for a conversation.
   * The conversation data itself is stored in IndexedDB on the client.
   * This is called when deleting a conversation to clean up server resources.
   * 
   * @param conversationId - The conversation/thread ID to delete checkpoint for
   */
  async deleteCheckpoint(conversationId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/chat/checkpoints/${conversationId}`,
      {
        method: 'DELETE',
      }
    );

    // 404 is acceptable - checkpoint may already be expired/deleted
    if (!response.ok && response.status !== 404) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to delete checkpoint');
    }
  }

}

export { ApiService };
export const apiService = new ApiService();
