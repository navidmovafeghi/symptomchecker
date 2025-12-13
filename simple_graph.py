"""
Medical Symptom Checker - LangGraph Implementation.

A multi-node graph that:
1. Generates preliminary screening questions based on symptoms
2. Collects user answers (human-in-the-loop)
3. Generates differential diagnosis based on symptom + Q&A
"""

from typing import Annotated

from pydantic import BaseModel, Field
from typing_extensions import TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages
from langgraph.types import interrupt
from langgraph.checkpoint.memory import InMemorySaver
from langchain_openai import ChatOpenAI
from langchain_core.messages import AnyMessage, SystemMessage, HumanMessage


# ============================================================================
# STRUCTURED OUTPUT SCHEMAS
# ============================================================================


class Question(BaseModel):
    """A single screening question."""

    question: str = Field(description="The question text to ask the patient")
    purpose: str = Field(description="Why this question helps with diagnosis")


class PreliminaryQuestions(BaseModel):
    """Structured output for symptom screening questions."""

    preliminary_questions: list[Question] = Field(
        description="3-5 focused follow-up questions"
    )


class Diagnosis(BaseModel):
    """A single diagnosis in the differential."""

    condition: str = Field(description="Name of the condition")
    probability: float = Field(description="Likelihood from 0.0 to 1.0")
    reasoning: str = Field(description="Why this condition is considered")
    severity: str = Field(
        description="Severity classification: 'life_threatening', 'serious', 'moderate', or 'mild'"
    )


class DifferentialDiagnosis(BaseModel):
    """Structured output for differential diagnosis."""

    differential: list[Diagnosis] = Field(
        description="List of possible conditions ranked by probability"
    )
    disclaimer: str = Field(
        default="This is for educational purposes only. Always consult a healthcare provider."
    )


class QAPair(BaseModel):
    """A question-answer pair from the interview."""

    question: str = Field(description="The original question asked")
    answer: str = Field(description="The extracted answer from user's response")


class ExtractedAnswers(BaseModel):
    """Structured output for extracted Q&A pairs from user's free-text response."""

    qa_pairs: list[QAPair] = Field(
        description="List of questions paired with extracted answers"
    )


class RefinementQuestion(BaseModel):
    """A single refinement question to narrow down the DDX."""

    question: str = Field(description="The follow-up question to ask")
    purpose: str = Field(description="Why this question helps refine the diagnosis")


class FinalSummary(BaseModel):
    """Final summary for the user."""

    top_diagnosis: str = Field(description="The most likely diagnosis")
    probability: float = Field(description="Probability of the top diagnosis (0.0 to 1.0)")
    explanation: str = Field(description="Brief explanation of why this is the most likely diagnosis")
    disclaimer: str = Field(
        default="This is for educational purposes only. Always consult a healthcare provider for proper diagnosis and treatment."
    )


# ============================================================================
# MODEL CONFIGURATION
# ============================================================================

model = ChatOpenAI(
    model="gpt-5.1",
    reasoning_effort="medium",
    max_tokens=4096,
)

questions_model = model.with_structured_output(PreliminaryQuestions)
ddx_model = model.with_structured_output(DifferentialDiagnosis)
answer_extractor_model = model.with_structured_output(ExtractedAnswers)
refinement_question_model = model.with_structured_output(RefinementQuestion)
summary_model = model.with_structured_output(FinalSummary)


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
"""

DDX_GENERATOR_PROMPT = """You are a medical diagnostic assistant. Based on the patient's 
reported symptoms and their answers to screening questions, generate a differential diagnosis.

Consider:
- The initial symptom(s) reported
- All answers provided to follow-up questions
- Common conditions that match the symptom pattern
- Any red flags that suggest urgent conditions

For each condition, provide:
- Probability (0.0 to 1.0)
- Reasoning for why this condition is considered
- Severity classification:
  - "life_threatening": Conditions that could cause death or permanent disability if untreated
  - "serious": Conditions requiring prompt medical attention
  - "moderate": Conditions needing medical evaluation but not urgent
  - "mild": Self-limiting or easily treatable conditions

Rank conditions by probability and provide reasoning for each.
"""

ANSWER_EXTRACTOR_PROMPT = """You are an assistant that extracts answers from a patient's 
free-text response and maps them to specific medical screening questions.

