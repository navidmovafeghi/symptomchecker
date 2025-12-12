"""
SymptomCheckerProvider - LangGraph-based medical symptom checker implementing ILLMProvider.

This provider implements a sophisticated medical triage workflow with:
- Structured preliminary screening questions generation
- LLM-based free-text answer extraction
- Differential diagnosis with severity classification
- Iterative refinement loop with intelligent stop conditions
- Human-in-the-loop interrupts for answer collection
"""
import asyncio
import json
from typing import List, Dict, Any, AsyncIterator, Optional, Union

from langchain_core.messages import HumanMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.graph.state import CompiledStateGraph
from langgraph.types import Command

from ..domain.interfaces import ILLMProvider, ICheckpointManager
from ..domain.exceptions import LLMProviderException, CheckpointNotFoundException
from .symptom_checker_graph import build_symptom_checker_graph


def encode_options(question: str, options: List[str]) -> str:
    """Encode question and options using the __OPTIONS__ delimiter format.
    
    Args:
        question: The question text
        options: List of option strings
        
    Returns:
        Encoded string with format: "{question}\n__OPTIONS__:{json_array}"
    """
    return f"{question}\n__OPTIONS__:{json.dumps(options)}"


class SymptomCheckerProvider(ILLMProvider, ICheckpointManager):
    """Medical symptom checker using LangGraph workflow.
    
    Implements the ILLMProvider and ICheckpointManager interfaces with support for:
    - Structured screening questions with answer options
    - Differential diagnosis generation
    - Iterative refinement loop
    - Human-in-the-loop interrupts
    - SQLite-based checkpointing for state persistence
    - Checkpoint management for cleanup on conversation deletion
    
    Attributes:
        api_key: OpenAI API key
        checkpoint_db_path: Path to SQLite database for checkpointing
        model_name: Name of the OpenAI model to use
        temperature: Temperature for LLM responses
    """

    def __init__(
        self,
        api_key: str,
        checkpoint_db_path: str = "checkpoints.db",
        model_name: str = "gpt-5.1",
        temperature: float = 0.3,
        reasoning_effort: str = "medium",
    ):
        """Initialize the SymptomCheckerProvider.
        
        Args:
            api_key: OpenAI API key
            checkpoint_db_path: Path to SQLite database for checkpointing
            model_name: Name of the OpenAI model to use (default: gpt-5.1)
            temperature: Temperature for LLM responses
            reasoning_effort: Reasoning effort for reasoning models (none, low, medium, high)
        """
        self.api_key = api_key
        self.checkpoint_db_path = checkpoint_db_path
        self.model_name = model_name
        self.temperature = temperature
        self.reasoning_effort = reasoning_effort
        
        # Lazy initialization - these are set on first use
        self._graph: CompiledStateGraph | None = None
        self._checkpointer: AsyncSqliteSaver | None = None
        self._checkpointer_cm = None  # Context manager for cleanup
        self._initialized: bool = False
        self._lock: asyncio.Lock = asyncio.Lock()

    async def _ensure_initialized(self) -> None:
        """Ensure checkpointer and graph are initialized (thread-safe).
        
        Uses double-checked locking pattern to ensure initialization happens
        only once, even with concurrent requests.
        
        Raises:
            LLMProviderException: If initialization fails
        """
        if self._initialized:
            return
        
        async with self._lock:
            if self._initialized:  # Double-check after acquiring lock
                return
            
            try:
                # Initialize checkpointer with proper async context
                # from_conn_string returns a context manager, __aenter__ returns the actual saver
                checkpointer_cm = AsyncSqliteSaver.from_conn_string(self.checkpoint_db_path)
                self._checkpointer = await checkpointer_cm.__aenter__()
                self._checkpointer_cm = checkpointer_cm  # Store context manager for cleanup
                
                # Build and compile graph once with the initialized checkpointer
                self._graph = build_symptom_checker_graph(
                    api_key=self.api_key,
                    model_name=self.model_name,
                    temperature=self.temperature,
                    reasoning_effort=self.reasoning_effort,
                    checkpointer=self._checkpointer,
                )
                self._initialized = True
            except Exception as e:
                # Clean up on failure
                if hasattr(self, '_checkpointer_cm') and self._checkpointer_cm is not None:
                    try:
                        await self._checkpointer_cm.__aexit__(None, None, None)
                    except Exception:
                        pass
                    self._checkpointer_cm = None
                self._checkpointer = None
                self._graph = None
                raise LLMProviderException(f"Failed to initialize SymptomCheckerProvider: {str(e)}")

    async def cleanup(self) -> None:
        """Clean up resources (call on application shutdown).
        
        Properly closes the checkpointer connection and resets state variables.
        Safe to call multiple times.
        """
        async with self._lock:
            if hasattr(self, '_checkpointer_cm') and self._checkpointer_cm is not None:
                try:
                    await self._checkpointer_cm.__aexit__(None, None, None)
                except Exception:
                    pass  # Ignore cleanup errors
                self._checkpointer_cm = None
            self._checkpointer = None
            self._graph = None
            self._initialized = False

    async def generate_response(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> str:
        """Generate a non-streaming response.
        
        Invokes the graph and returns the final summary content.
        Note: This method runs the entire workflow synchronously, which may
        not be ideal for the interrupt-based design. Use generate_response_stream
        for proper interrupt handling.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            thread_id: Optional thread ID for state persistence
            
        Returns:
            Complete response as a single string
            
        Raises:
            LLMProviderException: If an error occurs during generation
        """
        result = ""
        async for chunk in self.generate_response_stream(messages, thread_id):
            result += chunk
        return result

    async def generate_response_stream(
        self, messages: List[dict], thread_id: Optional[str] = None
    ) -> AsyncIterator[str]:
        """Generate streaming response with interrupt support.
        
        Handles LangGraph interrupts by encoding questions with the __OPTIONS__
        format for frontend compatibility.
        
        Args:
            messages: List of message dicts with 'role' and 'content'
            thread_id: Optional thread ID for state persistence
            
        Yields:
            Response chunks (may include __OPTIONS__ encoding for questions)
            
        Raises:
            LLMProviderException: If an error occurs during generation
        """
        # Handle empty message list gracefully
        if not messages:
            yield "Hello! I'm a medical symptom checker. Please describe your symptoms and I'll help assess them."
            return
        
        try:
            # Ensure lazy initialization is complete before using graph
            await self._ensure_initialized()
            # Extract the last user message as the symptom input
            last_user_message = None
            for msg in reversed(messages):
                if msg.get("role") == "user":
                    last_user_message = msg.get("content", "")
                    break
            
            if not last_user_message:
                yield "Please describe your symptoms so I can help assess them."
                return
            
            # Create config with thread_id for checkpointing
            config = {"configurable": {"thread_id": thread_id or "default"}}
            
            # Initialize state with the user's message
            initial_state = {
                "messages": [HumanMessage(content=last_user_message)],
                "symptom_input": "",
                "preliminary_questions": None,
                "qa_pairs": None,
                "differential_diagnosis": None,
                "refinement_qa_pairs": None,
                "current_refinement_question": None,
                "refined_ddx": None,
                "refinement_count": 0,
                "final_summary": None,
            }
            
            # Stream the graph execution
            async for event in self._graph.astream(initial_state, config, stream_mode="updates"):
                # Check for interrupt
                if "__interrupt__" in event:
                    interrupt_data = event["__interrupt__"]
                    if interrupt_data and len(interrupt_data) > 0:
                        interrupt_value = interrupt_data[0].value
                        
                        # Handle multi-question interrupt (preliminary questions)
                        if "questions" in interrupt_value:
                            yield json.dumps({
                                "type": "interrupt",
                                "questions": interrupt_value.get("questions", []),
                                "total_questions": interrupt_value.get("total_questions", 0),
                                "thread_id": thread_id or "default"
                            })
                            return
                        
                        # Handle single-question interrupt (refinement questions)
                        question = interrupt_value.get("question", "")
                        options = interrupt_value.get("options", [])
                        
                        if question and options:
                            yield json.dumps({
                                "type": "interrupt",
                                "question": question,
                                "options": options,
                                "thread_id": thread_id or "default"
                            })
                            return
                
                # Check for final summary in the event
                for node_name, node_output in event.items():
                    if node_name == "generate_final_summary" and node_output:
                        final_summary = node_output.get("final_summary")
                        if final_summary:
                            # Format the final summary as a readable response
                            response = f"""Based on our conversation, here's my assessment:

**Most Likely Diagnosis:** {final_summary.top_diagnosis}
**Confidence:** {final_summary.probability:.0%}

{final_summary.explanation}

{final_summary.disclaimer}"""
                            yield response
                            return
            
            # If we get here without yielding, something went wrong
            yield "I apologize, but I couldn't complete the assessment. Please try again."
                
        except Exception as e:
            raise LLMProviderException(f"SymptomCheckerProvider error: {str(e)}")

    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        """Resume an interrupted conversation with user's answer.
        
        Loads the checkpoint for the given thread_id and continues execution
        from the interrupt point with the user's input.
        
        Args:
            thread_id: Unique thread identifier for the conversation
            user_input: User's response to the interrupt question (can be JSON for multi-answer)
            
        Returns:
            Dict with:
            - 'type': 'interrupt' or 'complete'
            - 'question': Question text (if interrupt)
            - 'options': Answer options (if interrupt)
            - 'response': Final response (if complete)
            - 'thread_id': The thread ID
            
        Raises:
            CheckpointNotFoundException: If no checkpoint exists for thread_id
            LLMProviderException: If an error occurs during resumption
        """
        try:
            # Ensure lazy initialization is complete before using graph
            await self._ensure_initialized()
            
            config = {"configurable": {"thread_id": thread_id}}
            
            # Check if checkpoint exists
            state = await self._graph.aget_state(config)
            if state is None or state.values is None:
                raise CheckpointNotFoundException(
                    f"No checkpoint found for thread_id: {thread_id}"
                )
            
            # Parse user_input if it's JSON (for multi-answer format)
            parsed_input: Any = user_input
            try:
                parsed = json.loads(user_input)
                if isinstance(parsed, dict) and "answers" in parsed:
                    # Multi-answer format: {"answers": ["answer1", "answer2", ...]}
                    parsed_input = parsed
                elif isinstance(parsed, list):
                    # Direct array format: ["answer1", "answer2", ...]
                    parsed_input = parsed
            except (json.JSONDecodeError, TypeError):
                # Not JSON, use as-is (single answer string)
                pass
            
            # Resume with user input using Command
            resume_command = Command(resume=parsed_input)
            
            # Stream the resumed execution
            async for event in self._graph.astream(resume_command, config, stream_mode="updates"):
                # Check for another interrupt
                if "__interrupt__" in event:
                    interrupt_data = event["__interrupt__"]
                    if interrupt_data and len(interrupt_data) > 0:
                        interrupt_value = interrupt_data[0].value
                        
                        # Handle multi-question interrupt (preliminary questions)
                        if "questions" in interrupt_value:
                            return {
                                "type": "interrupt",
                                "questions": interrupt_value.get("questions", []),
                                "total_questions": interrupt_value.get("total_questions", 0),
                                "thread_id": thread_id,
                            }
                        
                        # Handle single-question interrupt (refinement questions)
                        question = interrupt_value.get("question", "")
                        options = interrupt_value.get("options", [])
                        
                        return {
                            "type": "interrupt",
                            "question": question,
                            "options": options,
                            "thread_id": thread_id,
                        }
                
                # Check for final summary
                for node_name, node_output in event.items():
                    if node_name == "generate_final_summary" and node_output:
                        final_summary = node_output.get("final_summary")
                        if final_summary:
                            response = f"""Based on our conversation, here's my assessment:

**Most Likely Diagnosis:** {final_summary.top_diagnosis}
**Confidence:** {final_summary.probability:.0%}

{final_summary.explanation}

{final_summary.disclaimer}"""
                            return {
                                "type": "complete",
                                "response": response,
                                "thread_id": thread_id,
                            }
            
            # If we get here, check the final state
            final_state = await self._graph.aget_state(config)
            if final_state and final_state.values:
                final_summary = final_state.values.get("final_summary")
                if final_summary:
                    response = f"""Based on our conversation, here's my assessment:

**Most Likely Diagnosis:** {final_summary.top_diagnosis}
**Confidence:** {final_summary.probability:.0%}

{final_summary.explanation}

{final_summary.disclaimer}"""
                    return {
                        "type": "complete",
                        "response": response,
                        "thread_id": thread_id,
                    }
            
            return {
                "type": "complete",
                "response": "Assessment complete. Please consult a healthcare provider for proper diagnosis.",
                "thread_id": thread_id,
            }
                
        except CheckpointNotFoundException:
            raise
        except Exception as e:
            raise LLMProviderException(f"SymptomCheckerProvider resume error: {str(e)}")

    async def delete_checkpoint(self, thread_id: str) -> bool:
        """Delete checkpoint data for a thread.
        
        Implements ICheckpointManager interface for checkpoint cleanup.
        
        Args:
            thread_id: The unique thread identifier for the checkpoint to delete.
            
        Returns:
            True if the checkpoint was deleted, False if it didn't exist.
        """
        try:
            # Ensure lazy initialization is complete before using checkpointer
            await self._ensure_initialized()
            
            config = {"configurable": {"thread_id": thread_id}}
            
            # Check if checkpoint exists
            state = await self._graph.aget_state(config)
            if state is None or state.values is None:
                return False
            
            # Delete the checkpoint using the checkpointer
            # The checkpointer is stored in the graph, we need to access it
            await self._checkpointer.adelete(config)
            return True
        except Exception:
            return False
