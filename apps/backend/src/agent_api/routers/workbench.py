"""Defense demo workbench endpoints for requirements linking."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import logging
import threading
import io
import json
import math
import re
from typing import Any, Callable, Dict, Iterable, List, Set
from urllib.parse import quote

import fitz  # PyMuPDF
import numpy as np
import cv2
import pytesseract
import httpx
from PIL import Image
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from openai import OpenAI
from pydantic import BaseModel, Field

from ..config import settings
from ..supabase_client import get_supabase_client

router = APIRouter()
logger = logging.getLogger(__name__)

EMBEDDING_DIMENSION = 1536
CHUNK_SIZE = 900
CHUNK_OVERLAP = 120
PDF_TEXT_THRESHOLD = 80
OCR_CONFIG = "--oem 3 --psm 6"
PDF_DEBUG_PREVIEW_CHARS = 8000
OCR_TIMEOUT_SECONDS = 12
DISTILL_MAX_INPUT_CHARS = 1400
STORAGE_BUCKET = "workbench-source-documents"


def _sanitize_filename(name: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip(".-")
    return sanitized or "document.pdf"


def _public_storage_url(path: str) -> str:
    base_url = settings.supabase_url.rstrip("/")
    return f"{base_url}/storage/v1/object/public/{STORAGE_BUCKET}/{quote(path)}"


def _ensure_storage_bucket_exists() -> None:
    base_url = settings.supabase_url.rstrip("/")
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=10) as client:
        list_resp = client.get(f"{base_url}/storage/v1/bucket", headers=headers)
        if list_resp.status_code >= 400:
            return
        existing = list_resp.json() if list_resp.content else []
        if any(bucket.get("id") == STORAGE_BUCKET for bucket in existing):
            return
        client.post(
            f"{base_url}/storage/v1/bucket",
            headers=headers,
            json={"id": STORAGE_BUCKET, "name": STORAGE_BUCKET, "public": True},
        )


def _upload_pdf_to_storage(*, path: str, file_bytes: bytes) -> str | None:
    if not settings.supabase_url or not settings.supabase_service_key or not file_bytes:
        return None
    base_url = settings.supabase_url.rstrip("/")
    headers = {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/pdf",
        "x-upsert": "true",
    }
    try:
        _ensure_storage_bucket_exists()
        encoded_path = quote(path)
        with httpx.Client(timeout=30) as client:
            response = client.post(
                f"{base_url}/storage/v1/object/{STORAGE_BUCKET}/{encoded_path}",
                headers=headers,
                content=file_bytes,
            )
            if response.status_code >= 400:
                logger.warning("PDF storage upload failed status=%s path=%s", response.status_code, path)
                return None
        return _public_storage_url(path)
    except Exception as exc:
        logger.warning("PDF storage upload failed path=%s error=%s", path, exc)
        return None


def _build_pdf_storage_path(*, organization_id: str, document_kind: str, document_id: str, filename: str) -> str:
    safe_name = _sanitize_filename(filename)
    return f"{organization_id}/{document_kind}/{document_id}/{safe_name}"


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
    statement_count: int = 0
    page_count: int | None = None
    ocr_pages: int | None = None
    extraction_warnings: List[str] = []
    source_pdf_url: str | None = None


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
    metadata: Dict[str, Any] = {}


class IngestWorkDocumentResponse(BaseModel):
    work_document_id: str
    sections: List[WorkSectionModel]
    page_count: int | None = None
    ocr_pages: int | None = None
    extraction_warnings: List[str] = []
    source_pdf_url: str | None = None


class LinkRequirementsRequest(BaseModel):
    organization_id: str
    work_document_id: str
    requirements_document_id: str | None = None
    max_links_per_section: int = Field(default=3, ge=1, le=20)
    min_similarity: float = Field(default=0.75, ge=0.0, le=1.0)


class SectionLinkResult(BaseModel):
    work_section_id: str
    section_title: str
    work_section_metadata: Dict[str, Any] = {}
    links: List[Dict[str, Any]]


class LinkRequirementsResponse(BaseModel):
    linked_sections: List[SectionLinkResult]


class RequirementsStatusResponse(BaseModel):
    organization_id: str
    indexed: bool
    processing_status: str | None = None
    latest_requirements_document_id: str | None = None
    latest_title: str | None = None
    latest_source_type: str | None = None
    latest_source_name: str | None = None
    latest_raw_text: str | None = None
    chunk_count: int = 0
    statement_count: int = 0
    indexed_at: str | None = None
    page_count: int | None = None
    ocr_pages: int | None = None
    source_pdf_url: str | None = None


class WorkHistoryItem(BaseModel):
    work_document_id: str
    title: str
    created_at: str
    section_count: int
    link_count: int
    metadata: Dict[str, Any] = {}


class WorkHistoryResponse(BaseModel):
    organization_id: str
    items: List[WorkHistoryItem]


class WorkLastLinkedResponse(BaseModel):
    organization_id: str
    work_document_id: str | None = None


class WorkHistoryLinkItem(BaseModel):
    requirements_chunk_id: str
    chunk_index: int
    chunk_text: str
    requirements_document_id: str
    metadata: Dict[str, Any]
    similarity: float
    rationale: str | None = None


class WorkHistorySectionItem(BaseModel):
    work_section_id: str
    section_title: str
    section_order: int
    content: str
    metadata: Dict[str, Any] = {}
    links: List[WorkHistoryLinkItem]


class WorkHistoryDetailResponse(BaseModel):
    organization_id: str
    work_document_id: str
    title: str
    created_at: str
    sections: List[WorkHistorySectionItem]


class TextAnchor(BaseModel):
    start_offset: int
    end_offset: int
    snippet: str


class RequirementStatementItem(BaseModel):
    id: str
    statement_order: int
    section_title: str
    modal_verb: str
    category_label: str
    requirement_summary: str | None = None
    section_reference: str | None = None
    statement_text: str
    distilled_text: str | None = None
    source_quote: str | None = None
    note_text: str | None = None
    source_page: int | None = None
    text_anchor: TextAnchor | None = None


class RequirementStatementGroup(BaseModel):
    modal_verb: str
    category_label: str
    count: int
    items: List[RequirementStatementItem]


class RequirementStatementsResponse(BaseModel):
    organization_id: str
    requirements_document_id: str
    total_count: int
    groups: List[RequirementStatementGroup]


class RequirementStatementsSummaryResponse(BaseModel):
    organization_id: str
    requirements_document_id: str
    total_count: int
    by_modal_verb: Dict[str, int]


class StatementSowCitation(BaseModel):
    work_section_id: str
    section_title: str
    work_document_title: str | None = None
    source_document_name: str | None = None
    source_document_url: str | None = None
    quote: str
    similarity: float
    source_page: int | None = None
    text_anchor: TextAnchor | None = None


class StatementSowLinksEntry(BaseModel):
    requirement_statement_id: str
    citations: List[StatementSowCitation]


class StatementSowLinksResponse(BaseModel):
    organization_id: str
    requirements_document_id: str
    work_document_id: str
    statements: List[StatementSowLinksEntry]


def _normalize_whitespace(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _token_set_alnum(text: str) -> Set[str]:
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _statement_chunk_overlap_score(statement_text: str, chunk_text: str) -> float:
    """How well a distilled statement aligns with a requirements chunk (token coverage + substring)."""
    s_norm = _normalize_whitespace(statement_text)
    c_norm = _normalize_whitespace(chunk_text)
    if not s_norm or not c_norm:
        return 0.0
    sl = s_norm.lower()
    cl = c_norm.lower()
    if len(sl) >= 24 and sl in cl:
        return 0.92
    if len(cl) >= 24 and cl in sl:
        return 0.88
    st = _token_set_alnum(s_norm)
    ct = _token_set_alnum(c_norm)
    if not st:
        return 0.0
    return len(st & ct) / len(st)


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


def _extract_page_word_boxes(page: fitz.Page, ocr_image: np.ndarray | None = None) -> List[Dict[str, Any]]:
    words: List[Dict[str, Any]] = []
    page_rect = page.rect
    page_width = float(page_rect.width or 1.0)
    page_height = float(page_rect.height or 1.0)

    if ocr_image is not None:
        try:
            data = pytesseract.image_to_data(
                ocr_image,
                config=OCR_CONFIG,
                output_type=pytesseract.Output.DICT,
                timeout=OCR_TIMEOUT_SECONDS,
            )
            img_h, img_w = ocr_image.shape[:2]
            img_w = max(img_w, 1)
            img_h = max(img_h, 1)
            for i in range(len(data.get("text", []))):
                text = (data["text"][i] or "").strip()
                if not text:
                    continue
                conf = str(data.get("conf", ["-1"])[i] or "-1")
                try:
                    conf_val = float(conf)
                except Exception:
                    conf_val = -1.0
                if conf_val < 40:
                    continue
                x = float(data["left"][i]) / float(img_w)
                y = float(data["top"][i]) / float(img_h)
                w = float(data["width"][i]) / float(img_w)
                h = float(data["height"][i]) / float(img_h)
                words.append({"text": text, "x": x, "y": y, "width": w, "height": h})
            if words:
                return words
        except Exception:
            pass

    try:
        for row in page.get_text("words"):
            if len(row) < 5:
                continue
            x0, y0, x1, y1, text = row[:5]
            token = str(text or "").strip()
            if not token:
                continue
            x = float(x0) / page_width
            y = float(y0) / page_height
            w = max(0.0, float(x1) - float(x0)) / page_width
            h = max(0.0, float(y1) - float(y0)) / page_height
            words.append({"text": token, "x": x, "y": y, "width": w, "height": h})
    except Exception:
        return []
    return words


def _extract_pdf_text_with_hybrid_ocr(file_bytes: bytes) -> Dict[str, Any]:
    try:
        document = fitz.open(stream=file_bytes, filetype="pdf")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid PDF file: {exc}") from exc

    pages_output: List[Dict[str, Any]] = []
    page_count = document.page_count
    ocr_pages = 0
    warnings: Set[str] = set()
    page_word_boxes: List[Dict[str, Any]] = []

    for idx in range(page_count):
        page = document[idx]
        page_number = idx + 1
        direct_text = page.get_text("text") or ""
        normalized_direct = _normalize_whitespace(direct_text)
        page_text = direct_text
        used_ocr = False
        processed_for_ocr: np.ndarray | None = None

        if len(normalized_direct) < PDF_TEXT_THRESHOLD:
            try:
                processed = _preprocess_image_for_ocr(page)
                processed_for_ocr = processed
                ocr_text = pytesseract.image_to_string(
                    processed,
                    config=OCR_CONFIG,
                    timeout=OCR_TIMEOUT_SECONDS,
                ).strip()
                if ocr_text:
                    page_text = ocr_text
                    used_ocr = True
            except pytesseract.TesseractNotFoundError:
                warnings.add("tesseract_not_installed")
            except RuntimeError as exc:
                msg = str(exc).lower()
                if "time" in msg or "timeout" in msg:
                    warnings.add(f"ocr_timeout_page_{page_number}")
                else:
                    warnings.add(f"ocr_failed_page_{page_number}")
            except Exception:
                warnings.add(f"ocr_failed_page_{page_number}")

        structured_page_text = _format_table_and_text_blocks(page_text, page_number)
        figure_marker = _page_figure_placeholder(page, direct_text, page_number)
        if figure_marker:
            structured_page_text = f"{structured_page_text}\n\n{figure_marker}".strip()

        if structured_page_text:
            pages_output.append({"page_number": page_number, "text": structured_page_text})
        page_word_boxes.append(
            {
                "page_number": page_number,
                "words": _extract_page_word_boxes(page, ocr_image=processed_for_ocr)[:3000],
            }
        )
        if used_ocr:
            ocr_pages += 1

    merged_pages: List[str] = []
    page_spans: List[Dict[str, int]] = []
    cursor = 0
    for page in pages_output:
        text = page["text"]
        start_offset = cursor
        end_offset = start_offset + len(text)
        page_spans.append(
            {
                "page_number": page["page_number"],
                "start_offset": start_offset,
                "end_offset": end_offset,
            }
        )
        merged_pages.append(text)
        cursor = end_offset + 2

    document.close()
    return {
        "text": "\n\n".join(merged_pages).strip(),
        "page_count": page_count,
        "ocr_pages": ocr_pages,
        "warnings": sorted(warnings),
        "page_spans": page_spans,
        "page_word_boxes": page_word_boxes,
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
            inline_parts = re.split(r"\s*[–\-:]\s*", line, maxsplit=1)
            if len(inline_parts) == 2:
                trailing = inline_parts[1].strip()
                if len(trailing.split()) >= 4:
                    current_lines.append(trailing)
            continue

        current_lines.append(raw_line)

    flush_section()
    if sections:
        return sections

    content = raw_text.strip()
    if not content:
        return []
    return [{"section_id": "section_1", "section_title": "Section 1", "content": content}]


MODAL_VERBS = ("shall", "requires", "should", "may", "can")
MODAL_LABELS = {
    "shall": "Requirements",
    "requires": "Requirements",
    "should": "Recommendations",
    "may": "Permissions",
    "can": "Capabilities",
}


def _split_statement_units(text: str) -> List[str]:
    normalized = _insert_heading_line_breaks(text)
    normalized = re.sub(r"\s+(\d+\.\d+\s+[A-Z][^:\n]{1,140}:)", r"\n\1", normalized)
    normalized = re.sub(r"\s+(\d+\.\s+[A-Z][^:\n]{1,140}:)", r"\n\1", normalized)
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    normalized = re.sub(r"\n{2,}", "\n", normalized)
    normalized = re.sub(r"\s+", " ", normalized.replace("\n", " \n ")).strip()
    normalized = normalized.replace(" \n ", "\n")

    units: List[str] = []
    current = ""
    for token in re.split(r"(\n|(?<=[.!?;:])\s+)", normalized):
        if token is None or token == "":
            continue
        if token == "\n":
            if current.strip():
                units.append(current.strip())
                current = ""
            continue
        if re.match(r"(?<=[.!?;:])\s+", token):
            if current.strip():
                units.append(current.strip())
                current = ""
            continue
        current += token
    if current.strip():
        units.append(current.strip())
    return [u for u in units if u]


def _clean_extracted_sentence(text: str) -> str:
    cleaned = text
    cleaned = re.sub(r"\[TABLE:\s*page\s*\d+\]", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\[FIGURE:[^\]]*\]", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bpage\s+\d+\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def _extract_modal_clauses(text: str) -> List[Dict[str, str]]:
    cleaned_text = _clean_extracted_sentence(text)
    if not cleaned_text:
        return []

    clauses: List[Dict[str, str]] = []
    lower = cleaned_text.lower()
    for verb in MODAL_VERBS:
        for match in re.finditer(rf"\b{re.escape(verb)}\b", lower):
            start = match.start()
            end = match.end()

            # Expand to nearest punctuation boundaries around modal keyword.
            left_boundary = max(
                cleaned_text.rfind(".", 0, start),
                cleaned_text.rfind(";", 0, start),
                cleaned_text.rfind(":", 0, start),
            )
            right_candidates = [
                idx for idx in (
                    cleaned_text.find(".", end),
                    cleaned_text.find(";", end),
                    cleaned_text.find(":", end),
                ) if idx != -1
            ]
            right_boundary = min(right_candidates) if right_candidates else len(cleaned_text)

            clause = cleaned_text[left_boundary + 1:right_boundary + 1].strip()
            if len(clause) < 20:
                continue
            if len(clause) > 420:
                continue
            if clause.count(" ") < 4:
                continue

            clauses.append({"modal_verb": verb, "clause_text": clause})
    return clauses


def _extract_modal_verb(statement: str) -> str | None:
    lower = statement.lower()
    for verb in MODAL_VERBS:
        if re.search(rf"\b{re.escape(verb)}\b", lower):
            return verb
    return None


def _extract_section_reference_from_title(section_title: str) -> str | None:
    match = re.search(r"(section\s+\d+(?:\.\d+)*)", section_title, flags=re.IGNORECASE)
    if match:
        return match.group(1)
    match = re.search(r"^(\d+(?:\.\d+)*)", section_title)
    if match:
        return match.group(1)
    return None


def _distill_statement_heuristic(statement_text: str, modal_verb: str) -> str:
    cleaned = _normalize_whitespace(statement_text)
    cleaned = re.sub(r"^(note)\s*[:\-]\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^\d+(?:\.\d+)*\s*", "", cleaned)
    if not re.search(rf"\b{re.escape(modal_verb)}\b", cleaned, flags=re.IGNORECASE):
        cleaned = f"The subject {modal_verb} {cleaned}".strip()
    return cleaned


def _build_requirement_summary(text: str, max_words: int = 20) -> str:
    words = text.split()
    if len(words) <= max_words:
        return text
    return " ".join(words[:max_words]).rstrip(",;:.") + "..."


def _validate_distilled_fidelity(source_quote: str, distilled_text: str) -> bool:
    source_nums = _extract_numeric_tokens(source_quote)
    if not source_nums:
        return True
    distilled_nums = _extract_numeric_tokens(distilled_text)
    return source_nums.issubset(distilled_nums)


def _distill_statement_with_llm(
    *,
    section_title: str,
    modal_verb: str,
    source_quote: str,
) -> Dict[str, Any]:
    fallback = _distill_statement_heuristic(source_quote, modal_verb)
    fallback_summary = _build_requirement_summary(fallback)
    fallback_section_reference = _extract_section_reference_from_title(section_title)
    if not settings.openai_api_key:
        return {
            "requirement_summary": fallback_summary,
            "section_reference": fallback_section_reference,
            "distilled_text": fallback,
            "validation_passed": _validate_distilled_fidelity(source_quote, fallback),
            "used_llm": False,
        }

    prompt = (
        "You are a compliance requirements normalizer.\n"
        "Rewrite ONE requirement into a concise atomic statement while preserving exact numeric values, ranges, and units.\n"
        "Do not invent any content.\n"
        "Return ONLY valid JSON object with keys: requirement_summary, section_reference, distilled_text, quantitative_constraints, acceptance_criteria.\n"
        "requirement_summary must be <= 20 words and easy to scan.\n"
        "section_reference should preserve source section id if present (e.g., 'Section 4.1').\n"
        "distilled_text must keep the original modal verb semantics.\n"
    )
    user_payload = {
        "section_title": section_title,
        "modal_verb": modal_verb,
        "source_quote": source_quote[:DISTILL_MAX_INPUT_CHARS],
    }
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.responses.create(
            model=settings.openai_model,
            input=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": json.dumps(user_payload)},
            ],
            temperature=0,
        )
        text_output = response.output_text.strip()
        parsed = json.loads(text_output)
        distilled_text = _normalize_whitespace(str(parsed.get("distilled_text", "")).strip())
        if not distilled_text:
            distilled_text = fallback
        requirement_summary = _normalize_whitespace(str(parsed.get("requirement_summary", "")).strip())
        if not requirement_summary:
            requirement_summary = _build_requirement_summary(distilled_text)
        section_reference = _normalize_whitespace(str(parsed.get("section_reference", "")).strip())
        if not section_reference:
            section_reference = fallback_section_reference
        validation_passed = _validate_distilled_fidelity(source_quote, distilled_text)
        if not validation_passed:
            distilled_text = fallback
        return {
            "requirement_summary": requirement_summary,
            "section_reference": section_reference,
            "distilled_text": distilled_text,
            "quantitative_constraints": parsed.get("quantitative_constraints", []),
            "acceptance_criteria": parsed.get("acceptance_criteria"),
            "validation_passed": validation_passed,
            "used_llm": True,
        }
    except Exception:
        return {
            "requirement_summary": fallback_summary,
            "section_reference": fallback_section_reference,
            "distilled_text": fallback,
            "validation_passed": _validate_distilled_fidelity(source_quote, fallback),
            "used_llm": False,
        }


def _resolve_page_for_offset(offset: int, page_spans: List[Dict[str, int]] | None) -> int | None:
    if not page_spans:
        return None
    for span in page_spans:
        if span["start_offset"] <= offset <= span["end_offset"]:
            return int(span["page_number"])
    return None


def _build_text_anchor(raw_text: str, statement_text: str, start_hint: int) -> tuple[Dict[str, Any] | None, int]:
    if not raw_text or not statement_text:
        return None, start_hint
    lowered = raw_text.lower()
    needle = statement_text.lower()
    idx = lowered.find(needle, max(0, start_hint))
    if idx == -1:
        idx = lowered.find(needle)
    if idx == -1:
        # Fallback: tolerant token-sequence match for OCR/punctuation drift.
        tokens = [t for t in re.findall(r"[a-z0-9]+", needle) if len(t) > 2]
        tokens = tokens[:10]
        if len(tokens) >= 3:
            pattern = r"\b" + r"\W+".join(re.escape(tok) for tok in tokens[:5]) + r"\b"
            token_match = re.search(pattern, lowered[max(0, start_hint):], flags=re.IGNORECASE)
            if token_match:
                idx = max(0, start_hint) + token_match.start()
                end = max(0, start_hint) + token_match.end()
                snippet = raw_text[idx:end]
                return {
                    "start_offset": idx,
                    "end_offset": end,
                    "snippet": snippet,
                }, end
            token_match = re.search(pattern, lowered, flags=re.IGNORECASE)
            if token_match:
                idx = token_match.start()
                end = token_match.end()
                snippet = raw_text[idx:end]
                return {
                    "start_offset": idx,
                    "end_offset": end,
                    "snippet": snippet,
                }, end
        # Final fallback: anchor to a modal-keyword neighborhood from source text,
        # so every extracted requirement has a deterministic PDF reference point.
        anchor_tokens = [tok for tok in tokens if tok not in {"shall", "should", "may", "can", "requires"}]
        probe_tokens = anchor_tokens[:3] if anchor_tokens else tokens[:3]
        for probe in probe_tokens:
            probe_idx = lowered.find(probe, max(0, start_hint))
            if probe_idx == -1:
                probe_idx = lowered.find(probe)
            if probe_idx == -1:
                continue
            win_start = max(0, probe_idx - 140)
            win_end = min(len(raw_text), probe_idx + 220)
            snippet = raw_text[win_start:win_end].strip()
            if not snippet:
                continue
            return {
                "start_offset": win_start,
                "end_offset": win_end,
                "snippet": snippet,
            }, win_end
    if idx == -1:
        return None, start_hint
    end = idx + len(statement_text)
    snippet = raw_text[idx:end]
    return {
        "start_offset": idx,
        "end_offset": end,
        "snippet": snippet,
    }, end


def _iter_requirement_statement_candidates(
    raw_text: str,
    page_spans: List[Dict[str, int]] | None = None,
):
    sections = _split_requirement_sections(raw_text)
    seen: Set[str] = set()
    search_cursor = 0

    for section in sections:
        section_title = section["section_title"]
        units = _split_statement_units(section["content"])
        pending_note: str | None = None

        for unit in units:
            cleaned_unit = _normalize_whitespace(unit)
            if not cleaned_unit:
                continue

            if re.match(r"^(note)\b[:\-]?", cleaned_unit, flags=re.IGNORECASE):
                pending_note = _clean_extracted_sentence(cleaned_unit)
                continue

            modal_clauses = _extract_modal_clauses(cleaned_unit)
            for clause in modal_clauses:
                verb = clause["modal_verb"]
                statement_text = _normalize_whitespace(clause["clause_text"])
                if not statement_text:
                    continue
                dedupe_key = f"{verb}::{statement_text.lower()}"
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                text_anchor, search_cursor = _build_text_anchor(raw_text, statement_text, search_cursor)
                source_page = None
                if text_anchor:
                    source_page = _resolve_page_for_offset(text_anchor["start_offset"], page_spans)

                yield {
                    "section_title": section_title,
                    "modal_verb": verb,
                    "category_label": MODAL_LABELS[verb],
                    "statement_text": statement_text,
                    "statement_text_normalized": statement_text.lower(),
                    "note_text": pending_note,
                    "source_page": source_page,
                    "source_block_type": "text",
                    "metadata": {
                        "section_id": section["section_id"],
                        "source": "deterministic_modal_parser",
                        "text_anchor": text_anchor,
                    },
                }
                pending_note = None


def _distill_statement_record(statement: Dict[str, Any]) -> Dict[str, Any]:
    distilled = _distill_statement_with_llm(
        section_title=statement["section_title"],
        modal_verb=statement["modal_verb"],
        source_quote=statement["statement_text"],
    )
    metadata = statement.get("metadata") or {}
    return {
        **statement,
        "metadata": {
            **metadata,
            "requirement_summary": distilled.get("requirement_summary"),
            "section_reference": distilled.get("section_reference"),
            "distilled_text": distilled.get("distilled_text"),
            "quantitative_constraints": distilled.get("quantitative_constraints", []),
            "acceptance_criteria": distilled.get("acceptance_criteria"),
            "distillation_validation_passed": distilled.get("validation_passed"),
            "distillation_used_llm": distilled.get("used_llm"),
        },
    }


def _iter_requirement_statements(raw_text: str):
    for statement in _iter_requirement_statement_candidates(raw_text):
        yield _distill_statement_record(statement)


def _extract_requirement_statements(raw_text: str) -> List[Dict[str, Any]]:
    return list(_iter_requirement_statements(raw_text))


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


def _extract_numeric_tokens(text: str) -> Set[str]:
    values = re.findall(r"\b\d+(?:\.\d+)?\b", text)
    return {value.lstrip("0") or "0" for value in values}


def _numeric_overlap_score(a: str, b: str) -> float:
    a_nums = _extract_numeric_tokens(a)
    b_nums = _extract_numeric_tokens(b)
    if not a_nums:
        return 0.0
    if not b_nums:
        return 0.0
    return len(a_nums.intersection(b_nums)) / max(len(a_nums), 1)


PROCEDURE_TERMS: Set[str] = {
    "procedure",
    "procedures",
    "monitor",
    "record",
    "test",
    "testing",
    "chamber",
    "cycle",
    "cycling",
    "acceptance",
    "criteria",
    "compliance",
    "degradation",
    "performance",
}


def _procedure_overlap_score(a: str, b: str) -> float:
    a_tokens = _extract_tokens(a).intersection(PROCEDURE_TERMS)
    b_tokens = _extract_tokens(b).intersection(PROCEDURE_TERMS)
    if not a_tokens:
        return 0.0
    if not b_tokens:
        return 0.0
    return len(a_tokens.intersection(b_tokens)) / max(len(a_tokens), 1)


def _extract_section_references(text: str) -> Set[str]:
    refs: Set[str] = set()
    for match in re.findall(r"\bsection\s+(\d+(?:\.\d+)?)\b", text, flags=re.IGNORECASE):
        refs.add(match)
    for match in re.findall(r"\b(\d+\.\d+)\b", text):
        refs.add(match)
    return refs


def _section_reference_score(a: str, b: str) -> float:
    a_refs = _extract_section_references(a)
    b_refs = _extract_section_references(b)
    if not a_refs:
        return 0.0
    if not b_refs:
        return 0.0
    return len(a_refs.intersection(b_refs)) / max(len(a_refs), 1)


def _is_generic_intro_title(title: str) -> bool:
    normalized = title.strip().lower()
    return normalized in {"introduction", "intro", "overview"} or normalized.startswith("introduction ")


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
            inline_parts = re.split(r"\s*[–\-:]\s*", line, maxsplit=1)
            if len(inline_parts) == 2:
                trailing = inline_parts[1].strip()
                if len(trailing.split()) >= 4:
                    current_lines.append(trailing)
            continue
        current_lines.append(line)

    flush_section()
    if sections:
        return sections

    # Fallback: paragraph blocks.
    paragraphs = [p.strip() for p in raw_text.split("\n\n") if p.strip()]
    return [{"section_title": f"Section {i + 1}", "content": p} for i, p in enumerate(paragraphs)]


STATEMENT_INSERT_BATCH = 4


class _RequirementsDocProgress:
    """Thread-safe merged metadata writes for parallel chunk + statement ingestion."""

    def __init__(
        self,
        *,
        supabase: Any,
        document_id: str,
        base_metadata: Dict[str, Any],
        statement_candidates_total: int,
        chunk_total: int,
    ) -> None:
        self._supabase = supabase
        self._document_id = document_id
        self._base = dict(base_metadata)
        self._statement_candidates_total = statement_candidates_total
        self._chunk_total = chunk_total
        self._lock = threading.Lock()
        self.chunk_count = 0
        self.statement_count = 0

    def _flush(self, processing_status: str) -> None:
        meta = {
            **self._base,
            "chunk_count": self.chunk_count,
            "chunk_total": self._chunk_total,
            "statement_count": self.statement_count,
            "statement_candidates_total": self._statement_candidates_total,
            "processing_status": processing_status,
        }
        try:
            self._supabase.table("requirements_documents").update({"metadata": meta}).eq("id", self._document_id).execute()
        except Exception as exc:
            logger.warning(
                "requirements_documents metadata update failed (doc_id=%s): %s",
                self._document_id,
                exc,
            )

    def add_chunks(self, delta: int, processing_status: str | None = None) -> None:
        with self._lock:
            self.chunk_count += delta
            if processing_status is None:
                processing_status = "distilling" if self.statement_count > 0 else "indexing"
            self._flush(processing_status)

    def set_statement_count(self, count: int, processing_status: str = "distilling") -> None:
        with self._lock:
            self.statement_count = count
            self._flush(processing_status)

    def touch(self, processing_status: str = "indexing") -> None:
        with self._lock:
            self._flush(processing_status)

    def finalize(self, *, chunk_count: int, statement_count: int) -> None:
        with self._lock:
            self.chunk_count = chunk_count
            self.statement_count = statement_count
            self._flush("indexed")


def _persist_requirement_statements(
    *,
    organization_id: str,
    requirements_document_id: str,
    statements: Iterable[Dict[str, Any]],
    supabase: Any,
    on_progress: Callable[[int], None] | None = None,
) -> int:
    statement_candidates = list(statements)
    if not statement_candidates:
        return 0

    max_workers = min(8, max(1, len(statement_candidates)))
    batch_rows: List[Dict[str, Any]] = []
    inserted = 0

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_idx = {
            executor.submit(_distill_statement_record, statement): idx
            for idx, statement in enumerate(statement_candidates)
        }
        for future in as_completed(future_to_idx):
            idx = future_to_idx[future]
            statement = future.result()
            batch_rows.append(
                {
                    "organization_id": organization_id,
                    "requirements_document_id": requirements_document_id,
                    "statement_order": idx + 1,
                    "section_title": statement["section_title"],
                    "modal_verb": statement["modal_verb"],
                    "statement_text": statement["statement_text"],
                    "statement_text_normalized": statement["statement_text_normalized"],
                    "note_text": statement.get("note_text"),
                    "source_page": statement.get("source_page"),
                    "source_block_type": statement.get("source_block_type"),
                    "text_anchor": (statement.get("metadata") or {}).get("text_anchor"),
                    "metadata": statement.get("metadata") or {},
                }
            )
            if len(batch_rows) >= STATEMENT_INSERT_BATCH:
                try:
                    supabase.table("requirements_statements").insert(batch_rows).execute()
                except Exception as exc:
                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "Failed writing requirement statements to Supabase. "
                            "Verify backend Supabase credentials/project and migrations."
                        ),
                    ) from exc
                inserted += len(batch_rows)
                batch_rows = []
                if on_progress:
                    on_progress(inserted)

    if batch_rows:
        try:
            supabase.table("requirements_statements").insert(batch_rows).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Failed writing requirement statements to Supabase. "
                    "Verify backend Supabase credentials/project and migrations."
                ),
            ) from exc
        inserted += len(batch_rows)
        if on_progress:
            on_progress(inserted)
    return inserted


def _persist_requirements_from_text(
    request: IngestRequirementsRequest,
    supabase: Any,
    page_count: int | None = None,
    ocr_pages: int | None = None,
    extraction_warnings: List[str] | None = None,
    page_spans: List[Dict[str, int]] | None = None,
    page_word_boxes: List[Dict[str, Any]] | None = None,
    source_pdf_upload: Dict[str, Any] | None = None,
) -> IngestRequirementsResponse:
    if not request.raw_text.strip():
        raise HTTPException(status_code=400, detail="raw_text cannot be empty")

    try:
        document_metadata = {}
        if page_count is not None:
            document_metadata["page_count"] = page_count
        if ocr_pages is not None:
            document_metadata["ocr_pages"] = ocr_pages
        if extraction_warnings:
            document_metadata["extraction_warnings"] = extraction_warnings
        if page_spans:
            document_metadata["page_spans"] = page_spans
        if page_word_boxes:
            document_metadata["page_word_boxes"] = page_word_boxes
        document_metadata["processing_status"] = "indexing"
        doc_result = supabase.table("requirements_documents").insert(
            {
                "organization_id": request.organization_id,
                "uploaded_by": request.uploaded_by,
                "title": request.title,
                "source_type": request.source_type,
                "source_name": request.source_name,
                "raw_text": request.raw_text,
                "metadata": document_metadata,
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
    doc_id = document["id"]

    extracted_statements = list(_iter_requirement_statement_candidates(request.raw_text, page_spans=page_spans))
    statement_candidates_total = len(extracted_statements)
    chunks = _chunk_requirements_document(request.raw_text)
    source_pdf_url: str | None = None

    if source_pdf_upload and source_pdf_upload.get("bytes"):
        storage_path = _build_pdf_storage_path(
            organization_id=request.organization_id,
            document_kind="requirements",
            document_id=doc_id,
            filename=str(source_pdf_upload.get("filename") or request.source_name or "requirements.pdf"),
        )
        source_pdf_url = _upload_pdf_to_storage(path=storage_path, file_bytes=source_pdf_upload["bytes"])
        if source_pdf_url:
            document_metadata["source_pdf_url"] = source_pdf_url
            document_metadata["source_pdf_path"] = storage_path
            try:
                supabase.table("requirements_documents").update(
                    {
                        "metadata": document_metadata,
                        "source_pdf_url": source_pdf_url,
                        "source_pdf_path": storage_path,
                    }
                ).eq("id", doc_id).execute()
            except Exception as exc:
                logger.warning("Failed updating requirements document PDF metadata doc_id=%s err=%s", doc_id, exc)

    progress = _RequirementsDocProgress(
        supabase=supabase,
        document_id=doc_id,
        base_metadata=document_metadata,
        statement_candidates_total=statement_candidates_total,
        chunk_total=len(chunks),
    )
    progress.touch("indexing")

    def run_chunk_ingest() -> int:
        inserted_chunk_count = 0
        chunk_batch: List[Dict[str, Any]] = []
        for index, chunk in enumerate(chunks):
            chunk_text = chunk["chunk_text"]
            metadata = chunk["metadata"]
            embedding = _embed_text(chunk_text)
            chunk_batch.append(
                {
                    "organization_id": request.organization_id,
                    "requirements_document_id": doc_id,
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
            if len(chunk_batch) >= 10:
                try:
                    supabase.table("requirements_chunks").insert(chunk_batch).execute()
                except Exception as exc:
                    raise HTTPException(
                        status_code=502,
                        detail=(
                            "Failed writing requirement chunks to Supabase. "
                            "Verify backend Supabase credentials/project."
                        ),
                    ) from exc
                inserted_chunk_count += len(chunk_batch)
                progress.add_chunks(len(chunk_batch))
                chunk_batch = []

        if chunk_batch:
            try:
                supabase.table("requirements_chunks").insert(chunk_batch).execute()
            except Exception as exc:
                raise HTTPException(
                    status_code=502,
                    detail=(
                        "Failed writing requirement chunks to Supabase. "
                        "Verify backend Supabase credentials/project."
                    ),
                ) from exc
            inserted_chunk_count += len(chunk_batch)
            progress.add_chunks(len(chunk_batch))
        return inserted_chunk_count

    def run_statement_ingest() -> int:
        if not extracted_statements:
            return 0
        return _persist_requirement_statements(
            organization_id=request.organization_id,
            requirements_document_id=doc_id,
            statements=extracted_statements,
            supabase=supabase,
            on_progress=lambda n: progress.set_statement_count(n, "distilling"),
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        future_chunks = pool.submit(run_chunk_ingest)
        future_statements = pool.submit(run_statement_ingest)
        inserted_chunk_count = future_chunks.result()
        statement_count = future_statements.result()

    progress.finalize(chunk_count=inserted_chunk_count, statement_count=statement_count)

    return IngestRequirementsResponse(
        requirements_document_id=document["id"],
        chunk_count=inserted_chunk_count,
        statement_count=statement_count,
        page_count=page_count,
        ocr_pages=ocr_pages,
        extraction_warnings=extraction_warnings or [],
        source_pdf_url=source_pdf_url,
    )


def _persist_work_from_text(
    request: IngestWorkDocumentRequest,
    supabase: Any,
    page_count: int | None = None,
    ocr_pages: int | None = None,
    extraction_warnings: List[str] | None = None,
    source_document_name: str | None = None,
    source_document_path: str | None = None,
    work_document_metadata: Dict[str, Any] | None = None,
    source_pdf_upload: Dict[str, Any] | None = None,
    page_spans: List[Dict[str, int]] | None = None,
) -> IngestWorkDocumentResponse:
    if not request.raw_text.strip():
        raise HTTPException(status_code=400, detail="raw_text cannot be empty")

    try:
        document_metadata = dict(work_document_metadata or {})
        if page_count is not None:
            document_metadata["page_count"] = page_count
        if ocr_pages is not None:
            document_metadata["ocr_pages"] = ocr_pages
        if extraction_warnings:
            document_metadata["extraction_warnings"] = extraction_warnings
        doc_result = supabase.table("work_documents").insert(
            {
                "organization_id": request.organization_id,
                "uploaded_by": request.uploaded_by,
                "title": request.title,
                "raw_text": request.raw_text,
                "metadata": document_metadata,
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
    source_pdf_url: str | None = None
    if source_pdf_upload and source_pdf_upload.get("bytes"):
        storage_path = _build_pdf_storage_path(
            organization_id=request.organization_id,
            document_kind="work",
            document_id=document["id"],
            filename=str(source_pdf_upload.get("filename") or source_document_name or request.title),
        )
        source_pdf_url = _upload_pdf_to_storage(path=storage_path, file_bytes=source_pdf_upload["bytes"])
        if source_pdf_url:
            document_metadata["source_pdf_url"] = source_pdf_url
            document_metadata["source_pdf_path"] = storage_path
            try:
                supabase.table("work_documents").update(
                    {
                        "metadata": document_metadata,
                        "source_pdf_url": source_pdf_url,
                        "source_pdf_path": storage_path,
                    }
                ).eq("id", document["id"]).execute()
            except Exception as exc:
                logger.warning("Failed updating work document PDF metadata doc_id=%s err=%s", document["id"], exc)
    sections = _split_sections(request.raw_text)
    search_cursor = 0
    section_rows = []
    for idx, section in enumerate(sections):
        anchor, search_cursor = _build_text_anchor(request.raw_text, section["content"], search_cursor)
        source_page = None
        if anchor:
            source_page = _resolve_page_for_offset(anchor["start_offset"], page_spans)
        section_rows.append(
            {
                "organization_id": request.organization_id,
                "work_document_id": document["id"],
                "section_key": f"section-{idx + 1}",
                "section_title": section["section_title"],
                "content": section["content"],
                "section_order": idx + 1,
                "metadata": {
                    "source_document_name": source_document_name or request.title,
                    "source_document_path": source_document_path,
                    "source_document_url": source_pdf_url,
                    "source_page": source_page,
                    "text_anchor": anchor,
                },
            }
        )

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
                metadata=section.get("metadata") or {},
            )
            for section in inserted_sections
        ],
        page_count=page_count,
        ocr_pages=ocr_pages,
        extraction_warnings=extraction_warnings or [],
        source_pdf_url=source_pdf_url,
    )


async def _extract_work_upload_payload(file: UploadFile) -> Dict[str, Any]:
    filename = file.filename or "uploaded_file"
    suffix = filename.lower()
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"Uploaded file is empty: {filename}")

    if suffix.endswith(".pdf"):
        extracted = _extract_pdf_text_with_hybrid_ocr(file_bytes)
        _debug_log_pdf_extraction("work/ingest-batch", filename, extracted)
        if not extracted["text"]:
            raise HTTPException(
                status_code=400,
                detail=f"Could not extract usable text from PDF: {filename}",
            )
        return {
            "filename": filename,
            "text": extracted["text"],
            "source_type": "pdf",
            "page_count": extracted.get("page_count"),
            "ocr_pages": extracted.get("ocr_pages"),
            "warnings": extracted.get("warnings") or [],
            "page_spans": extracted.get("page_spans") or [],
            "bytes": file_bytes,
        }

    if suffix.endswith(".txt") or suffix.endswith(".md"):
        try:
            decoded = file_bytes.decode("utf-8")
        except UnicodeDecodeError:
            decoded = file_bytes.decode("latin-1")
        text = _normalize_whitespace(decoded)
        if not text:
            raise HTTPException(status_code=400, detail=f"No usable text found in file: {filename}")
        return {
            "filename": filename,
            "text": decoded,
            "source_type": "text",
            "page_count": None,
            "ocr_pages": None,
            "warnings": [],
            "page_spans": [],
        }

    raise HTTPException(
        status_code=400,
        detail=f"Unsupported file type for batch upload: {filename}. Only PDF/TXT/MD are supported.",
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
        page_spans=extracted.get("page_spans") or [],
        page_word_boxes=extracted.get("page_word_boxes") or [],
        source_pdf_upload={"filename": file.filename, "bytes": file_bytes},
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
        source_document_name=file.filename,
        source_pdf_upload={"filename": file.filename, "bytes": file_bytes},
        page_spans=extracted.get("page_spans") or [],
    )


@router.post("/work/ingest-batch", response_model=IngestWorkDocumentResponse)
async def ingest_work_batch(
    organization_id: str = Form(...),
    uploaded_by: str = Form(...),
    title: str = Form(...),
    batch_name: str | None = Form(None),
    files: List[UploadFile] = File(...),
    supabase=Depends(get_supabase_client),
):
    if not files:
        raise HTTPException(status_code=400, detail="At least one file is required.")

    extracted_files: List[Dict[str, Any]] = []
    total_pages = 0
    total_ocr_pages = 0
    warnings: List[str] = []
    for upload in files:
        payload = await _extract_work_upload_payload(upload)
        extracted_files.append(payload)
        total_pages += payload.get("page_count") or 0
        total_ocr_pages += payload.get("ocr_pages") or 0
        warnings.extend(payload.get("warnings") or [])

    combined_raw_text = "\n\n".join(
        f"[SOURCE DOCUMENT: {item['filename']}]\n{item['text']}" for item in extracted_files
    ).strip()
    if not combined_raw_text:
        raise HTTPException(status_code=400, detail="No usable text extracted from selected files.")

    metadata = {
        "batch_name": batch_name or title,
        "batch_file_count": len(extracted_files),
        "batch_files": [
            {
                "name": item["filename"],
                "source_type": item.get("source_type", "text"),
                "page_count": item.get("page_count"),
                "ocr_pages": item.get("ocr_pages"),
            }
            for item in extracted_files
        ],
    }

    request = IngestWorkDocumentRequest(
        organization_id=organization_id,
        uploaded_by=uploaded_by,
        title=title,
        raw_text=combined_raw_text,
    )
    result = _persist_work_from_text(
        request,
        supabase,
        page_count=total_pages or None,
        ocr_pages=total_ocr_pages or None,
        extraction_warnings=warnings,
        source_document_name=batch_name or "Batch upload",
        work_document_metadata=metadata,
    )

    source_document_urls: Dict[str, str] = {}
    for item in extracted_files:
        if item.get("source_type") != "pdf" or not item.get("bytes"):
            continue
        storage_path = _build_pdf_storage_path(
            organization_id=organization_id,
            document_kind="work",
            document_id=result.work_document_id,
            filename=item["filename"],
        )
        public_url = _upload_pdf_to_storage(path=storage_path, file_bytes=item["bytes"])
        if public_url:
            source_document_urls[item["filename"]] = public_url

    if source_document_urls:
        try:
            work_doc_result = (
                supabase.table("work_documents")
                .select("metadata")
                .eq("id", result.work_document_id)
                .limit(1)
                .execute()
            )
            existing_meta = ((work_doc_result.data or [None])[0] or {}).get("metadata") or {}
            existing_meta["source_pdf_files"] = source_document_urls
            supabase.table("work_documents").update({"metadata": existing_meta}).eq("id", result.work_document_id).execute()
        except Exception as exc:
            logger.warning("Failed updating batch work PDF metadata doc_id=%s err=%s", result.work_document_id, exc)

    section_rows = []
    order_counter = 1
    for item in extracted_files:
        sections = _split_sections(item["text"])
        source_cursor = 0
        for idx, section in enumerate(sections):
            anchor, source_cursor = _build_text_anchor(item["text"], section["content"], source_cursor)
            source_page = None
            if anchor:
                source_page = _resolve_page_for_offset(anchor["start_offset"], item.get("page_spans") or [])
            section_rows.append(
                {
                    "organization_id": organization_id,
                    "work_document_id": result.work_document_id,
                    "section_key": f"source-{order_counter}",
                    "section_title": section["section_title"],
                    "content": section["content"],
                    "section_order": order_counter,
                    "metadata": {
                        "source_document_name": item["filename"],
                        "source_document_path": item["filename"],
                        "source_document_index": idx + 1,
                        "source_document_url": source_document_urls.get(item["filename"]),
                        "source_page": source_page,
                        "text_anchor": anchor,
                    },
                }
            )
            order_counter += 1

    try:
        supabase.table("work_sections").delete().eq("work_document_id", result.work_document_id).execute()
        if section_rows:
            inserted = supabase.table("work_sections").insert(section_rows).execute()
            inserted_sections = inserted.data or []
        else:
            inserted_sections = []
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed writing batch work sections to Supabase.",
        ) from exc

    return IngestWorkDocumentResponse(
        work_document_id=result.work_document_id,
        sections=[
            WorkSectionModel(
                id=section["id"],
                section_key=section["section_key"],
                section_title=section["section_title"],
                content=section["content"],
                section_order=section["section_order"],
                metadata=section.get("metadata") or {},
            )
            for section in inserted_sections
        ],
        page_count=result.page_count,
        ocr_pages=result.ocr_pages,
        extraction_warnings=result.extraction_warnings,
    )


@router.post("/work/link", response_model=LinkRequirementsResponse)
async def link_work_sections(
    request: LinkRequirementsRequest,
    supabase=Depends(get_supabase_client),
):
    try:
        sections_result = (
            supabase.table("work_sections")
            .select("id, section_title, content, metadata")
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

    def _load_chunks(requirements_document_id: str | None = None):
        chunk_query = (
            supabase.table("requirements_chunks")
            .select("id, requirements_document_id, chunk_index, chunk_text, metadata, embedding")
            .eq("organization_id", request.organization_id)
        )
        if requirements_document_id:
            chunk_query = chunk_query.eq("requirements_document_id", requirements_document_id)
        return chunk_query.execute()

    try:
        chunks_result = _load_chunks(request.requirements_document_id)
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
        try:
            docs_result = (
                supabase.table("requirements_documents")
                .select("id, created_at")
                .eq("organization_id", request.organization_id)
                .order("created_at", desc=True)
                .limit(20)
                .execute()
            )
            for doc in docs_result.data or []:
                doc_id = doc.get("id")
                if not doc_id:
                    continue
                fallback = _load_chunks(doc_id)
                fallback_rows = fallback.data or []
                if fallback_rows:
                    chunks = fallback_rows
                    break
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=(
                    "Backend cannot resolve fallback requirement chunks from Supabase. "
                    "Check backend Supabase configuration."
                ),
            ) from exc
    if not chunks:
        raise HTTPException(status_code=404, detail="No requirement chunks found for organization")

    links_payload: List[Dict[str, Any]] = []
    response_sections: List[SectionLinkResult] = []

    for section in sections:
        section_embedding = _embed_text(section["content"])
        section_title = section["section_title"]
        section_topic = _strip_leading_numbering(section_title)
        section_query_text = f"{section_title}\n{section_topic}\n{section['content']}"
        semantic_enabled = bool(settings.openai_api_key)
        scored = []
        for chunk in chunks:
            chunk_embedding = _parse_vector(chunk.get("embedding"))
            similarity = _cosine_similarity(section_embedding, chunk_embedding)
            chunk_metadata = chunk.get("metadata") or {}
            chunk_title = str(chunk_metadata.get("section_title", ""))
            lexical_score = _keyword_overlap_score(section_query_text, f"{chunk_title}\n{chunk['chunk_text']}")
            numeric_score = _numeric_overlap_score(section_query_text, f"{chunk_title}\n{chunk['chunk_text']}")
            procedure_score = _procedure_overlap_score(section_query_text, f"{chunk_title}\n{chunk['chunk_text']}")
            section_ref_score = _section_reference_score(section_query_text, f"{chunk_title}\n{chunk['chunk_text']}")

            if semantic_enabled:
                hybrid_score = (
                    (0.45 * similarity)
                    + (0.20 * lexical_score)
                    + (0.20 * numeric_score)
                    + (0.10 * procedure_score)
                    + (0.05 * section_ref_score)
                )
            else:
                # If embeddings are deterministic fallback, rely on explicit textual and numeric alignment.
                hybrid_score = (
                    (0.05 * similarity)
                    + (0.45 * lexical_score)
                    + (0.30 * numeric_score)
                    + (0.12 * procedure_score)
                    + (0.08 * section_ref_score)
                )

            if _is_generic_intro_title(chunk_title):
                hybrid_score -= 0.18
            if _extract_numeric_tokens(section_query_text) and not _extract_numeric_tokens(chunk["chunk_text"]):
                hybrid_score -= 0.08

            scored.append(
                {
                    "requirements_chunk_id": chunk["id"],
                    "chunk_text": _excerpt_text(chunk["chunk_text"]),
                    "chunk_index": chunk["chunk_index"],
                    "requirements_document_id": chunk["requirements_document_id"],
                    "metadata": chunk_metadata,
                    "similarity": similarity,
                    "hybrid_score": hybrid_score,
                    "numeric_score": numeric_score,
                    "section_ref_score": section_ref_score,
                }
            )

        scored.sort(key=lambda item: item["hybrid_score"], reverse=True)

        if semantic_enabled:
            filtered = [
                item for item in scored
                if item["similarity"] >= request.min_similarity
                or item["hybrid_score"] >= (request.min_similarity * 0.88)
            ]
        else:
            filtered = [
                item for item in scored if item["hybrid_score"] >= max(0.14, request.min_similarity * 0.3)
            ]

        non_intro = [item for item in filtered if not _is_generic_intro_title(str(item.get("metadata", {}).get("section_title", "")))]
        if non_intro:
            filtered = non_intro

        if not filtered:
            if semantic_enabled:
                filtered = [
                    item for item in scored if item["similarity"] >= 0.35
                ][: max(2, request.max_links_per_section // 2)]
            else:
                filtered = scored[: max(2, request.max_links_per_section // 2)]

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
                work_section_metadata=section.get("metadata") or {},
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


@router.get("/requirements/status", response_model=RequirementsStatusResponse)
async def requirements_status(
    organization_id: str,
    supabase=Depends(get_supabase_client),
):
    try:
        latest_doc_result = (
            supabase.table("requirements_documents")
            .select("id, title, source_type, source_name, raw_text, metadata, source_pdf_url, created_at")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to load requirements status from Supabase.",
        ) from exc

    latest_doc = (latest_doc_result.data or [None])[0]
    if not latest_doc:
        return RequirementsStatusResponse(organization_id=organization_id, indexed=False)

    try:
        count_result = (
            supabase.table("requirements_chunks")
            .select("id", count="exact")
            .eq("organization_id", organization_id)
            .eq("requirements_document_id", latest_doc["id"])
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to load requirements chunk counts from Supabase.",
        ) from exc

    metadata = latest_doc.get("metadata") or {}
    chunk_count = count_result.count or 0
    try:
        statement_count_result = (
            supabase.table("requirements_statements")
            .select("id", count="exact")
            .eq("organization_id", organization_id)
            .eq("requirements_document_id", latest_doc["id"])
            .execute()
        )
        statement_count = statement_count_result.count or 0
    except Exception:
        statement_count = 0
    processing_status = metadata.get("processing_status")
    if processing_status == "indexed":
        indexed = True
    elif processing_status in {"indexing", "distilling"}:
        indexed = False
    else:
        indexed = chunk_count > 0
    return RequirementsStatusResponse(
        organization_id=organization_id,
        indexed=indexed,
        processing_status=processing_status,
        latest_requirements_document_id=latest_doc["id"],
        latest_title=latest_doc.get("title"),
        latest_source_type=latest_doc.get("source_type"),
        latest_source_name=latest_doc.get("source_name"),
        latest_raw_text=latest_doc.get("raw_text"),
        chunk_count=chunk_count,
        statement_count=statement_count,
        indexed_at=latest_doc.get("created_at"),
        page_count=metadata.get("page_count"),
        ocr_pages=metadata.get("ocr_pages"),
        source_pdf_url=latest_doc.get("source_pdf_url") or metadata.get("source_pdf_url"),
    )


@router.get(
    "/requirements/{requirements_document_id}/statements",
    response_model=RequirementStatementsResponse,
)
async def requirements_statements(
    requirements_document_id: str,
    organization_id: str,
    supabase=Depends(get_supabase_client),
):
    document_raw_text = ""
    document_page_spans: List[Dict[str, int]] = []
    try:
        doc_result = (
            supabase.table("requirements_documents")
            .select("raw_text, metadata")
            .eq("organization_id", organization_id)
            .eq("id", requirements_document_id)
            .limit(1)
            .execute()
        )
        doc_row = (doc_result.data or [None])[0] or {}
        document_raw_text = str(doc_row.get("raw_text") or "")
        doc_metadata = doc_row.get("metadata") or {}
        spans = doc_metadata.get("page_spans") if isinstance(doc_metadata, dict) else None
        if isinstance(spans, list):
            document_page_spans = [
                {
                    "page_number": int(span.get("page_number")),
                    "start_offset": int(span.get("start_offset")),
                    "end_offset": int(span.get("end_offset")),
                }
                for span in spans
                if isinstance(span, dict)
                and span.get("page_number") is not None
                and span.get("start_offset") is not None
                and span.get("end_offset") is not None
            ]
    except Exception:
        document_raw_text = ""
        document_page_spans = []

    try:
        rows_result = (
            supabase.table("requirements_statements")
            .select(
                "id, statement_order, section_title, modal_verb, statement_text, note_text, source_page, text_anchor, metadata"
            )
            .eq("organization_id", organization_id)
            .eq("requirements_document_id", requirements_document_id)
            .order("statement_order", desc=False)
            .execute()
        )
    except Exception:
        # Backward-compatible fallback while migration rollout catches up.
        try:
            rows_result = (
                supabase.table("requirements_statements")
                .select(
                    "id, statement_order, section_title, modal_verb, statement_text, note_text, source_page, metadata"
                )
                .eq("organization_id", organization_id)
                .eq("requirements_document_id", requirements_document_id)
                .order("statement_order", desc=False)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Failed to load requirements statements.") from exc

    rows = rows_result.data or []
    grouped: Dict[str, List[RequirementStatementItem]] = {verb: [] for verb in MODAL_VERBS}

    for row in rows:
        verb = (row.get("modal_verb") or "").lower()
        if verb not in grouped:
            continue
        metadata = row.get("metadata") or {}
        row_anchor = row.get("text_anchor") or metadata.get("text_anchor")
        fallback_anchor = None
        if not row_anchor and document_raw_text:
            # Anchor from original extracted requirement text, not distilled summary.
            source_requirement_text = str(row.get("statement_text") or "")
            fallback_anchor, _ = _build_text_anchor(document_raw_text, source_requirement_text, 0)
        resolved_anchor = row_anchor if isinstance(row_anchor, dict) else fallback_anchor
        resolved_source_page = row.get("source_page")
        if resolved_source_page is None and resolved_anchor:
            resolved_source_page = _resolve_page_for_offset(int(resolved_anchor.get("start_offset")), document_page_spans)
        grouped[verb].append(
            RequirementStatementItem(
                id=row["id"],
                statement_order=row["statement_order"],
                section_title=row["section_title"],
                modal_verb=verb,
                category_label=MODAL_LABELS[verb],
                requirement_summary=metadata.get("requirement_summary")
                or _build_requirement_summary(
                    _normalize_whitespace(
                        str(metadata.get("distilled_text") or row["statement_text"])
                    )
                ),
                section_reference=metadata.get("section_reference")
                or _extract_section_reference_from_title(row["section_title"]),
                statement_text=row["statement_text"],
                distilled_text=metadata.get("distilled_text"),
                source_quote=row["statement_text"],
                note_text=row.get("note_text"),
                source_page=resolved_source_page,
                text_anchor=(
                    TextAnchor(
                        start_offset=int((resolved_anchor or {}).get("start_offset")),
                        end_offset=int((resolved_anchor or {}).get("end_offset")),
                        snippet=str((resolved_anchor or {}).get("snippet") or ""),
                    )
                    if isinstance(resolved_anchor, dict)
                    and (resolved_anchor or {}).get("start_offset") is not None
                    and (resolved_anchor or {}).get("end_offset") is not None
                    else None
                ),
            )
        )

    groups = [
        RequirementStatementGroup(
            modal_verb=verb,
            category_label=MODAL_LABELS[verb],
            count=len(grouped[verb]),
            items=grouped[verb],
        )
        for verb in MODAL_VERBS
    ]

    return RequirementStatementsResponse(
        organization_id=organization_id,
        requirements_document_id=requirements_document_id,
        total_count=len(rows),
        groups=groups,
    )


@router.get(
    "/requirements/{requirements_document_id}/summary",
    response_model=RequirementStatementsSummaryResponse,
)
async def requirements_statements_summary(
    requirements_document_id: str,
    organization_id: str,
    supabase=Depends(get_supabase_client),
):
    try:
        rows_result = (
            supabase.table("requirements_statements")
            .select("modal_verb")
            .eq("organization_id", organization_id)
            .eq("requirements_document_id", requirements_document_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load requirements statements summary.") from exc

    rows = rows_result.data or []
    counts = {verb: 0 for verb in MODAL_VERBS}
    for row in rows:
        verb = str(row.get("modal_verb", "")).lower()
        if verb in counts:
            counts[verb] += 1

    return RequirementStatementsSummaryResponse(
        organization_id=organization_id,
        requirements_document_id=requirements_document_id,
        total_count=len(rows),
        by_modal_verb=counts,
    )


@router.get(
    "/requirements/{requirements_document_id}/statement-sow-links",
    response_model=StatementSowLinksResponse,
)
async def requirements_statement_sow_links(
    requirements_document_id: str,
    organization_id: str,
    work_document_id: str,
    overlap_threshold: float = Query(default=0.75, ge=0.0, le=1.0),
    max_citations_per_statement: int = Query(default=3, ge=1, le=50),
    supabase=Depends(get_supabase_client),
):
    """Resolve saved section→chunk links into requirement-statement→SOW citations."""
    try:
        work_doc_result = (
            supabase.table("work_documents")
            .select("id, title, metadata")
            .eq("organization_id", organization_id)
            .eq("id", work_document_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load work document.") from exc

    work_doc = (work_doc_result.data or [None])[0]
    if not work_doc:
        raise HTTPException(status_code=404, detail="Work document not found.")

    work_document_title = work_doc.get("title")

    try:
        sections_result = (
            supabase.table("work_sections")
            .select("id, section_title, content, metadata")
            .eq("organization_id", organization_id)
            .eq("work_document_id", work_document_id)
            .order("section_order", desc=False)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load work sections.") from exc

    sections = sections_result.data or []
    section_by_id = {row["id"]: row for row in sections}
    section_ids = list(section_by_id.keys())

    links_rows: List[Dict[str, Any]] = []
    if section_ids:
        try:
            links_result = (
                supabase.table("section_requirement_links")
                .select("work_section_id, requirements_chunk_id, similarity")
                .eq("organization_id", organization_id)
                .in_("work_section_id", section_ids)
                .execute()
            )
            links_rows = links_result.data or []
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Failed to load section requirement links.") from exc

    chunk_ids_in_links = {row["requirements_chunk_id"] for row in links_rows}

    try:
        chunks_result = (
            supabase.table("requirements_chunks")
            .select("id, chunk_text, chunk_index, metadata")
            .eq("organization_id", organization_id)
            .eq("requirements_document_id", requirements_document_id)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load requirements chunks.") from exc

    chunks = chunks_result.data or []

    try:
        statements_result = (
            supabase.table("requirements_statements")
            .select("id, statement_text, metadata")
            .eq("organization_id", organization_id)
            .eq("requirements_document_id", requirements_document_id)
            .order("statement_order", desc=False)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load requirements statements.") from exc

    statement_rows = statements_result.data or []

    links_by_chunk: Dict[str, List[Dict[str, Any]]] = {}
    for link in links_rows:
        cid = link["requirements_chunk_id"]
        links_by_chunk.setdefault(cid, []).append(link)

    entries: List[StatementSowLinksEntry] = []
    for stmt in statement_rows:
        sid = stmt["id"]
        meta = stmt.get("metadata") or {}
        stmt_text = str(meta.get("distilled_text") or stmt.get("statement_text") or "")

        matched_chunk_ids: List[str] = []
        for chunk in chunks:
            if chunk["id"] not in chunk_ids_in_links:
                continue
            score = _statement_chunk_overlap_score(stmt_text, chunk.get("chunk_text") or "")
            if score >= overlap_threshold:
                matched_chunk_ids.append(chunk["id"])

        citation_map: Dict[str, StatementSowCitation] = {}
        for cid in matched_chunk_ids:
            for link in links_by_chunk.get(cid, []):
                ws_id = link["work_section_id"]
                section = section_by_id.get(ws_id)
                if not section:
                    continue
                ws_meta = section.get("metadata") or {}
                source_name = ws_meta.get("source_document_name")
                source_document_url = ws_meta.get("source_document_url")
                sim = float(link.get("similarity") or 0.0)
                quote = _excerpt_text(section.get("content") or "", max_chars=560)
                anchor_meta = ws_meta.get("text_anchor") if isinstance(ws_meta, dict) else None
                citation = StatementSowCitation(
                    work_section_id=ws_id,
                    section_title=section.get("section_title") or "Section",
                    work_document_title=work_document_title,
                    source_document_name=source_name,
                    source_document_url=source_document_url,
                    quote=quote,
                    similarity=sim,
                    source_page=ws_meta.get("source_page"),
                    text_anchor=(
                        TextAnchor(
                            start_offset=int(anchor_meta.get("start_offset")),
                            end_offset=int(anchor_meta.get("end_offset")),
                            snippet=str(anchor_meta.get("snippet") or ""),
                        )
                        if isinstance(anchor_meta, dict)
                        and anchor_meta.get("start_offset") is not None
                        and anchor_meta.get("end_offset") is not None
                        else None
                    ),
                )
                existing = citation_map.get(ws_id)
                if not existing or existing.similarity < citation.similarity:
                    citation_map[ws_id] = citation

        citations = sorted(citation_map.values(), key=lambda c: c.similarity, reverse=True)[
            :max_citations_per_statement
        ]
        entries.append(
            StatementSowLinksEntry(requirement_statement_id=sid, citations=citations)
        )

    return StatementSowLinksResponse(
        organization_id=organization_id,
        requirements_document_id=requirements_document_id,
        work_document_id=work_document_id,
        statements=entries,
    )


@router.get("/work/history", response_model=WorkHistoryResponse)
async def work_history(
    organization_id: str,
    supabase=Depends(get_supabase_client),
):
    try:
        work_docs_result = (
            supabase.table("work_documents")
            .select("id, title, created_at, metadata")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load work history from Supabase.") from exc

    work_docs = work_docs_result.data or []
    if not work_docs:
        return WorkHistoryResponse(organization_id=organization_id, items=[])

    items: List[WorkHistoryItem] = []
    for doc in work_docs:
        doc_id = doc["id"]
        try:
            sections_result = (
                supabase.table("work_sections")
                .select("id")
                .eq("organization_id", organization_id)
                .eq("work_document_id", doc_id)
                .execute()
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Failed to load work section history.") from exc

        sections = sections_result.data or []
        section_ids = [section["id"] for section in sections]
        link_count = 0

        for section_id in section_ids:
            try:
                links_result = (
                    supabase.table("section_requirement_links")
                    .select("id", count="exact")
                    .eq("organization_id", organization_id)
                    .eq("work_section_id", section_id)
                    .execute()
                )
            except Exception as exc:
                raise HTTPException(status_code=502, detail="Failed to load section link history.") from exc
            link_count += links_result.count or 0

        items.append(
            WorkHistoryItem(
                work_document_id=doc_id,
                title=doc["title"],
                created_at=doc["created_at"],
                section_count=len(section_ids),
                link_count=link_count,
                metadata=doc.get("metadata") or {},
            )
        )
    return WorkHistoryResponse(organization_id=organization_id, items=items)


@router.get("/work/last-linked", response_model=WorkLastLinkedResponse)
async def work_last_linked(
    organization_id: str,
    supabase=Depends(get_supabase_client),
):
    """Return the work document whose section links were most recently written."""
    try:
        links_result = (
            supabase.table("section_requirement_links")
            .select("work_section_id, created_at")
            .eq("organization_id", organization_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to load latest section links from Supabase.",
        ) from exc

    rows = links_result.data or []
    if not rows:
        return WorkLastLinkedResponse(organization_id=organization_id, work_document_id=None)

    work_section_id = rows[0]["work_section_id"]
    try:
        section_result = (
            supabase.table("work_sections")
            .select("work_document_id")
            .eq("organization_id", organization_id)
            .eq("id", work_section_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail="Failed to resolve work document for latest section link.",
        ) from exc

    section_row = (section_result.data or [None])[0]
    if not section_row:
        return WorkLastLinkedResponse(organization_id=organization_id, work_document_id=None)

    return WorkLastLinkedResponse(
        organization_id=organization_id,
        work_document_id=str(section_row["work_document_id"]),
    )


@router.get("/work/history/{work_document_id}", response_model=WorkHistoryDetailResponse)
async def work_history_detail(
    work_document_id: str,
    organization_id: str,
    supabase=Depends(get_supabase_client),
):
    try:
        work_doc_result = (
            supabase.table("work_documents")
            .select("id, title, created_at")
            .eq("organization_id", organization_id)
            .eq("id", work_document_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load work document details.") from exc

    work_doc = (work_doc_result.data or [None])[0]
    if not work_doc:
        raise HTTPException(status_code=404, detail="Work document not found.")

    try:
        sections_result = (
            supabase.table("work_sections")
            .select("id, section_title, section_order, content, metadata")
            .eq("organization_id", organization_id)
            .eq("work_document_id", work_document_id)
            .order("section_order", desc=False)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Failed to load work section details.") from exc

    sections = sections_result.data or []
    links: List[Dict[str, Any]] = []
    for section in sections:
        try:
            section_links_result = (
                supabase.table("section_requirement_links")
                .select("work_section_id, requirements_chunk_id, similarity, rationale")
                .eq("organization_id", organization_id)
                .eq("work_section_id", section["id"])
                .execute()
            )
            links.extend(section_links_result.data or [])
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Failed to load section links.") from exc

    chunks_by_id: Dict[str, Dict[str, Any]] = {}
    for chunk_id in {link["requirements_chunk_id"] for link in links}:
        try:
            chunk_result = (
                supabase.table("requirements_chunks")
                .select("id, requirements_document_id, chunk_index, chunk_text, metadata")
                .eq("organization_id", organization_id)
                .eq("id", chunk_id)
                .limit(1)
                .execute()
            )
            chunk = (chunk_result.data or [None])[0]
            if chunk:
                chunks_by_id[chunk["id"]] = chunk
        except Exception as exc:
            raise HTTPException(status_code=502, detail="Failed to load linked requirement chunks.") from exc

    links_by_section: Dict[str, List[WorkHistoryLinkItem]] = {}
    for link in links:
        chunk = chunks_by_id.get(link["requirements_chunk_id"])
        if not chunk:
            continue
        section_id = link["work_section_id"]
        if section_id not in links_by_section:
            links_by_section[section_id] = []
        links_by_section[section_id].append(
            WorkHistoryLinkItem(
                requirements_chunk_id=chunk["id"],
                chunk_index=chunk["chunk_index"],
                chunk_text=_excerpt_text(chunk["chunk_text"]),
                requirements_document_id=chunk["requirements_document_id"],
                metadata=chunk.get("metadata") or {},
                similarity=link["similarity"],
                rationale=link.get("rationale"),
            )
        )

    section_items = []
    for section in sections:
        section_links = links_by_section.get(section["id"], [])
        section_links.sort(key=lambda item: item.similarity, reverse=True)
        section_items.append(
            WorkHistorySectionItem(
                work_section_id=section["id"],
                section_title=section["section_title"],
                section_order=section["section_order"],
                content=section["content"],
                metadata=section.get("metadata") or {},
                links=section_links,
            )
        )

    return WorkHistoryDetailResponse(
        organization_id=organization_id,
        work_document_id=work_doc["id"],
        title=work_doc["title"],
        created_at=work_doc["created_at"],
        sections=section_items,
    )
