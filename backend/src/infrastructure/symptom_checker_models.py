"""
Pydantic models for SymptomCheckerProvider structured outputs.

These models define the schema for LLM structured output binding,
ensuring type-safe and predictable responses throughout the
symptom checking workflow.
"""
from typing import Literal
from pydantic import BaseModel, Field


# ============== SEVERITY CLASSIFICATION ==============
SeverityLevel = Literal["life_threatening", "serious", "moderate", "mild"]


# ============== QUESTION MODELS ==============

class Question(BaseModel):
    """A single screening question with answer options.
    
    Used for both preliminary screening and refinement questions.
    The LLM generates contextually relevant options based on the question.
    """
    question: str = Field(
        description="The question text to ask the patient. Must be exactly one question without combining multiple questions."
    )
    purpose: str = Field(
        description="Why this question helps with diagnosis - explains the clinical relevance."
    )
    options: list[str] = Field(
        description="2-4 contextually relevant answer options for the patient to choose from.",
        min_length=2,
        max_length=4
    )


class PreliminaryQuestions(BaseModel):
    """Collection of initial screening questions based on reported symptoms.
    
    Contains 3-5 questions to gather essential information for differential diagnosis.
    """
    preliminary_questions: list[Question] = Field(
        description="3-5 preliminary screening questions relevant to the reported symptoms.",
        min_length=3,
        max_length=5
    )


# ============== DIAGNOSIS MODELS ==============

class Diagnosis(BaseModel):
    """A single diagnosis entry in the differential diagnosis.
    
    Represents one possible medical condition with its probability,
    clinical reasoning, and severity classification.
    """
    condition: str = Field(
        description="The name of the medical condition."
    )
    probability: float = Field(
        description="Probability of this diagnosis (0.0 to 1.0).",
        ge=0.0,
        le=1.0
    )
    reasoning: str = Field(
        description="Clinical reasoning explaining why this condition is considered."
    )
    severity: SeverityLevel = Field(
        description="Severity classification: life_threatening, serious, moderate, or mild."
    )


class DifferentialDiagnosis(BaseModel):
    """Full differential diagnosis with ranked conditions and disclaimer.
    
    Contains a list of possible diagnoses sorted by probability (descending)
    and a medical disclaimer for educational purposes.
    """
    differential: list[Diagnosis] = Field(
        description="Ranked list of possible diagnoses, sorted by probability in descending order."
    )
    disclaimer: str = Field(
        description="Medical disclaimer stating the information is for educational purposes only."
    )


# ============== ANSWER EXTRACTION MODELS ==============

class QAPair(BaseModel):
    """A question-answer pair from user interaction.
    
    Stores the question asked and the user's response for context building.
    """
    question: str = Field(
        description="The question that was asked."
    )
    answer: str = Field(
        description="The user's answer to the question."
    )


class ExtractedAnswers(BaseModel):
    """Collection of extracted question-answer pairs.
    
    Used when extracting structured answers from free-text user input.
    """
    qa_pairs: list[QAPair] = Field(
        description="List of extracted question-answer pairs."
    )


# ============== REFINEMENT MODELS ==============

class RefinementQuestion(BaseModel):
    """A follow-up question to narrow down the differential diagnosis.
    
    Enhanced to include question utility assessment for the comparative
    reasoning flow. When question_useful is False, the purpose field
    explains what would help differentiate (e.g., tests, imaging).
    """
    question: str = Field(
        description="The refinement question text. Must be exactly one question targeting differentiation between top conditions."
    )
    purpose: str = Field(
        description="Why this question helps narrow down the diagnosis, OR if question_useful is False, what would help (tests, imaging, etc.)."
    )
    options: list[str] = Field(
        description="2-4 contextually relevant answer options for the patient to choose from.",
        min_length=2,
        max_length=4
    )
    question_useful: bool = Field(
        default=True,
        description="Whether a history question can meaningfully differentiate between the top diagnoses. Set to False when tests/imaging are needed instead."
    )


# ============== FINAL SUMMARY MODEL ==============

class FinalSummary(BaseModel):
    """Patient-friendly summary of the diagnosis process.
    
    Generated when the refinement loop stops, providing the top diagnosis
    with explanation and appropriate medical disclaimer.
    """
    top_diagnosis: str = Field(
        description="The most likely diagnosis based on all collected information."
    )
    probability: float = Field(
        description="Probability of the top diagnosis (0.0 to 1.0).",
        ge=0.0,
        le=1.0
    )
    explanation: str = Field(
        description="Patient-friendly explanation of the diagnosis and recommended next steps."
    )
    disclaimer: str = Field(
        description="Medical disclaimer stating the information is for educational purposes only."
    )
