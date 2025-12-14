"""
Symptom Checker Graph - LangGraph implementation for medical symptom checking.

This module contains the graph state definition and node functions for the
SymptomCheckerProvider workflow.
"""
from typing import Annotated
from functools import partial

from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.base import BaseCheckpointSaver
from langchain_core.messages import AnyMessage, SystemMessage, HumanMessage
from langchain_anthropic import ChatAnthropic
from langgraph.types import interrupt
from langgraph.graph.state import CompiledStateGraph

from .symptom_checker_models import (
    PreliminaryQuestions,
    DifferentialDiagnosis,
    RefinementQuestion,
    FinalSummary,
    ExtractedAnswers,
)


# ============================================================================
# LOCALIZATION HELPER
# ============================================================================

def get_localized_prompt(base_prompt: str, language: str) -> str:
    """Add language instruction to system prompt.
    
    Args:
        base_prompt: The original system prompt
        language: User's preferred language ('en' or 'fa')
        
    Returns:
        The prompt with language instructions appended for non-English languages
    """
    if language == 'fa':
        return f"{base_prompt}\n\nIMPORTANT: Respond entirely in Persian (Farsi). Use appropriate Persian medical terminology. All questions, options, explanations, and summaries must be in Persian."
    return base_prompt


# ============================================================================
# STATE DEFINITION
# ============================================================================


class SymptomCheckerState(TypedDict):
    """Graph state for the symptom checker workflow.
    
    This state tracks all information throughout the symptom checking process,
    including messages, questions, answers, and diagnosis information.
    
    Attributes:
        messages: Conversation history with add_messages annotation for proper merging
        symptom_input: The initial symptom description from the user
        preliminary_questions: Generated screening questions (3-5 questions)
        qa_pairs: Question-answer pairs from preliminary screening
        differential_diagnosis: Initial differential diagnosis
        refinement_qa_pairs: Additional Q&A from refinement loop
        current_refinement_question: The current refinement question object (with options)
        refined_ddx: Updated differential diagnosis after refinement
        refinement_count: Number of refinement iterations completed
        final_summary: Final patient-friendly summary
        language: User's preferred language ('en' or 'fa')
    """
    messages: Annotated[list[AnyMessage], add_messages]
    symptom_input: str
    preliminary_questions: PreliminaryQuestions | None
    qa_pairs: list[dict] | None  # List of {"question": str, "answer": str}
    differential_diagnosis: DifferentialDiagnosis | None
    refinement_qa_pairs: list[dict] | None  # Additional Q&A from refinement
    current_refinement_question: RefinementQuestion | None  # The current question object
    refined_ddx: DifferentialDiagnosis | None  # Refined DDX after iterations
    refinement_count: int  # Number of refinement iterations
    final_summary: FinalSummary | None  # Final summary for the user
    language: str  # User's preferred language ('en' or 'fa')


# ============================================================================
# PROMPTS
# ============================================================================

QUESTION_GENERATOR_PROMPT = """You are a medical triage assistant. Your role is to generate 
preliminary screening questions based on the symptoms a patient reports.

Given the patient's symptom(s), generate 3-5 focused follow-up questions that would help 
narrow down potential causes. Questions should:
- Be clear and easy for a patient to answer
- Cover relevant aspects: onset, duration, severity, associated symptoms
- Help differentiate between common conditions
- Each question must be exactly ONE question - never combine multiple questions into a single sentence
- Do NOT use conjunctions like "and also" or "as well as" to combine questions

For each question, also provide 2-4 contextually relevant answer options that the patient can choose from.
"""

