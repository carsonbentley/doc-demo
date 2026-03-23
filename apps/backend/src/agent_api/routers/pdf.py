"""PDF processing API endpoints for requirements checking."""

from typing import Optional
from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel

import fitz  # PyMuPDF
import io


router = APIRouter()


class PDFExtractionResponse(BaseModel):
    """Response model for PDF text extraction."""
    success: bool
    filename: str
    text: str
    page_count: int
    word_count: int
    error: Optional[str] = None


@router.post("/extract-text", response_model=PDFExtractionResponse)
async def extract_text_from_pdf(
    file: UploadFile = File(..., description="PDF file to extract text from")
):
    """
    Extract text content from a PDF file for requirements checking.

    This endpoint:
    1. Validates the uploaded PDF file
    2. Extracts text content and metadata
    3. Returns structured data for use in requirements checking
    """

    # Validate file type
    if not file.content_type or not file.content_type.startswith('application/pdf'):
        if not (file.filename and file.filename.lower().endswith('.pdf')):
            raise HTTPException(
                status_code=400,
                detail=f"File must be a PDF document. Received: {file.content_type}"
            )

    # Check file size (50MB limit)
    if file.size and file.size > 50 * 1024 * 1024:
        raise HTTPException(
            status_code=400,
            detail="File size must be less than 50MB"
        )

    try:
        # Read file content
        pdf_content = await file.read()

        if not pdf_content:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty"
            )

        # Extract text using PyMuPDF (fitz)
        try:
            pdf_document = fitz.open(stream=pdf_content, filetype="pdf")
            
            text = ""
            page_count = pdf_document.page_count
            
            for page_num in range(page_count):
                page = pdf_document[page_num]
                text += page.get_text() + "\n"
            
            pdf_document.close()
            word_count = len(text.split())
            
            return PDFExtractionResponse(
                success=True,
                filename=file.filename or "document.pdf",
                text=text.strip(),
                page_count=page_count,
                word_count=word_count
            )
            
        except Exception as e:
            return PDFExtractionResponse(
                success=False,
                filename=file.filename or "document.pdf",
                text="",
                page_count=0,
                word_count=0,
                error=f"Failed to extract text from PDF: {str(e)}"
            )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to process PDF: {str(e)}"
        )


@router.get("/health")
async def pdf_health_check():
    """Health check for PDF processing service."""
    return {
        "status": "healthy",
        "service": "pdf-processor",
        "supported_formats": ["application/pdf"],
        "max_file_size": "50MB"
    }
