"""Defense demo workbench endpoints for requirements linking."""

from __future__ import annotations

import hashlib
import io
import math
import re
from typing import Any, Dict, List, Set

import fitz  # PyMuPDF
import numpy as np
import cv2
import pytesseract
from PIL import Image
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from openai import OpenAI
from pydantic import BaseModel, Field

from ..config import settings
from ..supabase_client import get_supabase_client

router = APIRouter()

EMBEDDING_DIMENSION = 1536
CHUNK_SIZE = 900
CHUNK_OVERLAP = 120
PDF_TEXT_THRESHOLD = 80
OCR_CONFIG = "--oem 3 --psm 6"
PDF_DEBUG_PREVIEW_CHARS = 8000


class IngestRequirementsRequest(BaseModel):
    organization_id: str
    uploaded_by: str
    title: str
    raw_text: str
    source_name: str | None = None
    source_type: str = "text"


class IngestRequirementsResponse(BaseModel):
    requirements_document_id: str
    chunk_count: int
    page_count: int | None = None
    ocr_pages: int | None = None
    extraction_warnings: List[str] = []


class IngestWorkDocumentRequest(BaseModel):
    organization_id: str
    uploaded_by: str
    title: str
    raw_text: str


class WorkSectionModel(BaseModel):
    id: str
    section_key: str
    section_title: str
    content: str
    section_order: int


class IngestWorkDocumentResponse(BaseModel):
    work_document_id: str
    sections: List[WorkSectionModel]
    page_count: int | None = None
    ocr_pages: int | None = None
    extraction_warnings: List[str] = []


class LinkRequirementsRequest(BaseModel):
    organization_id: str
    work_document_id: str
    requirements_document_id: str | None = None
    max_links_per_section: int = Field(default=5, ge=1, le=20)
    min_similarity: float = Field(default=0.65, ge=0.0, le=1.0)


class SectionLinkResult(BaseModel):
    work_section_id: str
    section_title: str
    links: List[Dict[str, Any]]


class LinkRequirementsResponse(BaseModel):
    linked_sections: List[SectionLinkResult]


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _insert_heading_line_breaks(text: str) -> str:
    """Recover section boundaries when PDF extraction collapses headings inline."""
    updated = text
    updated = re.sub(r"\s+(Section\s+\d+[A-Za-z]?\s*[:\-])", r"\n\1", updated, flags=re.IGNORECASE)
    updated = re.sub(r"\s+(\d+\.\d+(?:\.\d+)?\s+[A-Z][^:\n]{1,120}:)", r"\n\1", updated)
    updated = re.sub(r"\s+(\d+\.\s+[A-Z][^:\n]{1,120}:)", r"\n\1", updated)
    updated = re.sub(r"\s+-\s(?=[A-Za-z])", r"\n- ", updated)
    return updated


def _line_looks_like_table_row(line: str) -> bool:
    stripped = line.strip()
    if not stripped:
        return False
    if "|" in stripped or "\t" in stripped:
        return True
    if re.search(r"\S+\s{2,}\S+", stripped):
        token_count = len(re.findall(r"\S+", stripped))
        return token_count >= 3
    return False


def _format_table_and_text_blocks(page_text: str, page_number: int) -> str:
    lines = [line.rstrip() for line in page_text.splitlines()]
    if not lines:
        return ""

    blocks: List[str] = []
    table_lines: List[str] = []
    text_lines: List[str] = []

    def flush_text() -> None:
        nonlocal text_lines
        joined = "\n".join([line for line in text_lines if line.strip()]).strip()
        if joined:
            blocks.append(joined)
        text_lines = []

    def flush_table() -> None:
        nonlocal table_lines
        joined = "\n".join([line for line in table_lines if line.strip()]).strip()
        if joined:
            blocks.append(f"[TABLE: page {page_number}]\n{joined}")
        table_lines = []

    for line in lines:
        if _line_looks_like_table_row(line):
            flush_text()
            table_lines.append(line)
        else:
            flush_table()
            text_lines.append(line)

    flush_text()
    flush_table()
    return "\n\n".join(blocks).strip()


