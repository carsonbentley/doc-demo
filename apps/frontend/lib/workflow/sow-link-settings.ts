export type SowLinkSettings = {
  /** Minimum statement↔chunk overlap score (0–1) to include a citation. */
  overlapThreshold: number;
  /** Cap on SOW citations returned per requirement. */
  maxCitationsPerStatement: number;
};

const STORAGE_PREFIX = 'gc.sowLinkSettings.';

export const DEFAULT_SOW_LINK_SETTINGS: SowLinkSettings = {
  overlapThreshold: 0.7,
  maxCitationsPerStatement: 3,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function loadSowLinkSettings(organizationId: string): SowLinkSettings {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_SOW_LINK_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + organizationId);
    if (!raw) return { ...DEFAULT_SOW_LINK_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SowLinkSettings>;
    return {
      overlapThreshold: clamp(
        typeof parsed.overlapThreshold === 'number' ? parsed.overlapThreshold : DEFAULT_SOW_LINK_SETTINGS.overlapThreshold,
        0.05,
        0.95
      ),
      maxCitationsPerStatement: Math.round(
        clamp(
          typeof parsed.maxCitationsPerStatement === 'number'
            ? parsed.maxCitationsPerStatement
            : DEFAULT_SOW_LINK_SETTINGS.maxCitationsPerStatement,
          1,
          50
        )
      ),
    };
  } catch {
    return { ...DEFAULT_SOW_LINK_SETTINGS };
  }
}

export function saveSowLinkSettings(organizationId: string, settings: SowLinkSettings): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_PREFIX + organizationId, JSON.stringify(settings));
}
