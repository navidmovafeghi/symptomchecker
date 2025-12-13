"""
Property-based tests for Persian localization in the backend.

Tests validate that system prompts include language instructions when Persian is selected.
"""
import pytest
from hypothesis import given, strategies as st, settings

from src.infrastructure.symptom_checker_graph import (
    get_localized_prompt,
    QUESTION_GENERATOR_PROMPT,
    DDX_GENERATOR_PROMPT,
    REFINEMENT_QUESTION_PROMPT,
    FINAL_SUMMARY_PROMPT,
)


# ============== STRATEGIES ==============

# Strategy for valid language codes
language_strategy = st.sampled_from(['en', 'fa'])

# Strategy for base prompts (the actual prompts used in the system)
base_prompt_strategy = st.sampled_from([
    QUESTION_GENERATOR_PROMPT,
    DDX_GENERATOR_PROMPT,
    REFINEMENT_QUESTION_PROMPT,
    FINAL_SUMMARY_PROMPT,
])

# Strategy for arbitrary non-empty strings (for testing with any prompt)
arbitrary_prompt_strategy = st.text(min_size=1, max_size=500).filter(lambda s: s.strip())


# ============== PROPERTY TESTS ==============

# **Feature: persian-localization, Property 8: System prompt language inclusion**
# *For any* request with language='fa', the system prompt sent to the LLM SHALL 
# contain Persian language instructions.
# **Validates: Requirements 3.4**

@settings(max_examples=100)
@given(base_prompt=base_prompt_strategy)
def test_property_8_persian_prompt_includes_language_instructions(base_prompt: str):
    """Property 8: System prompt language inclusion.
    
    For any request with language='fa', the system prompt sent to the LLM SHALL
    contain Persian language instructions.
    """
    localized_prompt = get_localized_prompt(base_prompt, 'fa')
    
    # The localized prompt must contain Persian language instructions
    assert "Persian" in localized_prompt or "Farsi" in localized_prompt, \
        f"Persian prompt must mention 'Persian' or 'Farsi': {localized_prompt[-200:]}"
    
    # The localized prompt must contain the original base prompt
    assert base_prompt in localized_prompt, \
        "Localized prompt must contain the original base prompt"
    
    # The localized prompt must be longer than the base prompt (instructions added)
    assert len(localized_prompt) > len(base_prompt), \
        "Localized prompt must be longer than base prompt due to added instructions"


@settings(max_examples=100)
@given(base_prompt=base_prompt_strategy)
def test_property_8_english_prompt_unchanged(base_prompt: str):
    """Property 8: System prompt language inclusion (English case).
    
    For any request with language='en', the system prompt SHALL remain unchanged.
    """
    localized_prompt = get_localized_prompt(base_prompt, 'en')
    
    # The localized prompt must be exactly the same as the base prompt
    assert localized_prompt == base_prompt, \
        "English prompt must remain unchanged"


@settings(max_examples=100)
@given(base_prompt=arbitrary_prompt_strategy)
def test_property_8_arbitrary_prompt_persian_instructions(base_prompt: str):
    """Property 8: System prompt language inclusion (arbitrary prompts).
    
    For any arbitrary prompt with language='fa', the localized prompt SHALL
    contain Persian language instructions.
    """
    localized_prompt = get_localized_prompt(base_prompt, 'fa')
    
    # The localized prompt must contain Persian language instructions
    assert "Persian" in localized_prompt or "Farsi" in localized_prompt, \
        f"Persian prompt must mention 'Persian' or 'Farsi'"
    
    # The localized prompt must contain the original base prompt
    assert base_prompt in localized_prompt, \
        "Localized prompt must contain the original base prompt"


@settings(max_examples=100)
@given(base_prompt=arbitrary_prompt_strategy)
def test_property_8_arbitrary_prompt_english_unchanged(base_prompt: str):
    """Property 8: System prompt language inclusion (arbitrary prompts, English).
    
    For any arbitrary prompt with language='en', the prompt SHALL remain unchanged.
    """
    localized_prompt = get_localized_prompt(base_prompt, 'en')
    
    # The localized prompt must be exactly the same as the base prompt
    assert localized_prompt == base_prompt, \
        "English prompt must remain unchanged"


# ============== ADDITIONAL VALIDATION TESTS ==============

def test_persian_prompt_contains_medical_terminology_instruction():
    """Persian prompts should instruct the LLM to use appropriate medical terminology."""
    for base_prompt in [QUESTION_GENERATOR_PROMPT, DDX_GENERATOR_PROMPT, 
                        REFINEMENT_QUESTION_PROMPT, FINAL_SUMMARY_PROMPT]:
        localized_prompt = get_localized_prompt(base_prompt, 'fa')
        
        # Should mention medical terminology
        assert "medical terminology" in localized_prompt.lower(), \
            f"Persian prompt should mention medical terminology"


def test_persian_prompt_instructs_full_persian_response():
    """Persian prompts should instruct the LLM to respond entirely in Persian."""
    for base_prompt in [QUESTION_GENERATOR_PROMPT, DDX_GENERATOR_PROMPT, 
                        REFINEMENT_QUESTION_PROMPT, FINAL_SUMMARY_PROMPT]:
        localized_prompt = get_localized_prompt(base_prompt, 'fa')
        
        # Should instruct to respond entirely in Persian
        assert "entirely in Persian" in localized_prompt or "respond entirely" in localized_prompt.lower(), \
            f"Persian prompt should instruct to respond entirely in Persian"


def test_all_prompts_localized_consistently():
    """All system prompts should be localized consistently for Persian."""
    prompts = [
        QUESTION_GENERATOR_PROMPT,
        DDX_GENERATOR_PROMPT,
        REFINEMENT_QUESTION_PROMPT,
        FINAL_SUMMARY_PROMPT,
    ]
    
    for prompt in prompts:
        localized = get_localized_prompt(prompt, 'fa')
        
        # All should contain the same Persian instruction pattern
        assert "IMPORTANT:" in localized, \
            f"Persian prompt should contain 'IMPORTANT:' marker"
        assert "Persian" in localized, \
            f"Persian prompt should mention 'Persian'"


def test_default_language_is_english():
    """When no language is specified or unknown language, should behave like English."""
    base_prompt = "Test prompt"
    
    # English should return unchanged
    assert get_localized_prompt(base_prompt, 'en') == base_prompt
    
    # Unknown languages should return unchanged (fallback to English behavior)
    # Note: Current implementation only handles 'fa' specially
    assert get_localized_prompt(base_prompt, 'de') == base_prompt
    assert get_localized_prompt(base_prompt, 'es') == base_prompt
