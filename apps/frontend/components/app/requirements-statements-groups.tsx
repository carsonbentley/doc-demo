'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

type RequirementStatement = {
  id: string;
  statement_order: number;
  section_title: string;
  modal_verb: string;
  category_label: string;
  requirement_summary?: string | null;
  section_reference?: string | null;
  statement_text: string;
  distilled_text?: string | null;
  source_quote?: string | null;
  note_text?: string | null;
  source_page?: number | null;
};

type RequirementStatementGroup = {
  modal_verb: string;
  category_label: string;
  count: number;
  items: RequirementStatement[];
};

type RequirementsStatementsGroupsProps = {
  groups: RequirementStatementGroup[];
};

const VERB_BADGE_STYLES: Record<string, string> = {
  shall: 'bg-red-100 text-red-700',
  requires: 'bg-red-100 text-red-700',
  should: 'bg-amber-100 text-amber-700',
  may: 'bg-blue-100 text-blue-700',
  can: 'bg-emerald-100 text-emerald-700',
};

export function RequirementsStatementsGroups({ groups }: RequirementsStatementsGroupsProps) {
  const cleanSectionTitle = (title: string) =>
    title.replace(/^section\s+\d+(?:\.\d+)*\s*[:\-]?\s*/i, '').trim() || title;

  const [search, setSearch] = useState('');
  const [activeVerb, setActiveVerb] = useState<string>('shall');
  const [visibleCount, setVisibleCount] = useState(20);

  useEffect(() => {
    const preferred = groups.find((group) => ['shall', 'requires'].includes(group.modal_verb) && group.count > 0);
    const fallback = groups.find((group) => group.count > 0);
    const next =
      preferred?.modal_verb || fallback?.modal_verb || groups[0]?.modal_verb || 'shall';

    setActiveVerb((prev) => {
      const prevStillValid = groups.some((g) => g.modal_verb === prev && g.count > 0);
      if (prevStillValid) return prev;
      return next;
    });
  }, [groups]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.modal_verb === activeVerb) || groups[0],
    [groups, activeVerb]
  );

  const filteredItems = useMemo(() => {
    if (!activeGroup) return [];
    const query = search.trim().toLowerCase();
    if (!query) return activeGroup.items;
    return activeGroup.items.filter((statement) => {
      const haystack = [
        statement.requirement_summary,
        statement.distilled_text,
        statement.statement_text,
        statement.source_quote,
        statement.section_title,
        statement.section_reference,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [activeGroup, search]);

  const visibleItems = filteredItems.slice(0, visibleCount);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="space-y-3">
          <CardTitle className="text-base">Extracted Requirements</CardTitle>
          <div className="flex flex-wrap gap-2">
            {groups.map((group) => (
              <button
                key={group.modal_verb}
                type="button"
                onClick={() => {
                  setActiveVerb(group.modal_verb);
                  setVisibleCount(20);
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeVerb === group.modal_verb
                    ? VERB_BADGE_STYLES[group.modal_verb] || 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {group.modal_verb.toUpperCase()} · {group.count}
              </button>
            ))}
          </div>
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(20);
            }}
            placeholder="Search requirement summary, source quote, or section..."
          />
        </CardHeader>
        <CardContent className="space-y-3">
          {activeGroup ? (
            <p className="text-sm text-gray-600">
              Showing <span className="font-medium">{activeGroup.category_label}</span> requirements (
              {filteredItems.length} result{filteredItems.length === 1 ? '' : 's'})
            </p>
          ) : null}

          {filteredItems.length === 0 ? (
            <p className="text-sm text-gray-500">No statements found for this filter.</p>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((statement) => (
                <details key={statement.id} className="rounded-md border p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="rounded bg-gray-100 px-2 py-1">#{statement.statement_order}</span>
                      {statement.section_reference ? (
                        <span className="rounded bg-indigo-100 px-2 py-1 text-indigo-700">
                          {statement.section_reference}
                        </span>
                      ) : null}
                      {statement.source_page ? (
                        <span className="rounded bg-gray-100 px-2 py-1">Page {statement.source_page}</span>
                      ) : null}
                    </div>
                    <p className="mb-1 line-clamp-1 text-xs text-gray-600">
                      {cleanSectionTitle(statement.section_title)}
                    </p>
                    <p className="line-clamp-2 text-sm font-medium text-gray-900">
                      {statement.requirement_summary || statement.distilled_text || statement.statement_text}
                    </p>
                  </summary>
                  <div className="mt-3 border-t pt-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-gray-500">Expanded Requirement</p>
                    <p className="text-sm text-gray-800">
                      {statement.distilled_text || statement.statement_text}
                    </p>
                    <p className="mb-2 mt-3 text-xs uppercase tracking-wide text-gray-500">Source Quote</p>
                    <p className="text-sm text-gray-700">{statement.source_quote || statement.statement_text}</p>
                    {statement.note_text ? (
                      <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                        <span className="font-semibold">NOTE:</span> {statement.note_text}
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          )}

          {visibleCount < filteredItems.length ? (
            <div className="pt-2">
              <Button type="button" variant="outline" onClick={() => setVisibleCount((count) => count + 20)}>
                Load 20 More
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
