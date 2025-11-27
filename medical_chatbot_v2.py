"""
Medical Chatbot - Single file implementation using LangGraph
Enhanced with ambiguous input handling and mid-flow intent switching
"""
import os
from typing import Annotated, Literal, TypedDict
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, HumanMessage, BaseMessage
from langgraph.graph import StateGraph, START
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import Command, interrupt

# Load environment variables
load_dotenv()


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

MODEL_CONFIG = {
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


def get_model(node_name: str) -> ChatOpenAI:
    """Get the configured model for a specific node."""
    config = MODEL_CONFIG.get(node_name, MODEL_CONFIG["default"])
    
    model_kwargs = {
        "model": config["model"],
        "temperature": config["temperature"],
    }
    
    # Add reasoning effort for models that support it
    if config.get("reasoning_effort"):
        model_kwargs["model_kwargs"] = {
            "reasoning": {"effort": config["reasoning_effort"]}
        }
    
    return ChatOpenAI(**model_kwargs)


# ============== STATE ==============
class MedicalChatState(TypedDict):
    """State for the medical chatbot."""
    messages: Annotated[list[BaseMessage], add_messages]
    intent: Literal["non_medical", "symptom_checking", "other_medical", "ambiguous"] | None
    symptom_history: list[str]
    has_enough_info: bool
    unclear_count: int  # Track consecutive unclear responses
    is_early_exit: bool  # Flag for early exit with limited info



# ============== NODES ==============
def create_nodes():
    """Create all nodes, each using its configured model."""

    def intent_detector(state: MedicalChatState) -> Command[Literal["non_medical_response", "symptom_checker", "other_medical_response", "clarification_node"]]:
        """Detect the intent of the user's query using LLM."""
        model = get_model("intent_detector")
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

        response = model.invoke([HumanMessage(content=intent_prompt)])
        intent = response.content.strip().lower()

        if "non_medical" in intent:
            return Command(update={"intent": "non_medical"}, goto="non_medical_response")
        elif "symptom" in intent:
            return Command(update={"intent": "symptom_checking"}, goto="symptom_checker")
        elif "ambiguous" in intent:
            return Command(update={"intent": "ambiguous"}, goto="clarification_node")
        else:
            return Command(update={"intent": "other_medical"}, goto="other_medical_response")

    def clarification_node(state: MedicalChatState) -> Command[Literal["wait_for_clarification"]]:
        """Ask user to clarify their intent when ambiguous."""
        model = get_model("clarification_node")
        messages = state["messages"]
        last_message = messages[-1].content if messages else ""

        prompt = f"""You are a friendly medical assistant. The user's message was unclear:
"{last_message}"

Ask them to clarify what they need help with. Offer options like:
- Describing symptoms they're experiencing
- Asking a general health question
- Something else

Keep it brief, warm, and helpful."""

        response = model.invoke([HumanMessage(content=prompt)])
        return Command(
            update={"messages": [AIMessage(content=response.content)]},
            goto="wait_for_clarification"
        )

    def wait_for_clarification(state: MedicalChatState) -> Command[Literal["intent_detector"]]:
        """Wait for user's clarification response."""
        user_response = interrupt(value="Waiting for clarification...")
        return Command(
            update={"messages": [HumanMessage(content=user_response)]},
            goto="intent_detector"
        )

    def non_medical_response(state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Handle non-medical queries with a polite response."""
        model = get_model("non_medical_response")
        messages = state["messages"]
        last_message = messages[-1].content if messages else ""

        prompt = f"""You are a friendly medical assistant chatbot. The user has asked a non-medical question.
Politely explain that you're specialized in medical topics and can't help with this particular question.
Be warm and suggest they can ask you about health-related topics instead.

User's message: "{last_message}"

Generate a brief, polite response:"""

        response = model.invoke([HumanMessage(content=prompt)])
        return Command(update={"messages": [AIMessage(content=response.content)]}, goto="__end__")

    def symptom_checker(state: MedicalChatState) -> Command[Literal["symptom_evaluator", "intent_detector", "symptom_clarification_node", "polite_end_node", "final_answer"]]:
        """Gather symptom information and detect mid-flow intent changes."""
        model = get_model("symptom_checker")
        messages = state["messages"]
        symptom_history = state.get("symptom_history", [])
        unclear_count = state.get("unclear_count", 0)

        conversation_context = "\n".join([
            f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {m.content}"
            for m in messages
        ])

        last_message = messages[-1].content if messages else ""

        # First, analyze the user's response type
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

        analysis_response = model.invoke([HumanMessage(content=analysis_prompt)])
        response_type = analysis_response.content.strip().upper()

        # Handle based on response type
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

        # CONTINUATION - proceed with symptom gathering
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

Then ask your ONE strategic question. Be empathetic and phrase it naturally. Do NOT include your reasoning in the response to the user."""

        response = model.invoke([HumanMessage(content=gather_prompt)])

        new_history = symptom_history.copy()
        if messages:
            new_history.append(f"User reported: {last_message}")

        return Command(
            update={
                "messages": [AIMessage(content=response.content)],
                "symptom_history": new_history,
                "unclear_count": 0
            },
            goto="symptom_evaluator"
        )

    def symptom_clarification_node(state: MedicalChatState) -> Command[Literal["wait_for_symptom_clarification"]]:
        """Gently ask user to clarify when their response is unclear."""
        model = get_model("symptom_clarification_node")
        unclear_count = state.get("unclear_count", 0)

        if unclear_count >= 2:
            prompt = """You are a friendly medical assistant. The user has given a few unclear responses.
Offer them clear options:
- Continue discussing their symptoms (ask them to describe what they're feeling)
- Get guidance based on what you've learned so far
- Start fresh with a different question

Be warm and not pushy. Keep it brief."""
        else:
            prompt = """You are a friendly medical assistant. The user's response wasn't clear enough to continue.
Gently ask them to provide more detail about their symptoms or let you know if they'd like to do something else.
Be warm and understanding. Keep it brief."""

        response = model.invoke([HumanMessage(content=prompt)])
        return Command(
            update={"messages": [AIMessage(content=response.content)]},
            goto="wait_for_symptom_clarification"
        )

    def wait_for_symptom_clarification(state: MedicalChatState) -> Command[Literal["symptom_checker"]]:
        """Wait for user's clarification during symptom checking."""
        user_response = interrupt(value="Waiting for symptom clarification...")
        return Command(
            update={"messages": [HumanMessage(content=user_response)]},
            goto="symptom_checker"
        )

    def polite_end_node(state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Handle user wanting to exit the conversation."""
        model = get_model("polite_end_node")
        prompt = """You are a friendly medical assistant. The user wants to end the conversation.
Give a brief, warm goodbye. Mention they can come back anytime if they have health questions.
Keep it short and friendly."""

        response = model.invoke([HumanMessage(content=prompt)])
        return Command(
            update={"messages": [AIMessage(content=response.content)]},
            goto="__end__"
        )

    def symptom_evaluator(state: MedicalChatState) -> Command[Literal["final_answer", "wait_for_response"]]:
        """Evaluate if we have enough information to provide guidance."""
        model = get_model("symptom_evaluator")
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

        response = model.invoke([HumanMessage(content=prompt)])
        has_enough = "yes" in response.content.strip().lower()

        if has_enough:
            return Command(update={"has_enough_info": True}, goto="final_answer")
        else:
            return Command(update={"has_enough_info": False}, goto="wait_for_response")

    def wait_for_response(state: MedicalChatState) -> Command[Literal["symptom_checker"]]:
        """Wait for user's response to the follow-up question."""
        user_response = interrupt(value="Waiting for user response...")
        return Command(
            update={"messages": [HumanMessage(content=user_response)]},
            goto="symptom_checker"
        )

    def final_answer(state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Provide final medical guidance based on gathered symptoms."""
        model = get_model("final_answer")
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

        response = model.invoke([HumanMessage(content=prompt)])
        return Command(
            update={"messages": [AIMessage(content=response.content)], "is_early_exit": False},
            goto="__end__"
        )

    def other_medical_response(state: MedicalChatState) -> Command[Literal["__end__"]]:
        """Handle general medical questions (not symptom-related)."""
        model = get_model("other_medical_response")
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

        response = model.invoke([HumanMessage(content=prompt)])
        return Command(update={"messages": [AIMessage(content=response.content)]}, goto="__end__")

    return {
        "intent_detector": intent_detector,
        "clarification_node": clarification_node,
        "wait_for_clarification": wait_for_clarification,
        "non_medical_response": non_medical_response,
        "symptom_checker": symptom_checker,
        "symptom_clarification_node": symptom_clarification_node,
        "wait_for_symptom_clarification": wait_for_symptom_clarification,
        "polite_end_node": polite_end_node,
        "symptom_evaluator": symptom_evaluator,
        "wait_for_response": wait_for_response,
        "final_answer": final_answer,
        "other_medical_response": other_medical_response,
    }



# ============== GRAPH ==============
def create_medical_chatbot():
    """Create the medical chatbot graph."""
    nodes = create_nodes()

    builder = StateGraph(MedicalChatState)

    # Add all nodes
    for node_name, node_fn in nodes.items():
        builder.add_node(node_name, node_fn)

    # Set entry point
    builder.add_edge(START, "intent_detector")

    # Compile with memory
    memory = MemorySaver()
    return builder.compile()


# ============== EXPORT ==============
graph = create_medical_chatbot()