Given a list of questions and the patient's response (which may answer multiple questions 
in a conversational way), extract the relevant answer for each question.

If the patient didn't address a specific question, use "Not mentioned" as the answer.
If the answer is unclear or ambiguous, extract what you can and note the uncertainty.
"""

REFINEMENT_PROMPT = """You are a medical diagnostic assistant. Your task is to generate 
a single follow-up question that would best help narrow down the differential diagnosis.

Given:
- The patient's initial symptom
- All Q&A from the interview so far
- The current differential diagnosis list

Generate ONE targeted question that would:
- Help differentiate between the top conditions
- Rule in or rule out life-threatening conditions
- Gather information not yet covered by previous questions

The question must be exactly ONE question - never combine multiple questions.
"""

DDX_REFINE_PROMPT = """You are a medical diagnostic assistant. Your task is to refine the 
differential diagnosis based on a new piece of information from the patient.

Given:
- The current differential diagnosis list
- A new question that was asked and the patient's answer

Update the differential diagnosis by:
- Adjusting probabilities based on the new information
- Removing conditions that are now unlikely
- Adding conditions if the new information suggests them
- Updating reasoning to reflect the new evidence

For each condition, maintain the severity classification:
- "life_threatening": Conditions that could cause death or permanent disability if untreated
- "serious": Conditions requiring prompt medical attention
- "moderate": Conditions needing medical evaluation but not urgent
- "mild": Self-limiting or easily treatable conditions

Provide the refined differential diagnosis list.
"""

FINAL_SUMMARY_PROMPT = """You are a medical assistant providing a final summary to a patient.

Given the differential diagnosis list, provide a brief, clear summary including:
- The most likely diagnosis (top condition)
- Its probability
- A brief, patient-friendly explanation of why this is the most likely diagnosis

Keep the explanation simple and avoid medical jargon where possible.
"""


# ============================================================================
# STATE DEFINITION
# ============================================================================


class State(TypedDict):
    """Graph state for symptom checker."""

    messages: Annotated[list[AnyMessage], add_messages]
    symptom_input: str
    preliminary_questions: PreliminaryQuestions | None
    qa_pairs: list[dict] | None  # List of {"question": str, "answer": str}
    differential_diagnosis: DifferentialDiagnosis | None
    # Refinement loop state
    refinement_qa_pairs: list[dict] | None  # Additional Q&A from refinement
    current_refinement_question: str | None  # The current question being asked
    refined_ddx: DifferentialDiagnosis | None  # Refined DDX (separate from initial)
    refinement_count: int  # Number of refinement iterations
    final_summary: FinalSummary | None  # Final summary for the user


# ============================================================================
# NODES
# ============================================================================


def generate_questions(state: State) -> dict:
    """
    Node 1: Generate preliminary screening questions based on reported symptoms.
    """
    # Extract symptom from the last user message
    symptom = ""
    for msg in reversed(state["messages"]):
        if isinstance(msg, HumanMessage):
            symptom = msg.content
            break

    messages = [
        SystemMessage(content=QUESTION_GENERATOR_PROMPT),
        HumanMessage(content=f"Patient reports: {symptom}"),
    ]

    response: PreliminaryQuestions = questions_model.invoke(messages)

    return {
        "symptom_input": symptom,
        "preliminary_questions": response,
    }


def collect_answers(state: State) -> dict:
    """
    Node 2: Pause execution and wait for user to answer the questions.
    Uses interrupt() for human-in-the-loop.
    User can provide answers in plain text - LLM will extract and map them.
    """
    questions = state["preliminary_questions"]

    # Prepare the questions to show the user
    questions_list = [q.question for q in questions.preliminary_questions]

    # Interrupt and wait for user answers
    # User can now just type plain text like: "It started 2 days ago, pain is 7/10, no fever"
    user_response = interrupt({
        "questions": questions_list,
        "instructions": "Please answer the questions above. You can respond naturally - no special format needed.",
    })

    # Get user's plain text response
    user_text = user_response if isinstance(user_response, str) else user_response.get("text", str(user_response))

    # Use LLM to extract and map answers to questions
    questions_formatted = "\n".join(f"{i+1}. {q}" for i, q in enumerate(questions_list))

    messages = [
        SystemMessage(content=ANSWER_EXTRACTOR_PROMPT),
        HumanMessage(content=f"""Questions asked:
{questions_formatted}

