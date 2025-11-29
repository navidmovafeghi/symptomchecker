"""
Medical Chatbot Provider - LangGraph implementation with async support.
Enhanced with ambiguous input handling, mid-flow intent switching, and per-node model configuration.
Adapted from medical_chatbot_v2.py to work as a swappable ILLMProvider.
"""
import uuid
import json
from typing import List, Dict, Any, AsyncIterator, Literal, TypedDict, Annotated, Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, HumanMessage, BaseMessage
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command, interrupt

from ..domain.interfaces import ILLMProvider, ICheckpointManager
from ..domain.exceptions import LLMProviderException


# ============== MODEL CONFIGURATION ==============
# Configure which model each node uses. Nodes not listed will use "default".
# This makes it easy to swap models per node for cost/quality tradeoffs.
#
# reasoning_effort: Controls thinking depth for reasoning-capable models (gpt-5.1, o1, etc.)
#   - "none"   : No extra reasoning
#   - "low"    : Minimal structured reasoning
#   - "medium" : Balanced reasoning (default)
#   - "high"   : Deeper chains of thought
#   - "max"    : Maximum reasoning depth (slower + more expensive)

MODEL_CONFIG: Dict[str, Dict[str, Any]] = {
    "default": {
        "model": "gpt-4o-mini",
        "temperature": 0.3,
        "reasoning_effort": None,  # Not a reasoning model
    },
    "symptom_checker": {
        "model": "gpt-5.1",
        "temperature": 0.3,
        "reasoning_effort": "high",  # Needs deep diagnostic reasoning
    },
    "final_answer": {
        "model": "gpt-5.1",
        "temperature": 0.4,
        "reasoning_effort": "medium",  # Balanced for synthesis
    },
    # Add more node-specific configs as needed:
    # "intent_detector": {"model": "gpt-4o-mini", "temperature": 0.1, "reasoning_effort": None},
    # "symptom_evaluator": {"model": "gpt-5.1", "temperature": 0.2, "reasoning_effort": "low"},
}


# ============== STATE ==============
class MedicalChatState(TypedDict):
    """State for the medical chatbot."""
    messages: Annotated[list[BaseMessage], add_messages]
    intent: Literal["non_medical", "symptom_checking", "other_medical", "ambiguous"] | None
    symptom_history: list[str]
    has_enough_info: bool
    unclear_count: int
    is_early_exit: bool