DDX_GENERATOR_PROMPT = """You are a medical diagnostic assistant. Based on the patient's 
reported symptoms and their answers to screening questions, generate a differential diagnosis.

Consider:
- The initial symptom(s) reported
- All answers provided to follow-up questions
- Common conditions that match the symptom pattern
- Any red flags that suggest urgent conditions

TOP THREE FOCUS:
Focus your analysis primarily on the top 3 most likely conditions. For these top conditions:
- Provide detailed reasoning for each
- Explain what distinguishes them from each other
- Note any key differentiating features from the patient's history

PROBABILITY GAP ANALYSIS:
After ranking conditions, explicitly analyze the probability gaps:
- Calculate the gap between the #1 and #2 diagnoses
- Note if the top diagnosis "clearly stands out" (gap > 15 percentage points)
- If the top diagnosis stands out, explain why it is significantly more likely than alternatives
- If diagnoses are close in probability, note this uncertainty

For each condition, provide:
- Probability (0.0 to 1.0)
- Reasoning for why this condition is considered
- Severity classification:
  - "life_threatening": Conditions that could cause death or permanent disability if untreated
  - "serious": Conditions requiring prompt medical attention
  - "moderate": Conditions needing medical evaluation but not urgent
  - "mild": Self-limiting or easily treatable conditions

IMPORTANT: Rank conditions by probability in DESCENDING order (highest probability first).
Always include a medical disclaimer stating this is for educational purposes only.
"""

ANSWER_EXTRACTOR_PROMPT = """You are an assistant that extracts answers from a patient's 
free-text response and maps them to specific medical screening questions.

Given a list of questions and the patient's response (which may answer multiple questions 
in a conversational way), extract the relevant answer for each question.

If the patient didn't address a specific question, use "Not mentioned" as the answer.
If the answer is unclear or ambiguous, extract what you can and note the uncertainty.
"""

REFINEMENT_QUESTION_PROMPT = """You are a medical diagnostic assistant. Based on the current 
differential diagnosis and all information collected so far, follow this THREE-STEP reasoning 
process to determine whether to generate a follow-up question.

## STEP 1: PROBABILITY GAP ANALYSIS

First, analyze the probability gaps between the top diagnoses:
- Calculate the gap between the #1 and #2 diagnoses
- If the top diagnosis probability exceeds the second by MORE than 15 percentage points, 
  the top diagnosis "clearly stands out" - no further questions are needed
- If diagnoses are close in probability (gap ≤ 15%), proceed to Step 2

## STEP 2: QUESTION UTILITY ANALYSIS

When the top diagnoses are close in probability, determine if a HISTORY question can help:
- Consider: Can asking about symptoms, timing, characteristics, or history meaningfully 
  differentiate between the top conditions?
- Some conditions can ONLY be distinguished by:
  - Laboratory tests (blood work, cultures, etc.)
  - Imaging studies (X-ray, CT, MRI, ultrasound)
  - Physical examination findings
  - Specialized diagnostic procedures

If NO history question can meaningfully differentiate the top conditions:
- Set `question_useful` to `false`
- In the `purpose` field, explain what WOULD help differentiate (e.g., "Blood test needed 
  to distinguish bacterial vs viral infection" or "Chest X-ray required to differentiate 
  pneumonia from bronchitis")
- Still provide a placeholder question and options (they won't be used)

If a history question CAN help, proceed to Step 3.

## STEP 3: MAXIMUM DISCRIMINATION QUESTION SELECTION

When generating a question, select the ONE question that would create MAXIMUM probability 
separation between the top diagnoses:

- Identify which specific feature or symptom characteristic would most strongly differentiate 
  between the top 2-3 conditions
- Explain which conditions the question differentiates between
- Describe how each answer option would shift the probabilities
- Select the question with the highest expected information gain

The question should:
- Target differentiation between the most likely conditions
- Be clear and easy for a patient to answer
- Be exactly ONE question - never combine multiple questions
- NOT repeat any previously asked questions
- Help rule in or rule out specific conditions

For the question, provide 2-4 contextually relevant answer options.

## OUTPUT REQUIREMENTS

- Set `question_useful` to `true` if a history question can help differentiate
- Set `question_useful` to `false` if tests, imaging, or physical exam are needed instead
- Always populate the `purpose` field:
  - If question_useful=true: explain why this question helps narrow down the diagnosis
  - If question_useful=false: explain what would help differentiate (tests, imaging, etc.)
"""