Patient's response:
{user_text}

Extract the answer for each question from the patient's response."""),
    ]

    extracted: ExtractedAnswers = answer_extractor_model.invoke(messages)

    # Convert to dict format for state
    qa_pairs = [{"question": qa.question, "answer": qa.answer} for qa in extracted.qa_pairs]

    return {"qa_pairs": qa_pairs}


def generate_ddx(state: State) -> dict:
    """
    Node 3: Generate differential diagnosis based on symptom + Q&A.
    """
    # Build context from symptom and Q&A
    qa_text = "\n".join(
        f"Q: {qa['question']}\nA: {qa['answer']}"
        for qa in state["qa_pairs"]
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

    messages = [
        SystemMessage(content=DDX_GENERATOR_PROMPT),
        HumanMessage(content=user_content),
    ]

    response: DifferentialDiagnosis = ddx_model.invoke(messages)

    return {"differential_diagnosis": response}


def generate_refinement_question(state: State) -> dict:
    """
    Node 4: Generate a refinement question to narrow down the DDX.
    """
    # Build full Q&A context
    qa_text = "\n".join(
        f"Q: {qa['question']}\nA: {qa['answer']}"
        for qa in state["qa_pairs"]
    )

    refinement_qa = state.get("refinement_qa_pairs") or []
    if refinement_qa:
        refinement_text = "\n".join(
            f"Q: {qa['question']}\nA: {qa['answer']}"
            for qa in refinement_qa
        )
        qa_text += f"\n\nRefinement questions:\n{refinement_text}"

    # Build DDX summary - use refined if available, otherwise initial
    ddx = state.get("refined_ddx") or state["differential_diagnosis"]
    ddx_text = "\n".join(
        f"- {d.condition} ({d.probability:.0%}, {d.severity}): {d.reasoning}"
        for d in ddx.differential
    )

    user_content = f"""Patient's initial symptom: {state["symptom_input"]}

All Q&A so far:
{qa_text}

Current differential diagnosis:
{ddx_text}

Generate ONE follow-up question to help narrow down this differential."""

    messages = [
        SystemMessage(content=REFINEMENT_PROMPT),
        HumanMessage(content=user_content),
    ]

    question: RefinementQuestion = refinement_question_model.invoke(messages)

    return {
        "current_refinement_question": question.question,
    }


def collect_refinement_answer(state: State) -> dict:
    """
    Node 5: Pause and collect user's answer to the refinement question.
    """
    question = state["current_refinement_question"]

    user_response = interrupt({
        "refinement_question": question,
        "instructions": "Please answer this follow-up question.",
    })

    user_text = user_response if isinstance(user_response, str) else user_response.get("text", str(user_response))

    # Add to refinement Q&A pairs
    existing_refinement_qa = state.get("refinement_qa_pairs") or []
    new_qa = {"question": question, "answer": user_text}

    return {
        "refinement_qa_pairs": existing_refinement_qa + [new_qa],
    }


def refine_ddx(state: State) -> dict:
    """
    Node 6: Refine the DDX based on the latest refinement Q&A.
    """
    # Get the current DDX (use refined if available, otherwise initial)
    current_ddx = state.get("refined_ddx") or state["differential_diagnosis"]

    # Get the latest refinement Q&A
    refinement_qa = state.get("refinement_qa_pairs") or []
    latest_qa = refinement_qa[-1] if refinement_qa else None

    if not latest_qa:
        return {}

    # Build DDX summary
    ddx_text = "\n".join(
        f"- {d.condition} ({d.probability:.0%}, {d.severity}): {d.reasoning}"
        for d in current_ddx.differential
    )

    user_content = f"""Current differential diagnosis:
{ddx_text}

New information:
Q: {latest_qa['question']}
A: {latest_qa['answer']}

Based on this new information, provide a refined differential diagnosis."""

    messages = [
        SystemMessage(content=DDX_REFINE_PROMPT),
        HumanMessage(content=user_content),
    ]

    response: DifferentialDiagnosis = ddx_model.invoke(messages)

    # Increment refinement count
    current_count = state.get("refinement_count") or 0

    return {
        "refined_ddx": response,
        "current_refinement_question": None,
        "refinement_count": current_count + 1,
    }


def generate_final_summary(state: State) -> dict:
    """
    Node 7: Generate a final summary for the user.
    """
    # Get the final DDX (refined if available, otherwise initial)
    ddx = state.get("refined_ddx") or state["differential_diagnosis"]

    # Build DDX summary
    ddx_text = "\n".join(
        f"- {d.condition} ({d.probability:.0%}, {d.severity}): {d.reasoning}"
        for d in ddx.differential
    )

    user_content = f"""Differential diagnosis:
{ddx_text}

Provide a final summary for the patient."""

    messages = [
        SystemMessage(content=FINAL_SUMMARY_PROMPT),
        HumanMessage(content=user_content),
    ]

    summary: FinalSummary = summary_model.invoke(messages)

    return {"final_summary": summary}


MAX_REFINEMENT_ITERATIONS = 5


def should_continue_refinement(state: State) -> str:
    """
    Conditional edge: decide whether to continue refinement loop or end.
    
    Stop conditions:
    1. Life-threatening conditions total < 10% probability
    2. Top diagnosis > 50% probability
    3. Max iterations reached (safety limit)
    """
    # Check max iterations
    refinement_count = state.get("refinement_count") or 0
    if refinement_count >= MAX_REFINEMENT_ITERATIONS:
        return "end"

    # Get current DDX
    ddx = state.get("refined_ddx") or state["differential_diagnosis"]
    
    if not ddx or not ddx.differential:
        return "end"

    # Calculate life-threatening probability
    life_threatening_prob = sum(
        d.probability for d in ddx.differential
        if d.severity == "life_threatening"
    )

    # Get top diagnosis probability
    top_prob = max(d.probability for d in ddx.differential)

    # Stop if life-threatening < 10% AND top > 50%
    if life_threatening_prob < 0.10 and top_prob > 0.50:
        return "end"

    return "collect_refinement_answer"


# ============================================================================
# GRAPH BUILDER
# ============================================================================

builder = StateGraph(State)

# Add nodes
builder.add_node("generate_questions", generate_questions)
builder.add_node("collect_answers", collect_answers)
builder.add_node("generate_ddx", generate_ddx)
builder.add_node("generate_refinement_question", generate_refinement_question)
builder.add_node("collect_refinement_answer", collect_refinement_answer)
builder.add_node("refine_ddx", refine_ddx)
builder.add_node("generate_final_summary", generate_final_summary)

# Define edges
builder.add_edge(START, "generate_questions")
builder.add_edge("generate_questions", "collect_answers")
builder.add_edge("collect_answers", "generate_ddx")
builder.add_edge("generate_ddx", "generate_refinement_question")

# Conditional edge: continue refinement or go to summary
builder.add_conditional_edges(
    "generate_refinement_question",
    should_continue_refinement,
    {
        "collect_refinement_answer": "collect_refinement_answer",
        "end": "generate_final_summary",
    }
)

# After collecting answer, refine DDX, then check again
builder.add_edge("collect_refinement_answer", "refine_ddx")
builder.add_edge("refine_ddx", "generate_refinement_question")

# Final summary leads to END
builder.add_edge("generate_final_summary", END)

# Compile with checkpointer (required for interrupt)
checkpointer = InMemorySaver()
graph = builder.compile()



# ============================================================================
# USAGE EXAMPLE
# ============================================================================
# from langchain_core.messages import HumanMessage
# from langgraph.types import Command
#
# config = {"configurable": {"thread_id": "patient-123"}}
#
# # Step 1: Start with symptom - will pause at collect_answers
# result = graph.invoke(
#     {
#         "messages": [HumanMessage(content="I have a severe headache")],
#         "symptom_input": "",
#         "preliminary_questions": None,
#         "qa_pairs": None,
#         "differential_diagnosis": None,
#     },
#     config=config,
# )
#
# # Check the interrupt - shows questions to answer
# print(result["__interrupt__"])
#
# # Step 2: Resume with plain text answer (no special format needed!)
# result = graph.invoke(
#     Command(resume="It started about 2 days ago. The pain is throbbing, "
#                    "maybe 7 out of 10. I've had some nausea but no fever. "
#                    "Ibuprofen helps a little."),
#     config=config,
# )
#
# # Access the differential diagnosis
# ddx = result["differential_diagnosis"]
# print(f"Urgency: {ddx.urgency_level}")
# for d in ddx.differential:
#     print(f"- {d.condition}: {d.probability:.0%} - {d.reasoning}")
