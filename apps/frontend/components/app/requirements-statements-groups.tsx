'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type RequirementStatement = {
  id: string;
  statement_order: number;
  section_title: string;
  modal_verb: string;
  category_label: string;
  statement_text: string;
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
  should: 'bg-amber-100 text-amber-700',
  may: 'bg-blue-100 text-blue-700',
  can: 'bg-emerald-100 text-emerald-700',
};

export function RequirementsStatementsGroups({ groups }: RequirementsStatementsGroupsProps) {
  const truncate = (text: string, max = 140) => (text.length <= max ? text : `${text.slice(0, max - 3)}...`);

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.modal_verb}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{group.category_label}</span>
              <span
                className={`rounded-full px-2 py-1 text-xs font-medium ${VERB_BADGE_STYLES[group.modal_verb] || 'bg-gray-100 text-gray-700'}`}
              >
                {group.modal_verb.toUpperCase()} · {group.count}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.items.length === 0 ? (
              <p className="text-sm text-gray-500">No statements found in this category.</p>
            ) : (
              group.items.map((statement) => (
                <details key={statement.id} className="rounded-md border p-3">
                  <summary className="cursor-pointer list-none">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className="rounded bg-gray-100 px-2 py-1">#{statement.statement_order}</span>
                      <span className="rounded bg-gray-100 px-2 py-1">{statement.section_title}</span>
                      {statement.source_page ? (
                        <span className="rounded bg-gray-100 px-2 py-1">Page {statement.source_page}</span>
                      ) : null}
                    </div>
                    <p className="text-sm font-medium text-gray-900">{truncate(statement.statement_text)}</p>
                  </summary>
                  <div className="mt-3 border-t pt-3">
                    <p className="text-sm text-gray-800">{statement.statement_text}</p>
                    {statement.note_text ? (
                      <div className="mt-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800">
                        <span className="font-semibold">NOTE:</span> {statement.note_text}
                      </div>
                    ) : null}
                  </div>
                </details>
              ))
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
