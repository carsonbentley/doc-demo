"""
LangChain-based AI service for grant compliance analysis.

This service replaces the old AIClient with a more maintainable,
prompt-template-based approach using LangChain.
"""

import logging
import json
from typing import Dict, Any, List

from langchain_openai import ChatOpenAI
from langchain.chains import LLMChain
from langchain_core.runnables import RunnableSequence
from langchain_core.output_parsers import JsonOutputParser
from langchain_core.exceptions import OutputParserException

from ..config import settings
from ..prompts.compliance_prompts import (
    COMPLIANCE_REVIEWER_SYSTEM,
    GRANT_WRITING_EXPERT_SYSTEM,
    CHECK_GENERATOR_SYSTEM,
    COMPLIANCE_ANALYSIS_PROMPT,
    CHECK_GENERATION_PROMPT,
    WRITING_QUALITY_PROMPT,
    TECHNICAL_DEPTH_PROMPT,
    SECTION_QUALITY_PROMPT,
    ComplianceCheckResult
)
# Simple replacement types for the removed checks system
from typing import Dict, Any, Optional
from dataclasses import dataclass

@dataclass
class CheckResult:
    """Simple result type for AI analysis."""
    success: bool
    score: float
    feedback: str
    details: Optional[Dict[str, Any]] = None

@dataclass 
class CheckContext:
    """Simple context type for AI analysis."""
    content: str
    section_name: str
    organization_id: str
    metadata: Optional[Dict[str, Any]] = None

logger = logging.getLogger(__name__)