def _page_figure_placeholder(page: fitz.Page, fallback_text: str, page_number: int) -> str | None:
    caption_match = re.search(r"(figure|fig\.|chart|graph)[^\n]{0,100}", fallback_text, re.IGNORECASE)
    if caption_match:
        return f"[FIGURE: page {page_number}] {caption_match.group(0).strip()}"

    has_images = len(page.get_images(full=True)) > 0
    has_drawings = len(page.get_drawings()) >= 3
    if not has_images and not has_drawings:
        return None

    return f"[FIGURE: page {page_number}]"


def _preprocess_image_for_ocr(page: fitz.Page) -> np.ndarray:
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    image = Image.open(io.BytesIO(pix.tobytes("png")))
    arr = np.array(image)
    if arr.ndim == 3:
        gray = cv2.cvtColor(arr, cv2.COLOR_RGB2GRAY)
    else:
        gray = arr

    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    thresh = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        15,
    )

    coords = np.column_stack(np.where(thresh < 255))
    if coords.size > 0:
        angle = cv2.minAreaRect(coords)[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle

        h, w = thresh.shape[:2]
        center = (w // 2, h // 2)
        matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
        deskewed = cv2.warpAffine(
            thresh,
            matrix,
            (w, h),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE,
        )
        return deskewed
    return thresh


def _extract_pdf_text_with_hybrid_ocr(file_bytes: bytes) -> Dict[str, Any]:
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid PDF file: {exc}") from exc

    pages_output: List[str] = []
    page_count = document.page_count
    ocr_pages = 0
    warnings: Set[str] = set()

    for idx in range(page_count):
        page = document[idx]
        page_number = idx + 1
        direct_text = page.get_text("text") or ""
        normalized_direct = _normalize_whitespace(direct_text)
        page_text = direct_text
        used_ocr = False

        if len(normalized_direct) < PDF_TEXT_THRESHOLD:
            try:
                processed = _preprocess_image_for_ocr(page)
                ocr_text = pytesseract.image_to_string(processed, config=OCR_CONFIG).strip()
                if ocr_text:
                    page_text = ocr_text
                    used_ocr = True
            except pytesseract.TesseractNotFoundError:
                warnings.add("tesseract_not_installed")
            except Exception:
                warnings.add(f"ocr_failed_page_{page_number}")

        structured_page_text = _format_table_and_text_blocks(page_text, page_number)
        figure_marker = _page_figure_placeholder(page, direct_text, page_number)
        if figure_marker:
            structured_page_text = f"{structured_page_text}\n\n{figure_marker}".strip()

        if structured_page_text:
            pages_output.append(structured_page_text)
        if used_ocr:
            ocr_pages += 1

    document.close()
    return {
        "text": "\n\n".join([page for page in pages_output if page]).strip(),
        "page_count": page_count,
        "ocr_pages": ocr_pages,
        "warnings": sorted(warnings),
    }


def _debug_log_pdf_extraction(endpoint_name: str, filename: str, extracted: Dict[str, Any]) -> None:
    preview = (extracted.get("text") or "")[:PDF_DEBUG_PREVIEW_CHARS]
    print(
        (
            f"[PDF DEBUG] endpoint={endpoint_name} file={filename} "
            f"pages={extracted.get('page_count')} ocr_pages={extracted.get('ocr_pages')} "
            f"warnings={extracted.get('warnings', [])} extracted_chars={len(extracted.get('text') or '')}"
        )
    )
    print(f"[PDF DEBUG] extracted_text_preview_start\n{preview}\n[PDF DEBUG] extracted_text_preview_end")


def _split_requirement_sections(raw_text: str) -> List[Dict[str, str]]:
    normalized_input = _insert_heading_line_breaks(raw_text)
    lines = [line.rstrip() for line in normalized_input.splitlines()]
    sections: List[Dict[str, str]] = []

    heading_regexes = [
        re.compile(r"^(Section\s+\d+[A-Za-z]?)\s*(?:[–\-:]|\.)\s*(.+)$", re.IGNORECASE),
        re.compile(r"^(\d+(?:\.\d+)+)\s*(?:[–\-:]|\.)?\s+(.+)$"),
        re.compile(r"^(\d+)\.\s+(.+)$"),
        re.compile(r"^(Section\s+\d+[A-Za-z]?)\s+(.+)$", re.IGNORECASE),
    ]

    current_id = "intro"
    current_title = "Introduction"
    current_lines: List[str] = []

    def flush_section() -> None:
        nonlocal current_lines
        content = "\n".join([line for line in current_lines if line.strip()]).strip()
        if content:
            sections.append(
                {
                    "section_id": current_id,
                    "section_title": current_title,
                    "content": content,
                }
            )
        current_lines = []

    for raw_line in lines:
        line = raw_line.strip()
        if not line:
            current_lines.append("")
            continue

        matched_heading = None
        for regex in heading_regexes:
            match = regex.match(line)
            if match:
                matched_heading = match
                break

        if matched_heading:
            flush_section()
            identifier = matched_heading.group(1).strip().lower().replace(" ", "_").replace(".", "_")
            identifier = re.sub(r"[^a-z0-9_]", "", identifier) or "section"
            current_id = identifier
            current_title = line
            continue

        current_lines.append(raw_line)

    flush_section()
    if sections:
        return sections

    content = raw_text.strip()
    if not content:
        return []
    return [{"section_id": "section_1", "section_title": "Section 1", "content": content}]


def _chunk_single_section(
    section_id: str,
    section_title: str,
    content: str,
    chunk_size: int = CHUNK_SIZE,
    overlap: int = CHUNK_OVERLAP,
) -> List[Dict[str, Any]]:
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", content) if p.strip()]
    if not paragraphs:
        return []

    chunks: List[Dict[str, Any]] = []
    current = ""
    chunk_local_index = 0

    def push_chunk(text: str) -> None:
        nonlocal chunk_local_index
        normalized = _normalize_whitespace(text)
        if not normalized:
            return
        chunks.append(
            {
                "chunk_text": normalized,
                "metadata": {
                    "section_id": section_id,
                    "section_title": section_title,
                    "section_chunk_index": chunk_local_index,
                },
            }
        )
        chunk_local_index += 1

    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}".strip() if current else paragraph
        if len(candidate) <= chunk_size:
            current = candidate
            continue

        if current:
            push_chunk(current)
            tail = current[-overlap:] if len(current) > overlap else current
            current = _normalize_whitespace(f"{tail} {paragraph}")
            if len(current) > chunk_size:
                while len(current) > chunk_size:
                    piece = current[:chunk_size]
                    push_chunk(piece)
                    current = current[max(chunk_size - overlap, 1):]
        else:
            long_text = paragraph
            while len(long_text) > chunk_size:
                push_chunk(long_text[:chunk_size])
                long_text = long_text[max(chunk_size - overlap, 1):]
            current = long_text

    if current:
        push_chunk(current)

    return chunks


def _chunk_requirements_document(raw_text: str) -> List[Dict[str, Any]]:
    sections = _split_requirement_sections(raw_text)
    chunks: List[Dict[str, Any]] = []
    for section in sections:
        chunks.extend(
            _chunk_single_section(
                section_id=section["section_id"],
                section_title=section["section_title"],
                content=section["content"],
            )
        )
    return chunks


def _excerpt_text(text: str, max_chars: int = 500) -> str:
    normalized = _normalize_whitespace(text)
    if len(normalized) <= max_chars:
        return normalized
    return normalized[: max_chars - 3] + "..."


def _deterministic_embedding(text: str, dim: int = EMBEDDING_DIMENSION) -> List[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values: List[float] = []
    for i in range(dim):
        byte_value = digest[i % len(digest)]
        values.append((byte_value / 255.0) * 2.0 - 1.0)
    return values


def _embed_text(text: str) -> List[float]:
    if settings.openai_api_key:
        try:
            client = OpenAI(api_key=settings.openai_api_key)
            response = client.embeddings.create(
                model="text-embedding-3-small",
                input=text,
            )
            return response.data[0].embedding
        except Exception:
            # Fallback keeps demo usable if provider is unavailable.
            return _deterministic_embedding(text)
    return _deterministic_embedding(text)


def _to_vector_literal(values: List[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in values) + "]"


def _parse_vector(value: Any) -> List[float]:
    if isinstance(value, list):
        return [float(x) for x in value]
    if isinstance(value, str):
        trimmed = value.strip().strip("[]")
        if not trimmed:
            return []
        return [float(x.strip()) for x in trimmed.split(",")]
    return []


def _cosine_similarity(vec_a: List[float], vec_b: List[float]) -> float:
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


STOPWORDS: Set[str] = {
    "the", "and", "for", "with", "this", "that", "shall", "must", "within", "between", "from",
    "under", "into", "during", "without", "including", "section", "equipment", "system",
    "operate", "operation", "requirements", "requirement", "criteria", "acceptance",
    "environment", "environments", "test", "tests", "exposure",
}


def _extract_tokens(text: str) -> Set[str]:
    words = re.findall(r"[a-zA-Z0-9]+", text.lower())
    return {w for w in words if len(w) > 2 and w not in STOPWORDS}


def _keyword_overlap_score(a: str, b: str) -> float:
    a_tokens = _extract_tokens(a)
    b_tokens = _extract_tokens(b)
    if not a_tokens or not b_tokens:
        return 0.0
    intersection = a_tokens.intersection(b_tokens)
    return len(intersection) / max(len(a_tokens), 1)


def _strip_leading_numbering(text: str) -> str:
    return re.sub(r"^\d+(?:\.\d+)*\s*", "", text).strip()


def _split_sections(raw_text: str) -> List[Dict[str, Any]]:
    # Try heading-based split first.
    normalized_input = _insert_heading_line_breaks(raw_text)
    lines = [line.strip() for line in normalized_input.splitlines()]
    sections: List[Dict[str, Any]] = []
    current_title = "Introduction"
    current_lines: List[str] = []

    heading_patterns = [
        re.compile(r"^Section\s+\d+[A-Za-z]?\s*[:\-].+$", re.IGNORECASE),
        re.compile(r"^(\d+(?:\.\d+)*)\.?\s+[A-Z].+$"),
    ]

    def flush_section() -> None:
        nonlocal current_title, current_lines
        content = "\n".join([line for line in current_lines if line]).strip()
        if content:
            sections.append(
                {
                    "section_title": current_title,
                    "content": content,
                }
            )
        current_lines = []

    for line in lines:
        if not line:
            current_lines.append(line)
            continue
        if any(pattern.match(line) for pattern in heading_patterns) or (line.isupper() and len(line) <= 90):
            flush_section()
            current_title = line
            continue
        current_lines.append(line)

    flush_section()
    if sections:
        return sections

    # Fallback: paragraph blocks.
    paragraphs = [p.strip() for p in raw_text.split("\n\n") if p.strip()]
    return [{"section_title": f"Section {i + 1}", "content": p} for i, p in enumerate(paragraphs)]


def _persist_requirements_from_text(
    request: IngestRequirementsRequest,
    supabase: Any,
    page_count: int | None = None,
    ocr_pages: int | None = None,
    extraction_warnings: List[str] | None = None,
) -> IngestRequirementsResponse:
    if not request.raw_text.strip():
        raise HTTPException(status_code=400, detail="raw_text cannot be empty")

    try:
        doc_result = supabase.table("requirements_documents").insert(
            {
                "organization_id": request.organization_id,
                "uploaded_by": request.uploaded_by,
                "title": request.title,
                "source_type": request.source_type,
                "source_name": request.source_name,
                "raw_text": request.raw_text,
            }
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Backend cannot connect to Supabase. "
                "Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend env."
            ),
        ) from exc

    if not doc_result.data:
        raise HTTPException(status_code=500, detail="Failed to create requirements document")

    document = doc_result.data[0]
    chunks = _chunk_requirements_document(request.raw_text)

    rows: List[Dict[str, Any]] = []
    for index, chunk in enumerate(chunks):
        chunk_text = chunk["chunk_text"]
        metadata = chunk["metadata"]
        embedding = _embed_text(chunk_text)
        rows.append(
            {
                "organization_id": request.organization_id,
                "requirements_document_id": document["id"],
                "chunk_index": index,
                "chunk_text": chunk_text,
                "embedding": _to_vector_literal(embedding),
                "metadata": {
                    "source_name": request.source_name,
                    "title": request.title,
                    **metadata,
                },
            }
        )

    if rows:
        try:
            supabase.table("requirements_chunks").insert(rows).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Failed writing requirement chunks to Supabase. "
                    "Verify backend Supabase credentials/project."
                ),
            ) from exc

    return IngestRequirementsResponse(
        requirements_document_id=document["id"],
        chunk_count=len(rows),
        page_count=page_count,
        ocr_pages=ocr_pages,
        extraction_warnings=extraction_warnings or [],
    )


