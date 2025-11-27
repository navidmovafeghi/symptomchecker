"""LLM provider implementations - swappable adapters."""
from typing import List, AsyncIterator
from anthropic import Anthropic, AsyncAnthropic
from ..domain.interfaces import ILLMProvider
from ..domain.exceptions import LLMProviderException


class AnthropicLLMProvider(ILLMProvider):
    """Anthropic Claude implementation of LLM provider."""

    def __init__(self, api_key: str, model: str = "claude-3-5-sonnet-20241022"):
        self.client = AsyncAnthropic(api_key=api_key)
        self.model = model

    async def generate_response(self, messages: List[dict]) -> str:
        """Generate a response from Claude."""
        try:
            response = await self.client.messages.create(
                model=self.model,
                max_tokens=1024,
                messages=messages
            )
            return response.content[0].text
        except Exception as e:
            raise LLMProviderException(f"Anthropic API error: {str(e)}")

    async def generate_response_stream(
        self, messages: List[dict]
    ) -> AsyncIterator[str]:
        """Generate a streaming response from Claude."""
        try:
            async with self.client.messages.stream(
                model=self.model,
                max_tokens=1024,
                messages=messages
            ) as stream:
                async for text in stream.text_stream:
                    yield text
        except Exception as e:
            raise LLMProviderException(f"Anthropic API streaming error: {str(e)}")


# Future providers can be added here:
# class LangGraphProvider(ILLMProvider):
#     """LangGraph implementation."""
#     pass
#
# class OpenAIProvider(ILLMProvider):
#     """OpenAI implementation."""
#     pass