class LangChainAIService:
    """
    LangChain-based AI service for grant compliance analysis.
    
    This service provides a clean, maintainable interface for AI operations
    with externalized prompts and structured outputs.
    """
    
    def __init__(self):
        """Initialize the LangChain AI service."""
        # Initialize the LLM
        self.llm = ChatOpenAI(
            model=settings.openai_model,
            temperature=0.1,  # Default low temperature for consistency
            openai_api_key=settings.openai_api_key
        )
        
        # Initialize chains for different purposes
        self._setup_chains()
    
    def _setup_chains(self):
        """Set up LangChain chains for different AI operations."""
        
        # Compliance analysis chain
        self.compliance_chain = LLMChain(
            llm=self.llm,
            prompt=COMPLIANCE_ANALYSIS_PROMPT,
            verbose=False
        )
        

        
        # Check generation chain
        self.check_generation_llm = ChatOpenAI(
            model=settings.openai_model,
            temperature=0.3,  # Higher temperature for creativity
            max_tokens=800,
            openai_api_key=settings.openai_api_key
        )

        self.check_generation_chain = LLMChain(
            llm=self.check_generation_llm,
            prompt=CHECK_GENERATION_PROMPT,
            verbose=False
        )

        # Individual check chains
        self.writing_quality_chain = LLMChain(
            llm=self.llm,
            prompt=WRITING_QUALITY_PROMPT,
            verbose=False
        )

        self.technical_depth_chain = LLMChain(
            llm=self.llm,
            prompt=TECHNICAL_DEPTH_PROMPT,
            verbose=False
        )

        # Section quality analysis chain
        self.section_quality_chain = LLMChain(
            llm=self.llm,
            prompt=SECTION_QUALITY_PROMPT,
            verbose=False
        )
    
    def analyze_compliance(self, prompt: str, document_text: str, section_key: str) -> str:
        """Analyze document compliance using AI."""
        try:
            result = self.llm.invoke([
                {"role": "system", "content": COMPLIANCE_REVIEWER_SYSTEM},
                {"role": "user", "content": prompt}
            ])
            
            return result.content
            
        except Exception as e:
            logger.error(f"Compliance analysis failed: {e}")
            raise
    

    
    def generate_checks(self, prompt: str) -> str:
        """Generate new compliance checks based on feedback."""
        try:
            result = self.check_generation_chain.run(prompt=prompt)
            return result
            
        except Exception as e:
            logger.error(f"Check generation failed: {e}")
            raise
    
    def analyze_compliance_structured(
        self,
        requirement_name: str,
        requirement_description: str,
        section_key: str,
        document_text: str
    ) -> Dict[str, Any]:
        """
        New structured method for compliance analysis.
        
        This is the preferred method for new code - it uses proper
        prompt templates and structured inputs.
        """
        try:
            result = self.compliance_chain.run(
                requirement_name=requirement_name,
                requirement_description=requirement_description,
                section_key=section_key,
                document_text=document_text
            )
            
            # Parse the structured response
            # This is a simple parser - in production you might want more robust parsing
            lines = result.strip().split('\n')
            parsed = {}
            
            for line in lines:
                if line.startswith('Status:'):
                    parsed['status'] = line.split(':', 1)[1].strip()
                elif line.startswith('Confidence:'):
                    try:
                        parsed['confidence'] = float(line.split(':', 1)[1].strip())
                    except ValueError:
                        parsed['confidence'] = 0.5
                elif line.startswith('Message:'):
                    parsed['message'] = line.split(':', 1)[1].strip()
                elif line.startswith('Details:'):
                    parsed['details'] = line.split(':', 1)[1].strip()
            
            return parsed
            
        except Exception as e:
            logger.error(f"Structured compliance analysis failed: {e}")
            return {
                'status': 'FAIL',
                'confidence': 0.0,
                'message': 'Analysis failed',
                'details': str(e)
            }
    
    def generate_checks_structured(
        self,
        section_key: str,
        feedback: str,
        document_excerpt: str
    ) -> str:
        """
        New structured method for check generation.
        
        Uses proper prompt templates instead of f-strings.
        """
        try:
            result = self.check_generation_chain.run(
                section_key=section_key,
                feedback=feedback,
                document_excerpt=document_excerpt
            )
            return result

        except Exception as e:
            logger.error(f"Structured check generation failed: {e}")
            raise

    def analyze_writing_quality(self, context: CheckContext) -> CheckResult:
        """AI-powered writing quality assessment using LangChain."""
        try:
            # Truncate document text to avoid token limits
            truncated_text = context.document_text[:2000] + "..." if len(context.document_text) > 2000 else context.document_text

            # Run the chain
            response = self.writing_quality_chain.run(document_text=truncated_text)

            # Parse the response (simple regex-based parsing)
            score = 0.7  # Default
            status = 'passed'

            # Extract score if present
            import re
            score_match = re.search(r'Score:\s*([0-9.]+)', response)
            if score_match:
                score = float(score_match.group(1))

            # Extract status
            if 'Status: FAIL' in response or score < 0.7:
                status = 'failed'

            return CheckResult(
                status=status,
                message=f'Writing quality score: {score:.1%}',
                details=response,
                confidence=score,
                metadata={
                    'ai_score': score,
                    'model_used': settings.openai_model,
                    'service': 'langchain'
                }
            )

        except Exception as e:
            logger.error(f"LangChain writing quality check failed: {e}")
            return CheckResult(
                status='failed',
                message='AI writing quality check failed',
                details=str(e)
            )

    def analyze_technical_depth(self, context: CheckContext) -> CheckResult:
        """AI assessment of technical depth and feasibility using LangChain."""
        try:
            # Truncate document text to avoid token limits
            truncated_text = context.document_text[:2000] + "..." if len(context.document_text) > 2000 else context.document_text

            # Run the chain
            response = self.technical_depth_chain.run(document_text=truncated_text)

            # Parse the response
            score = 0.6  # Default
            status = 'passed'

            import re
            score_match = re.search(r'Score:\s*([0-9.]+)', response)
            if score_match:
                score = float(score_match.group(1))

            if 'Status: FAIL' in response or score < 0.6:
                status = 'failed'

            return CheckResult(
                status=status,
                message=f'Technical depth score: {score:.1%}',
                details=response,
                confidence=score,
                metadata={
                    'ai_score': score,
                    'model_used': settings.openai_model,
                    'service': 'langchain'
                }
            )

        except Exception as e:
            logger.error(f"LangChain technical depth check failed: {e}")
            return CheckResult(
                status='failed',
                message='AI technical depth check failed',
                details=str(e)
            )

    def analyze_section_quality(
        self,
        document_text: str,
        section_key: str,
        requirements: List[str]
    ) -> Dict[str, Any]:
        """
        Analyze section quality and generate review comments.

        This method generates specific, actionable feedback for document sections
        that can be used to create AI comment suggestions.
        """
        try:
            # Format requirements as a bulleted list
            requirements_list = "\n".join([f"- {req}" for req in requirements])

            # Truncate document text to avoid token limits
            truncated_text = document_text[:4000] + "..." if len(document_text) > 4000 else document_text

            # Run the section quality analysis chain
            response = self.section_quality_chain.run(
                section_key=section_key,
                requirements_list=requirements_list,
                document_text=truncated_text
            )

            # Parse JSON response
            try:
                import json
                parsed_response = json.loads(response.strip())

                # Ensure all expected fields are present with defaults
                result = {
                    'overall_score': parsed_response.get('overall_score', 0.7),
                    'strengths': parsed_response.get('strengths', []),
                    'weaknesses': parsed_response.get('weaknesses', []),
                    'specific_suggestions': parsed_response.get('specific_suggestions', []),
                    'compliance_issues': parsed_response.get('compliance_issues', []),
                    'readability_score': parsed_response.get('readability_score', 0.7)
                }

                return result

            except json.JSONDecodeError as json_error:
                logger.warning(f"Failed to parse JSON response: {json_error}")
                logger.warning(f"Raw response: {response}")

                # Fallback: extract suggestions from text response
                suggestions = []
                if "suggest" in response.lower() or "recommend" in response.lower():
                    # Simple text parsing to extract suggestions
                    lines = response.split('\n')
                    for line in lines:
                        line = line.strip()
                        if line and (
                            line.startswith('-') or
                            line.startswith('•') or
                            'suggest' in line.lower() or
                            'recommend' in line.lower() or
                            'should' in line.lower()
                        ):
                            suggestions.append(line.lstrip('- •'))

                return {
                    'overall_score': 0.6,
                    'strengths': [],
                    'weaknesses': [],
                    'specific_suggestions': suggestions[:5],  # Limit to 5 suggestions
                    'compliance_issues': [],
                    'readability_score': 0.6
                }

        except Exception as e:
            logger.error(f"Section quality analysis failed: {e}")
            return {
                'overall_score': 0.5,
                'strengths': [],
                'weaknesses': ['Analysis could not be completed'],
                'specific_suggestions': [
                    'Review document for compliance with grant requirements',
                    'Ensure all required sections are complete',
                    'Check formatting and structure'
                ],
                'compliance_issues': [],
                'readability_score': 0.5
            }