FINAL_SUMMARY_PROMPT = """You are a medical assistant providing a patient-friendly summary.
Based on all the information collected and the final differential diagnosis, provide:

1. The most likely diagnosis (top condition)
2. The probability of this diagnosis
3. A clear, patient-friendly explanation of what this means and recommended next steps
4. An appropriate medical disclaimer

## UNCERTAINTY ACKNOWLEDGMENT

When presenting your summary, consider the probability gap between the top diagnoses:

**If the top diagnosis clearly stands out (gap > 15% from second diagnosis):**
- Present the top diagnosis with appropriate confidence
- Explain why this diagnosis is significantly more likely than alternatives
- Focus recommendations on this primary condition

**If diagnoses remain close in probability (gap ≤ 15%):**
- Acknowledge that multiple conditions remain similarly likely
- Explain that the history-based assessment has limitations in distinguishing between them
- List the top 2-3 conditions that are still being considered

## TEST/IMAGING RECOMMENDATIONS

If the refinement process identified that tests, imaging, or physical examination are needed 
to differentiate between conditions:
- Include specific recommendations for what tests or imaging would help clarify the diagnosis
- Explain what each recommended test would help determine
- Prioritize recommendations based on clinical relevance

## CONFIDENCE PRESENTATION

Present your confidence level appropriately:
- High confidence (top diagnosis > 60% AND gap > 15%): "Based on your symptoms, [condition] is the most likely diagnosis"
- Moderate confidence (top diagnosis 40-60% OR gap 10-15%): "Your symptoms are most consistent with [condition], though other possibilities exist"
- Lower confidence (top diagnosis < 40% OR gap < 10%): "Several conditions could explain your symptoms, with [condition] being somewhat more likely"

Be empathetic and clear. Avoid medical jargon where possible.
"""


# ============================================================================
# NODE FUNCTIONS
# ============================================================================

def generate_questions(state: SymptomCheckerState, questions_model) -> dict:
    """
    Node 1: Generate preliminary screening questions based on reported symptoms.
    
    Extracts the symptom from the last user message and uses structured output
    to generate 3-5 screening questions with answer options.
    
    Args:
        state: Current graph state
        questions_model: LLM model with structured output binding for PreliminaryQuestions
        
    Returns:
        Dict with symptom_input and preliminary_questions
    """
    # Extract symptom from the last user message
    symptom = ""
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            symptom = msg.content
            break

    # Get language from state (default to 'en')
    language = state.get("language", "en")
    
    # Apply language localization to the prompt
    localized_prompt = get_localized_prompt(QUESTION_GENERATOR_PROMPT, language)
    
    messages = [
        SystemMessage(content=localized_prompt),
        HumanMessage(content=f"Patient reports: {symptom}"),
    ]

    response: PreliminaryQuestions = questions_model.invoke(messages)

    return {
        "symptom_input": symptom,
        "preliminary_questions": response,
    }


def collect_answers(state: SymptomCheckerState, answer_extractor_model) -> dict:
    """
    Node 2: Collect answers to ALL preliminary questions at once.
    
    Uses a single LangGraph interrupt() to present all questions together,
    avoiding interrupt ordering issues. The user answers all questions in one go.
    
    Args:
        state: Current graph state
        answer_extractor_model: LLM model for extracting answers from free-text (unused)
        
    Returns:
        Dict with qa_pairs containing all question-answer pairs
    """
    questions = state["preliminary_questions"]
    questions_list = questions.preliminary_questions
    
    # Single interrupt with ALL questions at once
    user_response = interrupt({
        "questions": [
            {
                "question": q.question,
                "options": q.options,
                "question_number": i + 1,
            }
            for i, q in enumerate(questions_list)
        ],
        "total_questions": len(questions_list),
    })
    
    # Parse the response - expecting a list of answers matching question order
    # user_response can be:
    # - A list of answer strings: ["answer1", "answer2", ...]
    # - A dict with "answers" key: {"answers": ["answer1", "answer2", ...]}
    if isinstance(user_response, list):
        answers = user_response
    elif isinstance(user_response, dict):
        answers = user_response.get("answers", [])
    else:
        # Fallback: treat as single answer for all questions
        answers = [str(user_response)] * len(questions_list)
    
    # Build QA pairs from questions and answers
    qa_pairs = [
        {"question": questions_list[i].question, "answer": answers[i] if i < len(answers) else "Not provided"}
        for i in range(len(questions_list))
    ]
    
    return {"qa_pairs": qa_pairs}


