"""
AI Chat endpoints for simple question-answering.
"""
import logging
from typing import Dict, Any
from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel

from ..config import settings
from ..services.langchain_ai_service import LangChainAIService
from ..supabase_client import get_supabase_client

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ai-chat"])

# Pydantic models
class ChatRequest(BaseModel):
    question: str
    user_id: str = "test-user"  # Default for testing
    context: str = ""  # Optional context for better responses

class ChatResponse(BaseModel):
    response: str
    success: bool

class AuthRequest(BaseModel):
    email: str

class AuthResponse(BaseModel):
    success: bool
    user_id: str = ""
    message: str = ""

def get_ai_service() -> LangChainAIService:
    """Get AI service instance."""
    return LangChainAIService()

@router.post("/chat", response_model=ChatResponse)
async def ask_ai_question(
    request: ChatRequest,
    ai_service: LangChainAIService = Depends(get_ai_service)
):
    """
    Ask a simple question to the AI and get a concise 2-sentence response.

    This endpoint provides quick assistant responses for the in-app editor.

    Authentication temporarily disabled for testing.
    """
    try:
        # Skip authentication for testing
        logger.info(f"Processing AI question (no auth): {request.question[:50]}...")
        
        # Create a prompt for concise responses
        system_prompt = """You are a helpful AI assistant for defense proposal writing and requirements traceability. 
        Provide concise, actionable responses in exactly 2 sentences. 
        Focus on being helpful, specific, and professional."""
        
        user_prompt = f"""Question: {request.question}
        
        Context: {request.context if request.context else 'No additional context provided.'}
        
        Please provide a helpful response in exactly 2 sentences."""
        
        # Use the AI service to get a response
        try:
            result = ai_service.llm.invoke([
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ])
            
            ai_response = result.content.strip()
            
            # Ensure response is not too long (limit to ~200 characters for comments)
            if len(ai_response) > 200:
                # Try to truncate at sentence boundary
                sentences = ai_response.split('. ')
                if len(sentences) >= 2:
                    ai_response = '. '.join(sentences[:2]) + '.'
                else:
                    ai_response = ai_response[:197] + '...'
            
            return ChatResponse(
                response=ai_response,
                success=True
            )
            
        except Exception as ai_error:
            logger.error(f"AI service error: {ai_error}")
            # Provide a fallback response
            return ChatResponse(
                response="I'm having trouble processing your request right now. Please try again in a moment.",
                success=False
            )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in AI chat endpoint: {e}")
        raise HTTPException(status_code=500, detail="Failed to process AI request")

@router.post("/authenticate", response_model=AuthResponse)
async def authenticate_addon_user(
    request: AuthRequest,
    supabase=Depends(get_supabase_client)
):
    """
    Authenticate a user by email for lightweight API integrations.

    This endpoint verifies that the user exists in the app
    and returns their user ID for subsequent API calls.
    """
    try:
        # Look up user by email in the users table
        result = supabase.table('users').select('id, email').eq('email', request.email).single().execute()

        if result.data:
            return AuthResponse(
                success=True,
                user_id=result.data['id'],
                message="Authentication successful"
            )
        else:
            return AuthResponse(
                success=False,
                message="User not found. Please sign up in the app first."
            )

    except Exception as e:
        logger.error(f"Authentication error for email {request.email}: {e}")
        return AuthResponse(
            success=False,
            message="Authentication failed. Please try again."
        )

@router.get("/health")
async def ai_chat_health():
    """Health check for AI chat service."""
    try:
        # Test AI service initialization
        _ = LangChainAIService()
        return {"status": "healthy", "service": "ai-chat"}
    except Exception as e:
        logger.error(f"AI chat health check failed: {e}")
        return {"status": "unhealthy", "error": str(e)}