def _persist_work_from_text(
    request: IngestWorkDocumentRequest,
    supabase: Any,
    page_count: int | None = None,
    ocr_pages: int | None = None,
    extraction_warnings: List[str] | None = None,
) -> IngestWorkDocumentResponse:
    if not request.raw_text.strip():
        raise HTTPException(status_code=400, detail="raw_text cannot be empty")

    try:
        doc_result = supabase.table("work_documents").insert(
            {
                "organization_id": request.organization_id,
                "uploaded_by": request.uploaded_by,
                "title": request.title,
                "raw_text": request.raw_text,
            }
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Backend cannot connect to Supabase. "
                "Check SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend env."
            ),
        ) from exc

    if not doc_result.data:
        raise HTTPException(status_code=500, detail="Failed to create work document")

    document = doc_result.data[0]
    sections = _split_sections(request.raw_text)
    section_rows = [
        {
            "organization_id": request.organization_id,
            "work_document_id": document["id"],
            "section_key": f"section-{idx + 1}",
            "section_title": section["section_title"],
            "content": section["content"],
            "section_order": idx + 1,
        }
        for idx, section in enumerate(sections)
    ]

    try:
        inserted = supabase.table("work_sections").insert(section_rows).execute() if section_rows else None
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Failed writing work sections to Supabase. "
                "Verify backend Supabase credentials/project."
            ),
        ) from exc
    inserted_sections = inserted.data if inserted and inserted.data else []

    return IngestWorkDocumentResponse(
        work_document_id=document["id"],
        sections=[
            WorkSectionModel(
                id=section["id"],
                section_key=section["section_key"],
                section_title=section["section_title"],
                content=section["content"],
                section_order=section["section_order"],
            )
            for section in inserted_sections
        ],
        page_count=page_count,
        ocr_pages=ocr_pages,
        extraction_warnings=extraction_warnings or [],
    )