def generate_ddx(state: SymptomCheckerState, ddx_model) -> dict:
    """
    Node 3: Generate differential diagnosis based on symptom + Q&A.
    
    Builds context from the initial symptom and all collected Q&A pairs,
    then uses structured output to generate a ranked differential diagnosis.
    
    Args:
        state: Current graph state
        ddx_model: LLM model with structured output binding for DifferentialDiagnosis
        
    Returns:
        Dict with differential_diagnosis
    """
    # Build context from symptom and Q&A
    qa_text = "\n".join(
        f"Q: {qa['question']}\nA: {qa['answer']}"
        for qa in (state.get("qa_pairs") or [])
    )

    # Include refinement Q&A if available
    refinement_qa = state.get("refinement_qa_pairs") or []
    if refinement_qa:
        refinement_text = "\n".join(
            f"Q: {qa['question']}\nA: {qa['answer']}"
            for qa in refinement_qa
        )
        qa_text += f"\n\nRefinement questions:\n{refinement_text}"

    user_content = f"""Patient's initial symptom: {state["symptom_input"]}

Interview responses:
{qa_text}

Based on this information, provide a differential diagnosis."""

    # Get language from state (default to 'en')
    language = state.get("language", "en")
    
    # Apply language localization to the prompt
    localized_prompt = get_localized_prompt(DDX_GENERATOR_PROMPT, language)
    
    messages = [
        SystemMessage(content=localized_prompt),
        HumanMessage(content=user_content),
    ]

    response: DifferentialDiagnosis = ddx_model.invoke(messages)

    return {"differential_diagnosis": response}


def generate_refinement_question(state: SymptomCheckerState, refinement_model) -> dict:
    """
    Node 4: Generate a refinement question to narrow down the differential diagnosis.
    
    Builds context from all QA pairs and current DDX, then uses structured output
    to generate a single refinement question with options.
    
    Args:
        state: Current graph state
        refinement_model: LLM model with structured output binding for RefinementQuestion
        
    Returns:
        Dict with current_refinement_question (full RefinementQuestion object)
    """
    # Get current DDX (use refined if available, otherwise initial)
    current_ddx = state.get("refined_ddx") or state.get("differential_diagnosis")
    
    # Build context from all Q&A pairs
    qa_text = "\n".join(
        f"Q: {qa['question']}\nA: {qa['answer']}"
        for qa in (state.get("qa_pairs") or [])
    )
    
    # Include refinement Q&A if available
    refinement_qa = state.get("refinement_qa_pairs") or []
    if refinement_qa:
        refinement_text = "\n".join(
            f"Q: {qa['question']}\nA: {qa['answer']}"
            for qa in refinement_qa
        )
        qa_text += f"\n\nPrevious refinement questions:\n{refinement_text}"
    
    # Build DDX summary
    ddx_text = "\n".join(
        f"- {d.condition}: {d.probability:.0%} probability ({d.severity})"
        for d in current_ddx.differential
    )
    
    user_content = f"""Patient's initial symptom: {state["symptom_input"]}

Information collected so far:
{qa_text}

Current differential diagnosis:
{ddx_text}

Generate ONE follow-up question to help narrow down between the top conditions."""

    # Get language from state (default to 'en')
    language = state.get("language", "en")
    
    # Apply language localization to the prompt
    localized_prompt = get_localized_prompt(REFINEMENT_QUESTION_PROMPT, language)
    
    messages = [
        SystemMessage(content=localized_prompt),
        HumanMessage(content=user_content),
    ]

    response: RefinementQuestion = refinement_model.invoke(messages)

    # Store the full object so collect_refinement_answer can reuse it
    return {"current_refinement_question": response}


