"""
AI Agent for semantic compliance checking.
"""
import logging
import re
from typing import List, Dict, Any
from datetime import datetime

from ..checks.types import CheckResult, CheckContext, RequirementDefinition
from ..services.langchain_ai_service import LangChainAIService

logger = logging.getLogger(__name__)

class SemanticCheckAgent:
    """Agent responsible for AI-powered semantic compliance checking."""
    
    def __init__(self, ai_service: LangChainAIService):
        self.ai_service = ai_service
        self.context_memory: Dict[str, Any] = {}
    
    def run_semantic_check(self, requirement: RequirementDefinition, 
                          context: CheckContext) -> CheckResult:
        """Run an AI-powered semantic check."""
        try:
            response_data = self.ai_service.analyze_compliance_structured(
                requirement_name=requirement.name,
                requirement_description=requirement.description,
                section_key=context.section_key,
                document_text=context.document_text
            )

            response = f"Status: {response_data.get('status', 'FAIL')}\nConfidence: {response_data.get('confidence', 0.0)}\nMessage: {response_data.get('message', '')}\nDetails: {response_data.get('details', '')}"

            return self._parse_ai_response(response, requirement)
            
        except Exception as e:
            logger.error(f"Error in semantic check {requirement.name}: {e}")
            return CheckResult(
                status='failed',
                message=f"AI analysis failed: {str(e)}",
                details="The semantic check could not be completed due to an error."
            )
    
    def generate_new_checks_from_feedback(self, project_id: str, section_key: str,
                                        feedback: str, document_text: str) -> List[RequirementDefinition]:
        """Generate new check requirements based on user feedback."""
        try:
            response = self.ai_service.generate_checks_structured(
                section_key=section_key,
                feedback=feedback,
                document_excerpt=document_text[:1000] + "..."
            )
            return self._parse_generated_checks(response, section_key)

        except Exception as e:
            logger.error(f"Error generating checks from feedback: {e}")
            return []
    
    def accumulate_cross_section_context(self, project_id: str, section_key: str,
                                       document_text: str, check_results: List[CheckResult]):
        """Store context for cross-section validation."""
        if project_id not in self.context_memory:
            self.context_memory[project_id] = {}
        
        self.context_memory[project_id][section_key] = {
            'document_text': document_text,
            'check_results': [r.to_dict() for r in check_results],
            'timestamp': datetime.now().isoformat(),
            'key_findings': self._extract_key_findings(document_text, check_results)
        }
    

    

    
    def _parse_ai_response(self, response: str, requirement: RequirementDefinition) -> CheckResult:
        """Parse AI response into CheckResult."""
        lines = response.strip().split('\n')
        
        status = 'pending'
        confidence = 0.5
        message = 'AI analysis completed'
        details = response
        
        for line in lines:
            if line.startswith('Status:'):
                status_text = line.split(':', 1)[1].strip().lower()
                if status_text in ['pass', 'passed']:
                    status = 'passed'
                elif status_text in ['fail', 'failed']:
                    status = 'failed'
            elif line.startswith('Confidence:'):
                try:
                    confidence = float(line.split(':', 1)[1].strip())
                except ValueError:
                    pass
            elif line.startswith('Message:'):
                message = line.split(':', 1)[1].strip()
        
        return CheckResult(
            status=status,
            message=message,
            details=details,
            confidence=confidence,
            metadata={'requirement_id': requirement.id, 'ai_generated': True}
        )
    
    def _parse_generated_checks(self, response: str, section_key: str) -> List[RequirementDefinition]:
        """Parse AI-generated check definitions."""
        checks = []

        try:
            # Split response into check blocks
            check_blocks = re.split(r'CHECK \d+:', response)

            for block in check_blocks[1:]:  # Skip first empty block
                lines = [line.strip() for line in block.strip().split('\n') if line.strip()]

                name = ""
                description = ""
                function = ""
                priority = 5

                for line in lines:
                    if line.startswith('Name:'):
                        name = line.split(':', 1)[1].strip()
                    elif line.startswith('Description:'):
                        description = line.split(':', 1)[1].strip()
                    elif line.startswith('Function:'):
                        function = line.split(':', 1)[1].strip()
                    elif line.startswith('Priority:'):
                        try:
                            priority = int(line.split(':', 1)[1].strip())
                        except ValueError:
                            priority = 5

                if name and description and function:
                    check = RequirementDefinition(
                        id=f"generated_{len(checks)}",  # Temporary ID
                        section_key=section_key,
                        requirement_type='internal',
                        name=name,
                        description=description,
                        check_function=function,
                        priority=priority,
                        parameters={}
                    )
                    checks.append(check)

        except Exception as e:
            logger.error(f"Error parsing generated checks: {e}")

        return checks
    
    def _extract_key_findings(self, document_text: str, check_results: List[CheckResult]) -> Dict[str, Any]:
        """Extract key findings for cross-section context."""
        return {
            'word_count': len(document_text.split()),
            'failed_checks': len([r for r in check_results if r.status == 'failed']),
            'key_themes': []  # Would extract using NLP
        }
    

