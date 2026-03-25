"""Defense demo workbench endpoints for requirements linking."""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any, Dict, List, Set

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel, Field

from ..config import settings
from ..supabase_client import get_supabase_client

router = APIRouter()

EMBEDDING_DIMENSION = 1536
CHUNK_SIZE = 900
CHUNK_OVERLAP = 120


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


def _split_requirement_sections(raw_text: str) -> List[Dict[str, str]]:
    lines = [line.rstrip() for line in raw_text.splitlines()]
    sections: List[Dict[str, str]] = []

    heading_regexes = [
        re.compile(r"^(Section\s+\d+[A-Za-z]?)\s*[–\-:]\s*(.+)$", re.IGNORECASE),
        re.compile(r"^(\d+(?:\.\d+)+)\s+(.+)$"),
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
    lines = [line.strip() for line in raw_text.splitlines()]
    sections: List[Dict[str, Any]] = []
    current_title = "Introduction"
    current_lines: List[str] = []

    heading_pattern = re.compile(r"^(\d+(\.\d+)*)\s+.+")

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
        if heading_pattern.match(line) or (line.isupper() and len(line) <= 90):
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


@router.post("/requirements/ingest", response_model=IngestRequirementsResponse)
async def ingest_requirements(
    request: IngestRequirementsRequest,
    supabase=Depends(get_supabase_client),
):
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
    )


@router.post("/work/ingest", response_model=IngestWorkDocumentResponse)
async def ingest_work_document(
    request: IngestWorkDocumentRequest,
    supabase=Depends(get_supabase_client),
):
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