def collect_refinement_answer(state: SymptomCheckerState, refinement_model) -> dict:
    """
    Node 5: Collect answer to the current refinement question.
    
    Uses LangGraph interrupt() to pause for user input, then appends
    the Q&A pair to refinement_qa_pairs. Reuses the question generated
    by generate_refinement_question to avoid duplicate LLM calls.
    
    Args:
        state: Current graph state
        refinement_model: LLM model (unused - kept for signature compatibility)
        
    Returns:
        Dict with updated refinement_qa_pairs
    """
    # Get the question already generated by generate_refinement_question
    refinement_question = state.get("current_refinement_question")
    
    # Interrupt and wait for user answer
    user_response = interrupt({
        "question": refinement_question.question,
        "options": refinement_question.options,
        "refinement_round": (state.get("refinement_count") or 0) + 1,
    })
    
    # Get user's response
    user_text = user_response if isinstance(user_response, str) else user_response.get("text", str(user_response))
    
    # Append to refinement QA pairs
    new_qa = {"question": refinement_question.question, "answer": user_text}
    updated_refinement_qa = (state.get("refinement_qa_pairs") or []) + [new_qa]
    
    return {
        "refinement_qa_pairs": updated_refinement_qa,
    }


def refine_ddx(state: SymptomCheckerState, ddx_model) -> dict:
    """
    Node 6: Update the differential diagnosis based on new refinement Q&A.
    
    Regenerates the DDX with all collected information and increments
    the refinement count.
    
    Args:
        state: Current graph state
        ddx_model: LLM model with structured output binding for DifferentialDiagnosis
        
    Returns:
        Dict with refined_ddx and incremented refinement_count
    """
    # Build context from all Q&A pairs
    qa_text = "\n".join(
        f"Q: {qa['question']}\nA: {qa['answer']}"
        for qa in (state.get("qa_pairs") or [])
    )
    
    # Include all refinement Q&A
    refinement_qa = state.get("refinement_qa_pairs") or []
    if refinement_qa:
        refinement_text = "\n".join(
            f"Q: {qa['question']}\nA: {qa['answer']}"
            for qa in refinement_qa
        )
        qa_text += f"\n\nRefinement questions:\n{refinement_text}"

    user_content = f"""Patient's initial symptom: {state["symptom_input"]}

Interview responses:
{qa_text}

Based on ALL the information collected, provide an updated differential diagnosis."""

    # Get language from state (default to 'en')
    language = state.get("language", "en")
    
    # Apply language localization to the prompt
    localized_prompt = get_localized_prompt(DDX_GENERATOR_PROMPT, language)
    
    messages = [
        SystemMessage(content=localized_prompt),
        HumanMessage(content=user_content),
    ]

    response: DifferentialDiagnosis = ddx_model.invoke(messages)
    
    # Increment refinement count
    current_count = state.get("refinement_count") or 0

    return {
        "refined_ddx": response,
        "refinement_count": current_count + 1,
    }


