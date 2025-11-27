"""LangGraph Medical Triage Provider - Implements medical triage workflow with interrupts.

This module contains the complete medical triage system from the notebook,
adapted to work as a swappable LLM provider in the clean architecture.
"""
from typing import List, Dict, Any, Optional, AsyncIterator, TypedDict, NotRequired
import uuid
from pydantic import BaseModel, Field
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from langgraph.graph import StateGraph, START, END, MessagesState
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import interrupt

from ..domain.interfaces import ILLMProvider
from ..domain.exceptions import LLMProviderException


# ============================================================================
# LangGraph-Specific Entities (Implementation Details)
# ============================================================================

class IntentAnalysis(BaseModel):
    """Result from intent classification node.

    Represents either a clear intent classification or a request for clarification.
    Used by the intent_detector node to determine user's medical intent.

    NOTE: This is an infrastructure-layer class specific to LangGraphMedicalProvider.
    It's used for structured LLM output and is not a core domain entity.
    """
    intent: Optional[str] = Field(
        default=None,
        description="The classified medical intent if clear (symptom_checking, information_seeking, medication_queries, others)."
    )
    confidence: float = Field(
        description="A confidence score between 0.0 and 1.0."
    )
    clarifying_question: Optional[str] = Field(
        default=None,
        description="A question to ask if intent is unclear."
    )
    needs_clarification: bool = Field(
        description="Whether human input is needed for clarification."
    )


class TriageResult(BaseModel):
    """Result from symptom triage node.

    Represents either a triage classification or a request for more symptom information.
    Used by the symptom_checking node to determine urgency level.

    NOTE: This is an infrastructure-layer class specific to LangGraphMedicalProvider.
    It's used for structured LLM output and is not a core domain entity.
    """
    triage_class: Optional[str] = Field(
        default=None,
        description="The classified triage class if enough information (Emergency, Urgent, Non-urgent, Self-care)."
    )
    triage_confidence: float = Field(
        description="A confidence score between 0.0 and 1.0."
    )
    information_gathering_question: Optional[str] = Field(
        default=None,
        description="A question to ask if further information is needed."
    )
    needs_Information: bool = Field(
        description="Whether human input is needed for more information."
    )


# ============================================================================
# State Definition
# ============================================================================

class TriageState(MessagesState):
    """Extended state for medical triage workflow.

    Inherits from MessagesState to get message handling,
    then adds triage-specific fields.

    Note: MessagesState is a TypedDict, so we cannot use default values here.
    All fields are optional and defaults are handled in node functions.
    """
    # Intent detection
    intent: NotRequired[str]
    confidence: NotRequired[float]
    clarification_count: NotRequired[int]
    needs_intent_clarification: NotRequired[bool]

    # Symptom triage
    information_gathering_count: NotRequired[int]
    needs_symptom_information: NotRequired[bool]
    triage_class: NotRequired[str]
    triage_confidence: NotRequired[float]


# ============================================================================
# LangGraph Medical Provider
# ============================================================================

