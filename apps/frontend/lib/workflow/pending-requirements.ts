type PendingRequirementsPayload = {
  organizationId: string;
  uploadedBy: string;
  title: string;
  mode: 'text' | 'pdf';
  rawText?: string;
  file?: File | null;
};

let pendingPayload: PendingRequirementsPayload | null = null;
const STORAGE_KEY = 'pendingRequirementsPayload';

export function setPendingRequirementsPayload(payload: PendingRequirementsPayload) {
  pendingPayload = payload;
  if (typeof window !== 'undefined') {
    const { file: _file, ...serializable } = payload;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
  }
}

export function getPendingRequirementsPayload(organizationId: string) {
  if (pendingPayload && pendingPayload.organizationId === organizationId) {
    return pendingPayload;
  }
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Omit<PendingRequirementsPayload, 'file'>;
    if (parsed.organizationId !== organizationId) return null;
    return { ...parsed, file: null };
  } catch {
    return null;
  }
}

export function clearPendingRequirementsPayload() {
  pendingPayload = null;
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
}