def should_continue_refinement(state: SymptomCheckerState) -> str:
    """
    Routing function: Determine whether to continue the refinement loop.
    
    Stop conditions (return "end"):
    1. Refinement count >= 5 (max iterations) - Requirement 5.3
    2. question_useful is False (tests/imaging needed) - Requirement 5.1
    3. Probability gap > 15% between top two diagnoses - Requirement 5.2
    
    Args:
        state: Current graph state
        
    Returns:
        "continue" to ask another refinement question, "end" to generate final summary
    """
    # Check max iterations first (Requirement 5.3)
    refinement_count = state.get("refinement_count") or 0
    if refinement_count >= 5:
        return "end"
    
    # Check if LLM determined no question is useful (Requirement 5.1)
    current_question = state.get("current_refinement_question")
    if current_question and not current_question.question_useful:
        return "end"
    
    # Get current DDX (use refined if available, otherwise initial)
    current_ddx = state.get("refined_ddx") or state.get("differential_diagnosis")
    
    if not current_ddx or not current_ddx.differential:
        return "end"
    
    # Handle single diagnosis case - no gap to analyze
    if len(current_ddx.differential) < 2:
        return "end"
    
    # Check probability gap (Requirement 5.2)
    # Stop if top diagnosis exceeds second by more than 15 percentage points
    top_probability = current_ddx.differential[0].probability
    second_probability = current_ddx.differential[1].probability
    if top_probability - second_probability > 0.15:
        return "end"
    
    return "continue"


def generate_final_summary(state: SymptomCheckerState, summary_model) -> dict:
    """
    Node 7: Generate a patient-friendly final summary.
    
    Uses structured output to generate a FinalSummary with the top diagnosis,
    probability, explanation, and disclaimer.
    
    Args:
        state: Current graph state
        summary_model: LLM model with structured output binding for FinalSummary
        
    Returns:
        Dict with final_summary
    """
    # Get final DDX (use refined if available, otherwise initial)
    final_ddx = state.get("refined_ddx") or state.get("differential_diagnosis")
    
    # Build context from all Q&A pairs
    qa_text = "\n".join(
        f"Q: {qa['question']}\nA: {qa['answer']}"
        for qa in (state.get("qa_pairs") or [])
    )
    
    # Include refinement Q&A if available
    refinement_qa = state.get("refinement_qa_pairs") or []
    if refinement_qa:
        refinement_text = "\n".join(
            f"Q: {qa['question']}\nA: {qa['answer']}"
            for qa in refinement_qa
        )
        qa_text += f"\n\nRefinement questions:\n{refinement_text}"
    
    # Build DDX summary
    ddx_text = "\n".join(
        f"- {d.condition}: {d.probability:.0%} probability ({d.severity}) - {d.reasoning}"
        for d in final_ddx.differential
    )
    
    user_content = f"""Patient's initial symptom: {state["symptom_input"]}

Information collected:
{qa_text}

Final differential diagnosis:
{ddx_text}

Provide a patient-friendly summary with the most likely diagnosis and recommended next steps."""

    # Get language from state (default to 'en')
    language = state.get("language", "en")
    
    # Apply language localization to the prompt
    localized_prompt = get_localized_prompt(FINAL_SUMMARY_PROMPT, language)
    
    messages = [
        SystemMessage(content=localized_prompt),
        HumanMessage(content=user_content),
    ]

    response: FinalSummary = summary_model.invoke(messages)

    return {"final_summary": response}


# ============================================================================
# ROUTING FUNCTIONS
# ============================================================================

# Note: should_continue_collecting_answers removed - no longer needed
# since collect_answers now uses a single interrupt for all questions


# ============================================================================
# GRAPH BUILDER
# ============================================================================

def should_continue_or_end_refinement(state: SymptomCheckerState) -> str:
    """
    Routing function after generate_refinement_question: Determine whether to 
    continue collecting refinement answers or end the refinement loop.
    
    This is called BEFORE collecting the first refinement answer to check if
    we should even start the refinement loop based on initial DDX confidence.
    
    Stop conditions (return "end"):
    1. Life-threatening probability sum < 0.10 AND top diagnosis probability > 0.50
    2. Refinement count >= 5 (max iterations)
    
    Args:
        state: Current graph state
        
    Returns:
        "continue" to collect refinement answer, "end" to generate final summary
    """
    return should_continue_refinement(state)