class LangGraphMedicalProvider(ILLMProvider):
    """Medical triage system using LangGraph workflow with human-in-the-loop.

    This provider implements the complete medical triage system from the notebook:
    1. Intent detection (symptom_checking, information_seeking, medication_queries, others)
    2. For symptom_checking: multi-turn symptom gathering with interrupts
    3. Triage classification (Emergency, Urgent, Non-urgent, Self-care)
    4. Specialized responses for each category

    Implements ILLMProvider interface so it can be swapped with AnthropicLLMProvider.
    """

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-20250514", db_path: str = "checkpoints.db"):
        """Initialize the medical triage provider.

        Args:
            api_key: Anthropic API key
            model: Claude model to use
            db_path: Path to SQLite database for checkpointing (state persistence)
        """
        self.llm = ChatAnthropic(model=model, api_key=api_key, temperature=0)  # type: ignore
        self.db_path = db_path
        self.graph = None  # Will be built lazily

    def _build_graph(self, checkpointer):
        """Build the complete medical triage graph.

        This method constructs the graph from the notebook with all nodes and edges.

        Args:
            checkpointer: The checkpointer instance to use for state persistence

        Returns:
            CompiledStateGraph: The compiled graph ready for execution
        """
        builder = StateGraph(TriageState)

        # Add all nodes
        builder.add_node("intent_detector", self._detect_intent_node)
        builder.add_node("intent_human_input", self._intent_human_input)
        builder.add_node("symptom_human_input", self._symptom_human_input)
        builder.add_node("symptom_checking", self._symptom_checking)
        builder.add_node("Emergency", self._emergency_response)
        builder.add_node("Urgent", self._urgent_response)
        builder.add_node("Non_urgent", self._non_urgent_response)
        builder.add_node("Self_care", self._self_care_response)
        builder.add_node("information_seeking", self._information_seeking)
        builder.add_node("medication_queries", self._medication_queries)
        builder.add_node("others", self._others)

        # Add edges - start with intent detection
        builder.add_edge(START, "intent_detector")

        # Conditional edges from intent_detector
        builder.add_conditional_edges(
            "intent_detector",
            self._should_continue_intent,
            {
                "intent_human_input": "intent_human_input",
                "symptom_checking": "symptom_checking",
                "information_seeking": "information_seeking",
                "medication_queries": "medication_queries",
                "others": "others",
                "end": END
            }
        )

        # Conditional edges from symptom_checking
        builder.add_conditional_edges(
            "symptom_checking",
            self._should_continue_symptom,
            {
                "symptom_human_input": "symptom_human_input",
                "Emergency": "Emergency",
                "Urgent": "Urgent",
                "Non_urgent": "Non_urgent",
                "Self_care": "Self_care",
                "end": END
            }
        )

        # Other intent handlers go directly to END
        builder.add_edge("information_seeking", END)
        builder.add_edge("medication_queries", END)
        builder.add_edge("others", END)

        # Triage response nodes go to END
        builder.add_edge("Emergency", END)
        builder.add_edge("Urgent", END)
        builder.add_edge("Non_urgent", END)
        builder.add_edge("Self_care", END)

        # Human input nodes loop back to their respective decision nodes
        builder.add_edge("intent_human_input", "intent_detector")
        builder.add_edge("symptom_human_input", "symptom_checking")

        return builder.compile(checkpointer=checkpointer)

    # ========================================================================
    # Decision Functions (Conditional Edges)
    # ========================================================================

    def _should_continue_intent(self, state: TriageState) -> str:
        """Determine next step after intent detection."""
        if state.get("needs_intent_clarification", False):  # type: ignore
            return "intent_human_input"

        if state.get("clarification_count", 0) >= 3:  # type: ignore
            return "end"

        intent = state.get("intent")  # type: ignore
        if intent == "symptom_checking":
            return "symptom_checking"
        elif intent == "information_seeking":
            return "information_seeking"
        elif intent == "medication_queries":
            return "medication_queries"
        elif intent == "others":
            return "others"

        return "end"

    def _should_continue_symptom(self, state: TriageState) -> str:
        """Determine next step after symptom checking."""
        if state.get("needs_symptom_information", False):  # type: ignore
            return "symptom_human_input"

        triage_class = state.get("triage_class")  # type: ignore
        if triage_class == "Emergency":
            return "Emergency"
        elif triage_class == "Urgent":
            return "Urgent"
        elif triage_class == "Non-urgent":
            return "Non_urgent"
        elif triage_class == "Self-care":
            return "Self_care"

        return "end"

    # ========================================================================
    # Node Functions (Graph Logic)
    # ========================================================================

    def _detect_intent_node(self, state: TriageState) -> Dict[str, Any]:
        """Intent detection node - classifies user's medical intent.

        From notebook cell 6.
        """
        messages = state["messages"]
        structured_llm = self.llm.with_structured_output(IntentAnalysis)

        system_message = SystemMessage(content="""You are a medical intent classification assistant that categorizes user messages into exactly 4 classes:

1. **symptom_checking**: User is describing symptoms, asking about symptom severity, seeking symptom assessment, or wanting to understand what their symptoms might indicate.

2. **information_seeking**: User is asking for general medical information, disease explanations, treatment options, procedure details, or educational health content.

3. **medication_queries**: User is asking about medications, prescriptions, drug interactions, dosages, side effects, or medication-related concerns.

4. **others**: Any medical-related query that doesn't fit the above categories, including appointment scheduling, administrative questions, insurance inquiries, or general healthcare support.

Analyze the entire conversation and determine:
1. If you can clearly determine the medical intent with high confidence (>0.8):
   - Set intent to one of the 4 categories above
   - Set needs_clarification to False
   - Leave clarifying_question empty

2. If the intent is unclear or ambiguous (confidence < 0.8):
   - Leave intent empty (None)
   - Set needs_clarification to True
   - Provide a specific clarifying_question to help understand the user's medical concern

Consider the primary intent - if a message contains multiple intents, classify based on the main purpose.
Always provide an honest confidence score between 0.0 and 1.0.
Consider the full conversation history when making your decision.""")

        full_conversation = [system_message] + messages
        response: IntentAnalysis = structured_llm.invoke(full_conversation)  # type: ignore

        if response.intent and response.confidence > 0.8 and not response.needs_clarification:
            print(f"---INTENT CLASSIFIED: {response.intent} (confidence: {response.confidence:.2f})---")
            return {
                "intent": response.intent,
                "confidence": response.confidence,
                "needs_intent_clarification": False
            }
        else:
            print(f"---CLARIFICATION NEEDED (confidence: {response.confidence:.2f})---")
            ai_message = AIMessage(content=response.clarifying_question or "Could you provide more details?")
            return {
                "messages": [ai_message],
                "confidence": response.confidence,
                "needs_intent_clarification": True,
                "clarification_count": state.get("clarification_count", 0) + 1  # type: ignore
            }

    def _intent_human_input(self, state: TriageState) -> Dict[str, Any]:
        """Interrupt node for intent clarification.

        From notebook cell 5.
        """
        last_ai_message = next(
            msg for msg in reversed(state["messages"])
            if isinstance(msg, AIMessage)
        )
        question = last_ai_message.content

        # INTERRUPT: Pause graph and wait for user input
        user_response = interrupt(question)

        return {
            "messages": [HumanMessage(content=user_response)],
            "needs_intent_clarification": False
        }

    def _symptom_human_input(self, state: TriageState) -> Dict[str, Any]:
        """Interrupt node for symptom information gathering.

        From notebook cell 5.
        """
        last_ai_message = next(
            msg for msg in reversed(state["messages"])
            if isinstance(msg, AIMessage)
        )
        question = last_ai_message.content

        # INTERRUPT: Pause graph and wait for user input
        user_response = interrupt(question)

        return {
            "messages": [HumanMessage(content=user_response)],
            "needs_symptom_information": False
        }

    def _symptom_checking(self, state: TriageState) -> Dict[str, Any]:
        """Symptom triage node - determines urgency level.

        From notebook cell 7.
        """
        messages = state["messages"]
        structured_llm = self.llm.with_structured_output(TriageResult)

        system_message = SystemMessage(content="""You are a medical triage classification assistant that determines the urgency level of medical conditions based on symptoms and context.

Your role is to analyze the entire conversation history and classify into exactly 4 triage categories:

1. **Emergency**: Immediate medical attention required within minutes
   - Life-threatening symptoms: severe chest pain, difficulty breathing, severe bleeding, loss of consciousness, stroke symptoms, severe allergic reactions, severe abdominal pain
   - Vital sign concerns: very high fever (>103°F), severe dehydration
   - Mental health crises: suicidal ideation, severe psychotic episodes

2. **Urgent**: Prompt medical evaluation needed within 2-4 hours
   - Moderate pain with concerning features, persistent high fever (>101°F), moderate shortness of breath, new neurological symptoms, suspected fractures
   - Infections showing progression, moderate allergic reactions
   - Mental health: moderate depression/anxiety requiring intervention

3. **Non-urgent**: Medical attention recommended within 24-48 hours
   - Mild to moderate symptoms that are stable, chronic condition changes, routine follow-ups needed
   - Minor injuries, mild infections, manageable pain
   - Preventive care concerns, medication adjustments needed

4. **Self-care**: Can be safely managed at home with monitoring
   - Minor symptoms: mild headaches, common cold, minor cuts/scrapes, mild muscle aches
   - Stable chronic conditions, general wellness questions
   - Situations requiring only rest, hydration, OTC medications

DECISION CRITERIA:
1. If you can confidently classify (confidence > 0.8) based on the conversation history:
   - Set triage_class to one of the 4 categories above
   - Set needs_Information to False
   - Leave information_gathering_question empty

2. If you need more information for safe classification (confidence < 0.8):
   - Leave triage_class empty (None)
   - Set needs_Information to True
   - Ask ONE specific, targeted question about:
     * Symptom severity/duration/progression
     * Associated symptoms that change triage level
     * Medical history relevant to current symptoms
     * Red flag symptoms for emergency conditions

IMPORTANT GUIDELINES:
- Err on the side of higher acuity when uncertain about serious symptoms
- Consider symptom combinations, not just individual symptoms
- Factor in patient age, medical history, and symptom progression
- Always ask about red flag symptoms for potentially serious conditions
- Use the full conversation context, not just the latest message
- Provide honest confidence scores between 0.0 and 1.0
- When in doubt about Emergency vs Urgent, choose Emergency""")

        full_conversation = [system_message] + messages
        response: TriageResult = structured_llm.invoke(full_conversation)  # type: ignore

        # Safety fallback: Force "Urgent" after max rounds with low confidence
        if state.get("information_gathering_count", 0) >= 6:  # type: ignore
            if response.triage_confidence < 0.8:
                print(f"---MAX ROUNDS REACHED: Defaulting to URGENT for safety (confidence: {response.triage_confidence:.2f})---")
                return {
                    "triage_class": "Urgent",
                    "triage_confidence": response.triage_confidence,
                    "needs_symptom_information": False
                }

        if response.triage_class and response.triage_confidence > 0.8 and not response.needs_Information:
            print(f"---TRIAGE CLASSIFIED: {response.triage_class} (confidence: {response.triage_confidence:.2f})---")
            return {
                "triage_class": response.triage_class,
                "triage_confidence": response.triage_confidence,
                "needs_symptom_information": False
            }
        else:
            print(f"---MORE INFORMATION NEEDED (confidence: {response.triage_confidence:.2f})---")
            ai_message = AIMessage(content=response.information_gathering_question or "Can you provide more details about your symptoms?")
            return {
                "messages": [ai_message],
                "triage_confidence": response.triage_confidence,
                "needs_symptom_information": True,
                "information_gathering_count": state.get("information_gathering_count", 0) + 1  # type: ignore
            }

    def _information_seeking(self, state: TriageState) -> Dict[str, Any]:
        """Handle information seeking queries.

        From notebook cell 9.
        """
        messages = state["messages"]
        system_message = SystemMessage(content="""You are a medical information assistant.
Your role is to clearly and simply explain medical concepts to users who are not medically trained.

Guidelines:
- Use plain, everyday language. Avoid medical jargon unless absolutely necessary.
- If you must use a technical term, immediately define it in simple words.
- Break down explanations step by step, starting from the big picture.
- Use analogies or metaphors that connect to daily life when helpful.
- Highlight why the information matters to the user's health, daily life, or choices.
- Keep a supportive and empathetic tone. Never make the user feel their question is "basic."
- Check for understanding by summarizing or offering a quick recap at the end.
- If relevant, provide general health tips or actionable insights, but do not give personal medical advice, diagnoses, or treatment instructions. Always remind the user to consult a healthcare professional for personal concerns.
- Use the full conversation history to understand context and provide accurate, relevant information.""")

        full_conversation = [system_message] + messages
        response = self.llm.invoke(full_conversation)
        ai_message = AIMessage(content=response.content)
        return {"messages": [ai_message]}

    def _medication_queries(self, state: TriageState) -> Dict[str, Any]:  # noqa: ARG002
        """Handle medication queries (placeholder for now)."""
        return {}

    def _others(self, state: TriageState) -> Dict[str, Any]:  # noqa: ARG002
        """Handle other queries (placeholder for now)."""
        return {}

    def _emergency_response(self, state: TriageState) -> Dict[str, Any]:
        """Generate emergency response.

        From notebook cell 12.
        """
        messages = state["messages"]
        system_message = SystemMessage(content="""You are a medical support chatbot that handles urgent situations.
When a user's symptoms may indicate a medical emergency, your priority is to give
clear, firm, and immediate instructions about what to do right now.

--- Response Structure ---
1. Immediate Action
   - Lead with an urgent instruction to call emergency services (e.g., 911 in the U.S., 112 in Europe, or local emergency number).
   - State this clearly at the very beginning, before anything else.

2. Reinforcement
   - Repeat or rephrase the urgent instruction to make sure it is understood.
   - Example: "Do not wait. Call for help now."

3. Minimal Context (optional, one line only)
   - Briefly explain why urgent action is needed, without going into long detail.
   - Example: "These symptoms can be a sign of a serious condition."

4. Supportive Closing
   - Keep tone compassionate but authoritative.
   - Offer one short piece of supportive advice (e.g., "If someone is with you, ask them to stay nearby until help arrives.").

--- Principles to Follow ---
- Urgency comes first: action before explanation.
- Be clear, direct, and unambiguous.
- Use short sentences and simple language.
- Ensure safety by always instructing to seek professional, immediate care.
- Keep context minimal; do not distract the user from acting.
- Maintain a professional but compassionate tone.
- Always prioritize the user's immediate safety over comfort.

Output should be one text block that is firm, clear, and focused on urgent action.""")

        full_conversation = [system_message] + messages
        response = self.llm.invoke(full_conversation)
        ai_message = AIMessage(content=response.content)
        return {"messages": [ai_message]}

    def _urgent_response(self, state: TriageState) -> Dict[str, Any]:
        """Generate urgent response.

        From notebook cell 10.
        """
        messages = state["messages"]
        system_message = SystemMessage(content="""You are a medical support chatbot that handles urgent but not immediate emergencies.
When a user's symptoms suggest they need medical attention soon (but not a 911-level emergency),
your role is to give clear guidance on what to do next.

--- Response Structure ---
1. Situation Overview
   - Briefly acknowledge the user's symptoms in plain, supportive language.
   - Validate their concern.

2. Urgency Level
   - Make it clear this is not a self-care situation.
   - Emphasize that it is not typically an immediate emergency, but requires medical attention soon (same day if possible).

3. Next Steps (Action Plan)
   - Direct the user to seek medical care promptly (e.g., contact their doctor, urgent care, or a walk-in clinic).
   - Use specific timeframes ("today," "within the next few hours") instead of vague terms like "soon."
   - Include safety-netting: if symptoms worsen or new red-flag signs appear, they must call emergency services immediately.

4. Supportive Closing
   - Keep tone professional but compassionate.
   - End with encouragement that they are taking the right steps by addressing their health now.

--- Principles to Follow ---
- Balance reassurance and urgency: calm but firm.
- Be clear, direct, and actionable.
- Always provide a specific next step, not vague advice.
- Ensure safety by including escalation triggers (when to call emergency).
- Keep sentences short and easy to scan.
- Maintain trust and credibility by being factual and consistent.
- Empower the user with confidence while stressing the importance of timely care.
- Respect the user's concern; never minimize their symptoms.

Output should be one text block that is supportive, clear, and focused on getting the user to timely medical care.""")

        full_conversation = [system_message] + messages
        response = self.llm.invoke(full_conversation)
        ai_message = AIMessage(content=response.content)
        return {"messages": [ai_message]}

    def _non_urgent_response(self, state: TriageState) -> Dict[str, Any]:
        """Generate non-urgent response.

        From notebook cell 11.
        """
        messages = state["messages"]
        system_message = SystemMessage(content="""You are a medical support chatbot that handles cases where symptoms require medical evaluation,
but not urgently. The user does not need immediate or same-day care, but should not ignore the issue entirely.

--- Response Structure ---
1. Situation Overview
   - Briefly acknowledge the user's symptoms.
   - Reassure them that this does not appear to be an emergency.

2. Why Follow-up is Needed
   - Explain that while it's not urgent, it's still important for a healthcare professional to review
     (to rule out underlying conditions, confirm diagnosis, or provide proper treatment).

3. Next Steps (Action Plan)
   - Encourage booking a routine appointment with a primary care doctor, ideally within 1–2 weeks.
   - Advise monitoring symptoms in the meantime.
   - Provide safety-netting: explain what changes should prompt escalation to urgent or emergency care.

4. Supportive Closing
   - End with a reassuring, professional but friendly tone.
   - Encourage the user that they are taking the right step in being proactive.

--- Principles to Follow ---
- Be supportive and professional, with a friendly and authentic tone.
- Reduce unnecessary worry while stressing the importance of medical follow-up.
- Always provide a clear timeframe (e.g., "within the next 1–2 weeks") instead of vague advice.
- Keep language accessible: short sentences, easy to scan.
- Include escalation triggers (when to seek urgent/emergency care).
- Make the response feel personalized, like it was written for the user specifically.
- Empower the user with confidence in their next steps.

Output should be one text block that is reassuring, clear, and focused on timely but non-urgent follow-up.""")

        full_conversation = [system_message] + messages
        response = self.llm.invoke(full_conversation)
        ai_message = AIMessage(content=response.content)
        return {"messages": [ai_message]}

    def _self_care_response(self, state: TriageState) -> Dict[str, Any]:
        """Generate self-care response.

        From notebook cell 13.
        """
        messages = state["messages"]
        system_message = SystemMessage(content="""You are a medical support chatbot that provides safe, empathetic self-care guidance.
When a user's symptoms are mild and suitable for self-care, you MUST respond using exactly this 3-part structure:

**1. Describe the Situation**
- Reflect the user's symptoms back in plain, supportive language
- Reassure them that their situation is manageable
- Use phrases like "I understand you're experiencing..." or "It sounds like you have..."

**2. Possible Reasons Why**
- Briefly explain common, non-serious causes for their symptoms
- Keep it simple, informative, and non-alarming
- Start with "This could be due to..." or "Common causes include..."

**3. What to Do Now**
- Provide clear, actionable self-care steps
- Include safety-netting: when to seek urgent medical attention
- End with encouragement and emotional support
- Use bullet points or numbered steps for clarity

CRITICAL: You MUST use the exact headings "1. Describe the Situation", "2. Possible Reasons Why", and "3. What to Do Now" in your response. Do not deviate from this structure.

Tone: Be emotionally supportive, personalized, friendly but professional. Use simple, clear language that's easy to scan. Always respect the user and never dismiss their concerns.""")

        full_conversation = [system_message] + messages
        response = self.llm.invoke(full_conversation)
        ai_message = AIMessage(content=response.content)
        return {"messages": [ai_message]}

    # ========================================================================
    # ILLMProvider Interface Implementation
    # ========================================================================

    async def generate_response(self, messages: List[dict]) -> str:
        """Generate a non-streaming response (not typically used with interrupts)."""
        raise NotImplementedError("Use generate_response_stream for LangGraph medical provider")

    async def generate_response_stream(
        self, messages: List[dict]
    ) -> AsyncIterator[str]:
        """Generate streaming response with interrupt handling.

        This is the main entry point that the use case will call.
        """
        # Convert messages to LangChain format
        lc_messages = []
        for msg in messages:
            if msg["role"] == "user":
                lc_messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                lc_messages.append(AIMessage(content=msg["content"]))

        # Generate thread ID for this conversation
        thread_id = str(uuid.uuid4())
        config = {"configurable": {"thread_id": thread_id}}

        try:
            # Use async context manager for checkpointer
            async with AsyncSqliteSaver.from_conn_string(self.db_path) as checkpointer:
                # Build graph with checkpointer
                graph = self._build_graph(checkpointer)

                # Invoke graph
                result = await graph.ainvoke(
                    {"messages": lc_messages},
                    config=config  # type: ignore
                )

                # Check for interrupt
                if "__interrupt__" in result:
                    interrupt_info = result["__interrupt__"][0]
                    import json
                    yield json.dumps({
                        "type": "interrupt",
                        "question": interrupt_info.value,
                        "thread_id": thread_id
                    })
                else:
                    # Final result - yield the last message
                    last_message = result["messages"][-1]
                    yield last_message.content
        except Exception as e:
            raise LLMProviderException(f"LangGraph medical provider error: {str(e)}")

    async def resume(self, thread_id: str, user_input: str) -> Dict[str, Any]:
        """Resume an interrupted conversation.

        This method is called when the user provides clarification.
        """
        config = {"configurable": {"thread_id": thread_id}}

        try:
            # Use async context manager for checkpointer
            async with AsyncSqliteSaver.from_conn_string(self.db_path) as checkpointer:
                # Build graph with checkpointer
                graph = self._build_graph(checkpointer)

                # Resume with user's answer
                from langgraph.types import Command
                result = await graph.ainvoke(
                    Command(resume=user_input),
                    config=config  # type: ignore
                )

                # Check for another interrupt or final result
                if "__interrupt__" in result:
                    interrupt_info = result["__interrupt__"][0]
                    return {
                        "type": "interrupt",
                        "question": interrupt_info.value
                    }
                else:
                    last_message = result["messages"][-1]
                    return {
                        "type": "complete",
                        "content": last_message.content,
                        "triage_class": result.get("triage_class"),  # type: ignore
                        "intent": result.get("intent")  # type: ignore
                    }
        except Exception as e:
            raise LLMProviderException(f"LangGraph resume error: {str(e)}")
