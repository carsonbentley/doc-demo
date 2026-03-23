"""Defense demo workbench endpoints for requirements linking."""

from __future__ import annotations

import hashlib
import math
import re
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException
from openai import OpenAI
from pydantic import BaseModel, Field

from ..config import settings
from ..supabase_client import get_supabase_client

router = APIRouter()

EMBEDDING_DIMENSION = 1536
CHUNK_SIZE = 1200
CHUNK_OVERLAP = 200


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
    max_links_per_section: int = Field(default=5, ge=1, le=20)
    min_similarity: float = Field(default=0.65, ge=0.0, le=1.0)


class SectionLinkResult(BaseModel):
    work_section_id: str
    section_title: str
    links: List[Dict[str, Any]]


class LinkRequirementsResponse(BaseModel):
    linked_sections: List[SectionLinkResult]


def _chunk_text(text: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    normalized = re.sub(r"\s+", " ", text).strip()
    if not normalized:
        return []

    chunks: List[str] = []
    start = 0
    while start < len(normalized):
        end = min(start + chunk_size, len(normalized))
        chunk = normalized[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = max(end - overlap, 0)
    return chunks


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

    if not doc_result.data:
        raise HTTPException(status_code=500, detail="Failed to create requirements document")

    document = doc_result.data[0]
    chunks = _chunk_text(request.raw_text)

    rows: List[Dict[str, Any]] = []
    for index, chunk_text in enumerate(chunks):
        embedding = _embed_text(chunk_text)
        rows.append(
            {
                "organization_id": request.organization_id,
                "requirements_document_id": document["id"],
                "chunk_index": index,
                "chunk_text": chunk_text,
                "embedding": _to_vector_literal(embedding),
                "metadata": {"source_name": request.source_name, "title": request.title},
            }
        )

    if rows:
        supabase.table("requirements_chunks").insert(rows).execute()

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

    doc_result = supabase.table("work_documents").insert(
        {
            "organization_id": request.organization_id,
            "uploaded_by": request.uploaded_by,
            "title": request.title,
            "raw_text": request.raw_text,
        }
    ).execute()

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

    inserted = supabase.table("work_sections").insert(section_rows).execute() if section_rows else None
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
    sections_result = (
        supabase.table("work_sections")
        .select("id, section_title, content")
        .eq("organization_id", request.organization_id)
        .eq("work_document_id", request.work_document_id)
        .execute()
    )
    sections = sections_result.data or []
    if not sections:
        raise HTTPException(status_code=404, detail="No sections found for work_document_id")

    chunks_result = (
        supabase.table("requirements_chunks")
        .select("id, requirements_document_id, chunk_index, chunk_text, metadata, embedding")
        .eq("organization_id", request.organization_id)
        .execute()
    )
    chunks = chunks_result.data or []
    if not chunks:
        raise HTTPException(status_code=404, detail="No requirement chunks found for organization")

    links_payload: List[Dict[str, Any]] = []
    response_sections: List[SectionLinkResult] = []

    for section in sections:
        section_embedding = _embed_text(section["content"])
        scored = []
        for chunk in chunks:
            chunk_embedding = _parse_vector(chunk.get("embedding"))
            similarity = _cosine_similarity(section_embedding, chunk_embedding)
            if similarity >= request.min_similarity:
                scored.append(
                    {
                        "requirements_chunk_id": chunk["id"],
                        "chunk_text": chunk["chunk_text"],
                        "chunk_index": chunk["chunk_index"],
                        "requirements_document_id": chunk["requirements_document_id"],
                        "similarity": similarity,
                    }
                )
        scored.sort(key=lambda item: item["similarity"], reverse=True)
        top_matches = scored[: request.max_links_per_section]

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
        # Best effort clear existing links for these sections, then insert refreshed links.
        for section in sections:
            supabase.table("section_requirement_links").delete().eq("work_section_id", section["id"]).execute()
        supabase.table("section_requirement_links").insert(links_payload).execute()

    return LinkRequirementsResponse(linked_sections=response_sections)