def build_symptom_checker_graph(
    api_key: str,
    model_name: str = "claude-sonnet-4-20250514",
    temperature: float = 0.3,
    reasoning_effort: str | None = None,
    checkpointer: BaseCheckpointSaver | None = None,
) -> CompiledStateGraph:
    """
    Build and compile the symptom checker LangGraph.
    
    Creates a graph with the following flow:
    START → generate_questions → collect_answers (loop) → generate_ddx
    → generate_refinement_question → (conditional) → collect_refinement_answer 
    → refine_ddx → generate_refinement_question (loop) OR generate_final_summary → END
    
    The language for responses is read from the graph state's 'language' field,
    which should be set in the initial state when invoking the graph.
    
    Args:
        api_key: Anthropic API key
        model_name: Name of the Anthropic model to use
        temperature: Temperature for LLM responses
        reasoning_effort: Unused (kept for API compatibility)
        checkpointer: Pre-initialized checkpointer (required for persistence)
        
    Returns:
        Compiled graph ready for use
    """
    base_model = ChatAnthropic(
        model=model_name,
        temperature=temperature,
        api_key=api_key,
        max_tokens=4096,  # Ensure enough tokens for complete structured outputs
    )
    
    # Create structured output models for each node
    questions_model = base_model.with_structured_output(PreliminaryQuestions)
    ddx_model = base_model.with_structured_output(DifferentialDiagnosis)
    refinement_model = base_model.with_structured_output(RefinementQuestion)
    summary_model = base_model.with_structured_output(FinalSummary)
    
    # Create node functions with bound models using partial
    # Language is read from state in each node function
    generate_questions_node = partial(generate_questions, questions_model=questions_model)
    collect_answers_node = partial(collect_answers, answer_extractor_model=base_model)
    generate_ddx_node = partial(generate_ddx, ddx_model=ddx_model)
    generate_refinement_question_node = partial(generate_refinement_question, refinement_model=refinement_model)
    collect_refinement_answer_node = partial(collect_refinement_answer, refinement_model=refinement_model)
    refine_ddx_node = partial(refine_ddx, ddx_model=ddx_model)
    generate_final_summary_node = partial(generate_final_summary, summary_model=summary_model)
    
    # Build the graph
    builder = StateGraph(SymptomCheckerState)
    
    # Add all nodes (Requirements 5.1)
    builder.add_node("generate_questions", generate_questions_node)
    builder.add_node("collect_answers", collect_answers_node)
    builder.add_node("generate_ddx", generate_ddx_node)
    builder.add_node("generate_refinement_question", generate_refinement_question_node)
    builder.add_node("collect_refinement_answer", collect_refinement_answer_node)
    builder.add_node("refine_ddx", refine_ddx_node)
    builder.add_node("generate_final_summary", generate_final_summary_node)
    
    # Define edges (Requirements 3.4, 4.1, 4.2)
    
    # START → generate_questions
    builder.add_edge(START, "generate_questions")
    
    # generate_questions → collect_answers → generate_ddx
    # (No loop needed - collect_answers now gets all answers in single interrupt)
    builder.add_edge("generate_questions", "collect_answers")
    builder.add_edge("collect_answers", "generate_ddx")
    
    # generate_ddx → generate_refinement_question
    builder.add_edge("generate_ddx", "generate_refinement_question")
    
    # generate_refinement_question → (conditional) → collect_refinement_answer OR generate_final_summary
    # This checks stop conditions BEFORE asking the first refinement question
    builder.add_conditional_edges(
        "generate_refinement_question",
        should_continue_or_end_refinement,
        {
            "continue": "collect_refinement_answer",
            "end": "generate_final_summary",
        }
    )
    
    # collect_refinement_answer → refine_ddx
    builder.add_edge("collect_refinement_answer", "refine_ddx")
    
    # refine_ddx → generate_refinement_question (loop back)
    builder.add_edge("refine_ddx", "generate_refinement_question")
    
    # generate_final_summary → END
    builder.add_edge("generate_final_summary", END)
    
    # Compile the graph with provided checkpointer
    compiled_graph = builder.compile(checkpointer=checkpointer)
    
    return compiled_graph