# ============== HELPER FUNCTIONS ==============
def _extract_text_content(content: Any) -> str:
    """Extract text from response content (handles both string and list formats).
    
    Reasoning models return content as a list of content blocks, while
    regular models return a plain string. This helper handles both cases.
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # Extract text from content blocks
        text_parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                elif "text" in block:
                    text_parts.append(block["text"])
            elif isinstance(block, str):
                text_parts.append(block)
        return " ".join(text_parts)
    return str(content)


# ============== PROVIDER ==============
class MedicalChatbotProvider(ILLMProvider, ICheckpointManager):
    """Medical chatbot using LangGraph with human-in-the-loop interrupts.
    
    Features:
    - Intent detection (non_medical, symptom_checking, other_medical, ambiguous)
    - Multi-turn symptom gathering with clarification handling
    - Mid-flow intent switching support
    - Frustration/unclear response detection
    - Per-node model configuration with reasoning support
    - AsyncSqliteSaver for persistent state across server restarts
    - Checkpoint management for cleanup on conversation deletion
    """

    def __init__(self, api_key: str, db_path: str = "checkpoints.db"):
        """Initialize the medical chatbot provider.
        
        Args:
            api_key: OpenAI API key
            db_path: Path to SQLite database for checkpointing
        """
        self.api_key = api_key
        self.db_path = db_path
        self._model_cache: Dict[str, ChatOpenAI] = {}

    def _get_model(self, node_name: str) -> ChatOpenAI:
        """Get the configured model for a specific node.
        
        Args:
            node_name: Name of the node requesting the model
            
        Returns:
            ChatOpenAI instance configured for the node
        """
        # Return cached model if available
        if node_name in self._model_cache:
            return self._model_cache[node_name]
        
        # Get config for this node, fallback to default
        config = MODEL_CONFIG.get(node_name, MODEL_CONFIG["default"])
        
        model_kwargs: Dict[str, Any] = {
            "model": config["model"],
            "temperature": config["temperature"],
            "api_key": self.api_key,
        }
        
        # Add reasoning config for models that support it (o1, o3, gpt-5.1, etc.)
        if config.get("reasoning_effort"):
            model_kwargs["reasoning"] = {
                "effort": config["reasoning_effort"],
            }
        
        model = ChatOpenAI(**model_kwargs)
        self._model_cache[node_name] = model
        return model

    def _build_graph(self, checkpointer):
        """Build the medical chatbot graph with all nodes and edges."""
        builder = StateGraph(MedicalChatState)

        # Add all nodes
        builder.add_node("intent_detector", self._intent_detector)
        builder.add_node("clarification_node", self._clarification_node)
        builder.add_node("wait_for_clarification", self._wait_for_clarification)
        builder.add_node("non_medical_response", self._non_medical_response)
        builder.add_node("symptom_checker", self._symptom_checker)
        builder.add_node("symptom_clarification_node", self._symptom_clarification_node)
        builder.add_node("wait_for_symptom_clarification", self._wait_for_symptom_clarification)
        builder.add_node("polite_end_node", self._polite_end_node)
        builder.add_node("symptom_evaluator", self._symptom_evaluator)
        builder.add_node("wait_for_response", self._wait_for_response)
        builder.add_node("final_answer", self._final_answer)
        builder.add_node("other_medical_response", self._other_medical_response)

        # Set entry point
        builder.add_edge(START, "intent_detector")

        return builder.compile(checkpointer=checkpointer)

    # ============== NODE FUNCTIONS (ASYNC) ==============

    async def _intent_detector(self, state: MedicalChatState) -> Command[Literal[
        "non_medical_response", "symptom_checker", "other_medical_response", "clarification_node"
    ]]:
        """Detect the intent of the user's query using LLM."""
        model = self._get_model("intent_detector")
        messages = state["messages"]
        last_message = messages[-1].content if messages else ""

        intent_prompt = f"""You are an intent classifier for a medical chatbot.
Analyze the following user message and classify it into exactly one of these categories:

1. "non_medical" - Questions clearly not related to health/medicine (e.g., weather, sports, math, general chat)
2. "symptom_checking" - User describing symptoms, health complaints, or asking about what might be wrong with them
3. "other_medical" - Medical questions that are NOT about personal symptoms (e.g., drug info, general health tips, medical procedures)
4. "ambiguous" - Unclear if medical or not, vague statements like "help", "I don't feel good", "hi", single words, or messages that could go either way

User message: "{last_message}"

Respond with ONLY one word: non_medical, symptom_checking, other_medical, or ambiguous"""

        response = await model.ainvoke([HumanMessage(content=intent_prompt)])
        intent = _extract_text_content(response.content).strip().lower()

        if "non_medical" in intent:
            return Command(update={"intent": "non_medical"}, goto="non_medical_response")
        elif "symptom" in intent:
            return Command(update={"intent": "symptom_checking"}, goto="symptom_checker")
        elif "ambiguous" in intent:
            return Command(update={"intent": "ambiguous"}, goto="clarification_node")
        else:
            return Command(update={"intent": "other_medical"}, goto="other_medical_response")

    async def _clarification_node(self, state: MedicalChatState) -> Command[Literal["wait_for_clarification"]]:
        """Ask user to clarify their intent when ambiguous."""
        model = self._get_model("clarification_node")
        messages = state["messages"]
        last_message = messages[-1].content if messages else ""

        prompt = f"""You are a friendly medical assistant. The user's message was unclear:
"{last_message}"

Ask them to clarify what they need help with.

IMPORTANT: Format your response as JSON with this exact structure:
{{
  "question": "Your clarification question here",
  "options": ["Describe my symptoms", "Ask a health question", "Something else"]
}}

Keep it brief, warm, and helpful. Return ONLY the JSON, no other text."""

        response = await model.ainvoke([HumanMessage(content=prompt)])
        response_text = _extract_text_content(response.content)
        
        # Parse the JSON response
        try:
            response_data = json.loads(response_text)
            question_text = response_data.get("question", response_text)
            options = response_data.get("options", [])
            message_content = f"{question_text}\n__OPTIONS__:{json.dumps(options)}"
        except (json.JSONDecodeError, AttributeError):
            message_content = response_text
        
        return Command(
            update={"messages": [AIMessage(content=message_content)]},
            goto="wait_for_clarification"
        )

    async def _wait_for_clarification(self, state: MedicalChatState) -> Command[Literal["intent_detector"]]:
        """Wait for user's clarification response."""
        last_ai_msg = next(
            (msg for msg in reversed(state["messages"]) if isinstance(msg, AIMessage)),
            None
        )
        question = last_ai_msg.content if last_ai_msg else "Could you please clarify?"
        
        user_response = interrupt(value=question)
        return Command(
            update={"messages": [HumanMessage(content=user_response)]},
            goto="intent_detector"
        )

    async def _non_medical_response(self, state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Handle non-medical queries with a polite response."""
        model = self._get_model("non_medical_response")
        messages = state["messages"]
        last_message = messages[-1].content if messages else ""

        prompt = f"""You are a friendly medical assistant chatbot. The user has asked a non-medical question.
Politely explain that you're specialized in medical topics and can't help with this particular question.
Be warm and suggest they can ask you about health-related topics instead.

User's message: "{last_message}"

Generate a brief, polite response:"""

        response = await model.ainvoke([HumanMessage(content=prompt)])
        return Command(update={"messages": [AIMessage(content=_extract_text_content(response.content))]}, goto="__end__")

    async def _symptom_checker(self, state: MedicalChatState) -> Command[Literal[
        "symptom_evaluator", "intent_detector", "symptom_clarification_node", "polite_end_node", "final_answer"
    ]]:
        """Gather symptom information using diagnostic reasoning and detect mid-flow intent changes."""
        model = self._get_model("symptom_checker")
        messages = state["messages"]
        symptom_history = state.get("symptom_history", [])
        unclear_count = state.get("unclear_count", 0)

        conversation_context = "\n".join([
            f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {m.content}"
            for m in messages
        ])

        last_message = messages[-1].content if messages else ""

        # Analyze the user's response type
        analysis_prompt = f"""You are analyzing a user's response in a medical symptom-checking conversation.

Conversation so far:
{conversation_context}

The user's latest message: "{last_message}"

Classify this response into ONE of these categories:

1. "CONTINUATION" - The response is related to symptoms/health discussion (answering questions, adding symptom details, clarifying health info)
2. "TOPIC_SWITCH" - The user is clearly asking about something completely different (new unrelated topic, non-medical question)
3. "UNCLEAR" - Vague responses like "ok", "hmm", "I don't know", "maybe", single words that don't provide useful info
4. "EXIT" - User wants to stop/leave ("never mind", "forget it", "bye", "stop", "quit")
5. "FRUSTRATED" - User seems frustrated, giving very short unhelpful responses repeatedly, or expressing confusion/annoyance

Respond with ONLY one word: CONTINUATION, TOPIC_SWITCH, UNCLEAR, EXIT, or FRUSTRATED"""

        analysis_response = await model.ainvoke([HumanMessage(content=analysis_prompt)])
        response_type = _extract_text_content(analysis_response.content).strip().upper()

        if "EXIT" in response_type:
            return Command(goto="polite_end_node")

        if "TOPIC_SWITCH" in response_type:
            return Command(
                update={"symptom_history": [], "unclear_count": 0},
                goto="intent_detector"
            )

        if "FRUSTRATED" in response_type or unclear_count >= 2:
            return Command(
                update={"is_early_exit": True},
                goto="final_answer"
            )

        if "UNCLEAR" in response_type:
            return Command(
                update={"unclear_count": unclear_count + 1},
                goto="symptom_clarification_node"
            )

        # CONTINUATION - proceed with symptom gathering using diagnostic reasoning
        gather_prompt = f"""You are a professional medical assistant gathering symptom information using diagnostic reasoning.

Previous conversation:
{conversation_context}

Previously gathered symptom information:
{chr(10).join(symptom_history) if symptom_history else "None yet"}

Your task:
1. Based on the symptoms described, mentally consider the 3-5 most likely conditions
2. Identify what single piece of information would MOST effectively narrow down the possibilities
3. Ask ONE strategic question that maximizes diagnostic value—the answer should significantly change which conditions are more or less likely

Prioritize questions that:
- Differentiate between serious vs. non-serious causes
- Rule in or rule out specific condition categories  
- Identify red flags that would change urgency
- Have high information gain (the answer dramatically changes the probability distribution of likely conditions)

Avoid generic checklist questions when a more targeted question would be more informative.

Think step by step:
<reasoning>
- What conditions could explain these symptoms?
- What key differentiating factor am I missing?
- What question would most efficiently reduce uncertainty?
</reasoning>

IMPORTANT: Format your final response as JSON with this exact structure:
{{
  "question": "Your ONE strategic question here (do NOT include your reasoning)",
  "options": ["Option 1", "Option 2", "Option 3"]
}}

The options should be 2-4 common answers that make sense for your question.
Examples:
- For yes/no questions: ["Yes", "No"]
- For duration: ["Less than a day", "1-3 days", "More than a week"]
- For severity: ["Mild", "Moderate", "Severe"]

Be empathetic and phrase the question naturally. Return ONLY the JSON, no other text."""

        response = await model.ainvoke([HumanMessage(content=gather_prompt)])
        response_text = _extract_text_content(response.content)

        new_history = symptom_history.copy()
        if messages:
            new_history.append(f"User reported: {last_message}")

        # Parse the JSON response to extract question and options
        try:
            response_data = json.loads(response_text)
            question_text = response_data.get("question", response_text)
            options = response_data.get("options", [])
            message_content = f"{question_text}\n__OPTIONS__:{json.dumps(options)}"
        except (json.JSONDecodeError, AttributeError):
            message_content = response_text

        return Command(
            update={
                "messages": [AIMessage(content=message_content)],
                "symptom_history": new_history,
                "unclear_count": 0
            },
            goto="symptom_evaluator"
        )

    async def _symptom_clarification_node(self, state: MedicalChatState) -> Command[Literal["wait_for_symptom_clarification"]]:
        """Gently ask user to clarify when their response is unclear."""
        model = self._get_model("symptom_clarification_node")
        unclear_count = state.get("unclear_count", 0)

        if unclear_count >= 2:
            prompt = """You are a friendly medical assistant. The user has given a few unclear responses.

IMPORTANT: Format your response as JSON with this exact structure:
{
  "question": "Your gentle clarification question here",
  "options": ["Continue describing symptoms", "Get guidance now", "Start over"]
}

Be warm and not pushy. Return ONLY the JSON, no other text."""
        else:
            prompt = """You are a friendly medical assistant. The user's response wasn't clear enough to continue.

IMPORTANT: Format your response as JSON with this exact structure:
{
  "question": "Your gentle clarification question here",
  "options": ["Tell me more", "I'm not sure", "Ask something else"]
}

Be warm and understanding. Return ONLY the JSON, no other text."""

        response = await model.ainvoke([HumanMessage(content=prompt)])
        response_text = _extract_text_content(response.content)
        
        # Parse the JSON response
        try:
            response_data = json.loads(response_text)
            question_text = response_data.get("question", response_text)
            options = response_data.get("options", [])
            message_content = f"{question_text}\n__OPTIONS__:{json.dumps(options)}"
        except (json.JSONDecodeError, AttributeError):
            message_content = response_text
        
        return Command(
            update={"messages": [AIMessage(content=message_content)]},
            goto="wait_for_symptom_clarification"
        )

    async def _wait_for_symptom_clarification(self, state: MedicalChatState) -> Command[Literal["symptom_checker"]]:
        """Wait for user's clarification during symptom checking."""
        last_ai_msg = next(
            (msg for msg in reversed(state["messages"]) if isinstance(msg, AIMessage)),
            None
        )
        question = last_ai_msg.content if last_ai_msg else "Could you provide more details?"
        
        user_response = interrupt(value=question)
        return Command(
            update={"messages": [HumanMessage(content=user_response)]},
            goto="symptom_checker"
        )

    async def _polite_end_node(self, state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Handle user wanting to exit the conversation."""
        model = self._get_model("polite_end_node")
        prompt = """You are a friendly medical assistant. The user wants to end the conversation.
Give a brief, warm goodbye. Mention they can come back anytime if they have health questions.
Keep it short and friendly."""

        response = await model.ainvoke([HumanMessage(content=prompt)])
        return Command(
            update={"messages": [AIMessage(content=_extract_text_content(response.content))]},
            goto="__end__"
        )

    async def _symptom_evaluator(self, state: MedicalChatState) -> Command[Literal["final_answer", "wait_for_response"]]:
        """Evaluate if we have enough information to provide guidance."""
        model = self._get_model("symptom_evaluator")
        symptom_history = state.get("symptom_history", [])

        prompt = f"""You are a medical assessment evaluator.

Gathered symptom information:
{chr(10).join(symptom_history) if symptom_history else "None"}

Evaluate if we have ENOUGH information to provide helpful medical guidance.
We need at minimum:
- Main symptom/complaint clearly described
- Duration of the issue
- Severity indication
- At least one relevant detail (location, triggers, associated symptoms)

Respond with ONLY "yes" if we have enough information, or "no" if we need more details."""

        response = await model.ainvoke([HumanMessage(content=prompt)])
        has_enough = "yes" in _extract_text_content(response.content).strip().lower()

        if has_enough:
            return Command(update={"has_enough_info": True}, goto="final_answer")
        else:
            return Command(update={"has_enough_info": False}, goto="wait_for_response")

    async def _wait_for_response(self, state: MedicalChatState) -> Command[Literal["symptom_checker"]]:
        """Wait for user's response to the follow-up question."""
        last_ai_msg = next(
            (msg for msg in reversed(state["messages"]) if isinstance(msg, AIMessage)),
            None
        )
        question = last_ai_msg.content if last_ai_msg else "Please tell me more about your symptoms."
        
        user_response = interrupt(value=question)
        return Command(
            update={"messages": [HumanMessage(content=user_response)]},
            goto="symptom_checker"
        )

    async def _final_answer(self, state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Provide final medical guidance based on gathered symptoms."""
        model = self._get_model("final_answer")
        messages = state["messages"]
        symptom_history = state.get("symptom_history", [])
        is_early_exit = state.get("is_early_exit", False)

        conversation_context = "\n".join([
            f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {m.content}"
            for m in messages
        ])

        if is_early_exit:
            prompt = f"""You are a professional medical assistant providing guidance with LIMITED information.

Full conversation:
{conversation_context}

Gathered symptom summary:
{chr(10).join(symptom_history) if symptom_history else "Limited information available"}

The user was unable to provide complete information. Based on what little you know:
1. Summarize what you understood about their concern
2. Provide general guidance that might be helpful
3. Strongly recommend they consult a healthcare professional since you don't have enough details
4. Offer to help if they want to try again with more details

Be empathetic and understanding. Emphasize the importance of professional medical advice."""
        else:
            prompt = f"""You are a professional medical assistant providing guidance.

Full conversation:
{conversation_context}

Gathered symptom summary:
{chr(10).join(symptom_history)}

Based on all the information gathered, provide:
1. A summary of the symptoms described
2. Possible conditions this might indicate (be careful not to diagnose definitively)
3. Recommended next steps (self-care, see a doctor, urgent care, etc.)
4. Any warning signs to watch for

IMPORTANT: Always include a disclaimer that this is not a medical diagnosis and they should consult a healthcare professional for proper evaluation.

Be empathetic, professional, and thorough in your response."""

        response = await model.ainvoke([HumanMessage(content=prompt)])
        return Command(
            update={"messages": [AIMessage(content=_extract_text_content(response.content))], "is_early_exit": False},
            goto="__end__"
        )

    async def _other_medical_response(self, state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Handle general medical questions (not symptom-related)."""
        model = self._get_model("other_medical_response")
        messages = state["messages"]
        last_message = messages[-1].content if messages else ""

        prompt = f"""You are a knowledgeable medical assistant answering a general health question.

User's question: "{last_message}"

Provide a helpful, accurate, and informative response about this medical topic.
Include:
- Clear explanation of the topic
- Relevant facts and information
- Any important considerations or warnings
- Suggestion to consult a healthcare provider if appropriate

Be professional and thorough while keeping the response accessible."""

        response = await model.ainvoke([HumanMessage(content=prompt)])
        return Command(update={"messages": [AIMessage(content=_extract_text_content(response.content))]}, goto="__end__")

    # ============== ILLMProvider INTERFACE ==============

    async def generate_response(self, messages: List[dict], thread_id: Optional[str] = None) -> str:
        """Generate a non-streaming response (not typically used with interrupts)."""
        raise NotImplementedError("Use generate_response_stream for MedicalChatbotProvider")

    async def generate_response_stream(self, messages: List[dict], thread_id: Optional[str] = None) -> AsyncIterator[str]:
        """Generate streaming response with interrupt handling."""
        # Convert messages to LangChain format
        lc_messages = []
        for msg in messages:
            if msg["role"] == "user":
                lc_messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                lc_messages.append(AIMessage(content=msg["content"]))

        # Use provided thread_id or generate new one
        if thread_id is None:
            thread_id = str(uuid.uuid4())
        config = {"configurable": {"thread_id": thread_id}}

        try:
            # Use async context manager for SQLite checkpointer
            async with AsyncSqliteSaver.from_conn_string(self.db_path) as checkpointer:
                graph = self._build_graph(checkpointer)

                # Initialize state
                initial_state = {
                    "messages": lc_messages,
                    "intent": None,
                    "symptom_history": [],
                    "has_enough_info": False,
                    "unclear_count": 0,
                    "is_early_exit": False,
                }

                result = await graph.ainvoke(initial_state, config=config)

                # Check for interrupt
                if "__interrupt__" in result:
                    interrupt_info = result["__interrupt__"][0]
                    question_text = interrupt_info.value
                    options = []
                    
                    # Parse options from the question if present
                    if "__OPTIONS__:" in question_text:
                        parts = question_text.split("__OPTIONS__:")
                        question_text = parts[0].strip()
                        try:
                            options = json.loads(parts[1])
                        except (json.JSONDecodeError, IndexError):
                            options = []
                    
                    yield json.dumps({
                        "type": "interrupt",
                        "question": question_text,
                        "options": options,
                        "thread_id": thread_id
                    })
                else:
                    # Final result - yield the last AI message
                    last_message = next(
                        (msg for msg in reversed(result["messages"]) if isinstance(msg, AIMessage)),
                        None
                    )
                    if last_message:
                        yield _extract_text_content(last_message.content)
                    else:
                        yield "I apologize, but I couldn't generate a response. Please try again."

        except Exception as e:
            raise LLMProviderException(f"MedicalChatbotProvider error: {str(e)}")

    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        """Resume an interrupted conversation with user's answer.
        
        Raises:
            CheckpointNotFoundException: If the checkpoint for this thread doesn't exist.
            LLMProviderException: For other errors during resume.
        """
        from ..domain.exceptions import CheckpointNotFoundException
        
        config = {"configurable": {"thread_id": thread_id}}

        try:
            # Use async context manager for SQLite checkpointer
            async with AsyncSqliteSaver.from_conn_string(self.db_path) as checkpointer:
                graph = self._build_graph(checkpointer)
                
                # Check if checkpoint exists before attempting resume
                checkpoints = [c async for c in checkpointer.alist(config)]
                if not checkpoints:
                    raise CheckpointNotFoundException(
                        f"Checkpoint for thread {thread_id} not found. The session may have expired."
                    )

                result = await graph.ainvoke(
                    Command(resume=user_input),
                    config=config
                )

                # Check for another interrupt or final result
                if "__interrupt__" in result:
                    interrupt_info = result["__interrupt__"][0]
                    question_text = interrupt_info.value
                    options = []
                    
                    # Parse options from the question if present
                    if "__OPTIONS__:" in question_text:
                        parts = question_text.split("__OPTIONS__:")
                        question_text = parts[0].strip()
                        try:
                            options = json.loads(parts[1])
                        except (json.JSONDecodeError, IndexError):
                            options = []
                    
                    return {
                        "type": "interrupt",
                        "question": question_text,
                        "options": options
                    }
                else:
                    last_message = next(
                        (msg for msg in reversed(result["messages"]) if isinstance(msg, AIMessage)),
                        None
                    )
                    content = _extract_text_content(last_message.content) if last_message else "Conversation completed."
                    return {
                        "type": "complete",
                        "content": content,
                        "intent": result.get("intent")
                    }

        except Exception as e:
            raise LLMProviderException(f"MedicalChatbotProvider resume error: {str(e)}")

    # ============== ICheckpointManager INTERFACE ==============

    async def delete_checkpoint(self, thread_id: str) -> bool:
        """Delete checkpoint data for a thread.
        
        Args:
            thread_id: The unique thread identifier for the checkpoint to delete.
            
        Returns:
            True if the checkpoint was deleted, False if it didn't exist.
        """
        try:
            async with AsyncSqliteSaver.from_conn_string(self.db_path) as checkpointer:
                # Check if checkpoint exists first by trying to list checkpoints for this thread
                config = {"configurable": {"thread_id": thread_id}}
                checkpoints = [c async for c in checkpointer.alist(config)]
                
                if not checkpoints:
                    return False
                
                # Delete all checkpoints for this thread
                # The checkpointer stores data in tables: checkpoints, checkpoint_writes, checkpoint_blobs
                # We need to delete from all related tables
                conn = checkpointer.conn
                await conn.execute(
                    "DELETE FROM checkpoints WHERE thread_id = ?",
                    (thread_id,)
                )
                await conn.execute(
                    "DELETE FROM checkpoint_writes WHERE thread_id = ?",
                    (thread_id,)
                )
                await conn.execute(
                    "DELETE FROM checkpoint_blobs WHERE thread_id = ?",
                    (thread_id,)
                )
                await conn.commit()
                return True
        except Exception as e:
            # Log the error but don't raise - cleanup errors should be handled gracefully
            import logging
            logging.warning(f"Failed to delete checkpoint for thread {thread_id}: {str(e)}")
            return False