@router.post("/requirements/ingest", response_model=IngestRequirementsResponse)
async def ingest_requirements(
    request: IngestRequirementsRequest,
    supabase=Depends(get_supabase_client),
):
    return _persist_requirements_from_text(request, supabase)


@router.post("/work/ingest", response_model=IngestWorkDocumentResponse)
async def ingest_work_document(
    request: IngestWorkDocumentRequest,
    supabase=Depends(get_supabase_client),
):
    return _persist_work_from_text(request, supabase)


@router.post("/requirements/ingest-pdf", response_model=IngestRequirementsResponse)
async def ingest_requirements_pdf(
    organization_id: str = Form(...),
    uploaded_by: str = Form(...),
    title: str = Form(...),
    source_name: str | None = Form(None),
    file: UploadFile = File(...),
    supabase=Depends(get_supabase_client),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    extracted = _extract_pdf_text_with_hybrid_ocr(file_bytes)
    _debug_log_pdf_extraction("requirements/ingest-pdf", file.filename, extracted)
    if not extracted["text"]:
        raise HTTPException(
            status_code=400,
            detail="Could not extract usable text from PDF. Try a clearer file or ensure OCR is available.",
        )

    request = IngestRequirementsRequest(
        organization_id=organization_id,
        uploaded_by=uploaded_by,
        title=title,
        raw_text=extracted["text"],
        source_name=source_name or file.filename,
        source_type="pdf",
    )
    return _persist_requirements_from_text(
        request,
        supabase,
        page_count=extracted["page_count"],
        ocr_pages=extracted["ocr_pages"],
        extraction_warnings=extracted["warnings"],
    )


@router.post("/work/ingest-pdf", response_model=IngestWorkDocumentResponse)
async def ingest_work_pdf(
    organization_id: str = Form(...),
    uploaded_by: str = Form(...),
    title: str = Form(...),
    file: UploadFile = File(...),
    supabase=Depends(get_supabase_client),
):
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    extracted = _extract_pdf_text_with_hybrid_ocr(file_bytes)
    _debug_log_pdf_extraction("work/ingest-pdf", file.filename, extracted)
    if not extracted["text"]:
        raise HTTPException(
            status_code=400,
            detail="Could not extract usable text from PDF. Try a clearer file or ensure OCR is available.",
        )

    request = IngestWorkDocumentRequest(
        organization_id=organization_id,
        uploaded_by=uploaded_by,
        title=title,
        raw_text=extracted["text"],
    )
    return _persist_work_from_text(
        request,
        supabase,
        page_count=extracted["page_count"],
        ocr_pages=extracted["ocr_pages"],
        extraction_warnings=extracted["warnings"],
    )


@router.post("/work/link", response_model=LinkRequirementsResponse)
async def link_work_sections(
    request: LinkRequirementsRequest,
    supabase=Depends(get_supabase_client),
):
    try:
        sections_result = (
            supabase.table("work_sections")
            .select("id, section_title, content")
            .eq("organization_id", request.organization_id)
            .eq("work_document_id", request.work_document_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Backend cannot read work sections from Supabase. "
                "Check backend Supabase configuration."
            ),
        ) from exc
    sections = sections_result.data or []
    if not sections:
        raise HTTPException(status_code=404, detail="No sections found for work_document_id")

    try:
        chunk_query = (
            supabase.table("requirements_chunks")
            .select("id, requirements_document_id, chunk_index, chunk_text, metadata, embedding")
            .eq("organization_id", request.organization_id)
        )
        if request.requirements_document_id:
            chunk_query = chunk_query.eq("requirements_document_id", request.requirements_document_id)
        chunks_result = chunk_query.execute()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=(
                "Backend cannot read requirement chunks from Supabase. "
                "Check backend Supabase configuration."
            ),
        ) from exc
    chunks = chunks_result.data or []
    if not chunks:
        raise HTTPException(status_code=404, detail="No requirement chunks found for organization")

    links_payload: List[Dict[str, Any]] = []
    response_sections: List[SectionLinkResult] = []

    for section in sections:
        section_embedding = _embed_text(section["content"])
        section_title = section["section_title"]
        section_topic = _strip_leading_numbering(section_title)
        section_query_text = f"{section_title}\n{section_topic}\n{section['content']}"
        scored = []
        for chunk in chunks:
            chunk_embedding = _parse_vector(chunk.get("embedding"))
            similarity = _cosine_similarity(section_embedding, chunk_embedding)
            chunk_metadata = chunk.get("metadata") or {}
            chunk_title = str(chunk_metadata.get("section_title", ""))
            lexical_score = _keyword_overlap_score(section_query_text, f"{chunk_title}\n{chunk['chunk_text']}")
            hybrid_score = (0.78 * similarity) + (0.22 * lexical_score)

            scored.append(
                {
                    "requirements_chunk_id": chunk["id"],
                    "chunk_text": _excerpt_text(chunk["chunk_text"]),
                    "chunk_index": chunk["chunk_index"],
                    "requirements_document_id": chunk["requirements_document_id"],
                    "metadata": chunk_metadata,
                    "similarity": similarity,
                    "hybrid_score": hybrid_score,
                }
            )

        scored.sort(key=lambda item: item["hybrid_score"], reverse=True)

        filtered = [
            item for item in scored
            if item["similarity"] >= request.min_similarity
            or item["hybrid_score"] >= (request.min_similarity * 0.9)
        ]

        if not filtered:
            filtered = [
                item for item in scored if item["similarity"] >= 0.35
            ][: max(2, request.max_links_per_section // 2)]

        top_matches = filtered[: request.max_links_per_section]

        for match in top_matches:
            links_payload.append(
                {
                    "organization_id": request.organization_id,
                    "work_section_id": section["id"],
                    "requirements_chunk_id": match["requirements_chunk_id"],
                    "similarity": match["similarity"],
                    "rationale": "Semantic match between section content and requirement chunk.",
                }
            )

        response_sections.append(
            SectionLinkResult(
                work_section_id=section["id"],
                section_title=section["section_title"],
                links=top_matches,
            )
        )

    if links_payload:
        try:
            # Best effort clear existing links for these sections, then insert refreshed links.
            for section in sections:
                supabase.table("section_requirement_links").delete().eq("work_section_id", section["id"]).execute()
            supabase.table("section_requirement_links").insert(links_payload).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Failed writing section links to Supabase. "
                    "Check backend Supabase configuration."
                ),
            ) from exc

    return LinkRequirementsResponse(linked_sections=response_sections)
