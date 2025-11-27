/**
 * API Service Layer - handles communication with backend.
 */

import {
  SendMessageRequest,
  SendMessageResponse,
  Conversation,
  ConversationListResponse,
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
   */
  async sendMessageStream(
    request: SendMessageRequest,
    onChunk: (chunk: string) => void
  ): Promise<
    | { type: 'complete'; conversationId?: string }
    | { type: 'interrupt'; question: string; options: string[]; threadId: string; conversationId?: string }
  > {
    const response = await fetch(`${this.baseUrl}/api/chat/message/stream`, {
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

        // Try to parse as JSON to detect interrupts
        try {
          const parsed = JSON.parse(buffer);
          if (parsed.type === 'interrupt') {
            // Interrupt detected!
            return {
              type: 'interrupt',
              question: parsed.question,
              options: parsed.options || [],
              threadId: parsed.thread_id,
              conversationId,
            };
          }
          buffer = ''; // Clear buffer if successfully parsed
        } catch {
          // Not valid JSON yet, keep accumulating
          // Also send as normal chunk for streaming text (skip conv_id prefix)
          if (!chunk.includes('__CONV_ID__:')) {
            onChunk(chunk);
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
   */
  async resumeConversation(
    threadId: string,
    userInput: string
  ): Promise<
    | { type: 'complete'; content: string; conversation_id: string }
    | { type: 'interrupt'; question: string; options: string[]; conversation_id: string }
  > {
    const response = await fetch(`${this.baseUrl}/api/chat/resume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        thread_id: threadId,
        user_input: userInput,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to resume conversation');
    }

    return response.json();
  }

  /**
   * Get conversation history.
   */
  async getConversation(conversationId: string): Promise<Conversation> {
    const response = await fetch(
      `${this.baseUrl}/api/chat/conversations/${conversationId}`
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to get conversation');
    }

    return response.json();
  }

  /**
   * Delete a conversation.
   */
  async deleteConversation(conversationId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/chat/conversations/${conversationId}`,
      {
        method: 'DELETE',
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to delete conversation');
    }
  }

  /**
   * List all conversations.
   */
  async listConversations(): Promise<ConversationListResponse> {
    const response = await fetch(`${this.baseUrl}/api/chat/conversations`);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || 'Failed to list conversations');
    }

    return response.json();
  }
}

export const apiService = new ApiService();
