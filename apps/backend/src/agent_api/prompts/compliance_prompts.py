"""
Compliance analysis prompt templates.

These prompts are used for grant compliance checking and analysis.
"""

from langchain.prompts import PromptTemplate
from pydantic import BaseModel
from typing import List, Optional


# System prompts for different AI roles
COMPLIANCE_REVIEWER_SYSTEM = """You are an expert grant compliance reviewer with deep knowledge of NSF PAPPG requirements. Provide detailed, actionable feedback."""

GRANT_WRITING_EXPERT_SYSTEM = """You are a grant writing expert. Analyze documents and return valid JSON only."""

CHECK_GENERATOR_SYSTEM = """You are a grant compliance expert who creates specific, actionable compliance checks based on reviewer feedback."""


# Compliance analysis prompt
COMPLIANCE_ANALYSIS_PROMPT = PromptTemplate.from_template("""
You are a grant compliance expert. Analyze the following document section 
for compliance with this requirement:

Requirement: {requirement_name}
Description: {requirement_description}
Section: {section_key}

Document text to analyze:
{document_text}

Provide your analysis in this format:
Status: [PASS/FAIL/WARNING]
Confidence: [0.0-1.0]
Message: [brief summary]
Details: [specific findings and recommendations]
""")


# Section quality analysis prompt
SECTION_QUALITY_PROMPT = PromptTemplate.from_template("""
Analyze this {section_key} section for overall quality and compliance with NSF PAPPG requirements.

Requirements to consider:
{requirements_list}

Document text:
{document_text}

IMPORTANT: Respond ONLY with valid JSON in exactly this format (no additional text):
{{
    "overall_score": 0.8,
    "strengths": ["Clear research objectives", "Well-defined methodology"],
    "weaknesses": ["Missing budget justification", "Unclear timeline"],
    "specific_suggestions": ["Add detailed budget breakdown", "Include project milestones"],
    "compliance_issues": ["Section exceeds page limit", "Missing required citations"],
    "readability_score": 0.7
}}
""")


# Check generation from feedback prompt
CHECK_GENERATION_PROMPT = PromptTemplate.from_template("""
A reviewer gave this feedback about a {section_key} section:
"{feedback}"

Document excerpt: {document_excerpt}

Generate 1-2 specific compliance checks based on this feedback.

Format each check as:
CHECK 1:
Name: [Short descriptive name]
Description: [What this check validates - be specific]
Function: [suggest function name like check_budget_justification]
Priority: [1-10, where 10 is most critical]

CHECK 2:
Name: [Short descriptive name]
Description: [What this check validates - be specific]
Function: [suggest function name]
Priority: [1-10]
""")


# Writing quality assessment prompt
WRITING_QUALITY_PROMPT = PromptTemplate.from_template("""
Analyze the writing quality of this grant proposal section:

{document_text}

Rate the writing quality on these criteria:
- Clarity and readability
- Professional tone
- Grammar and style
- Logical flow

Respond with:
Score: [0.0-1.0]
Status: [PASS/FAIL] (PASS if score >= 0.7)
Issues: [list any major issues]
Suggestions: [specific improvements]
""")


# Technical depth assessment prompt
TECHNICAL_DEPTH_PROMPT = PromptTemplate.from_template("""
Evaluate the technical depth and feasibility of this research proposal:

{document_text}

Assess:
- Technical rigor and depth
- Feasibility of proposed methods
- Innovation level
- Clarity of technical approach

Respond with:
Score: [0.0-1.0]
Status: [PASS/FAIL] (PASS if score >= 0.6)
Strengths: [key technical strengths]
Concerns: [feasibility concerns]
""")


# Pydantic models for structured outputs
class ComplianceCheckResult(BaseModel):
    """Structured output for compliance check analysis."""
    status: str  # PASS/FAIL/WARNING
    confidence: float
    message: str
    details: str
