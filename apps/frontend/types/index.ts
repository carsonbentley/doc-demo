export interface User {
  id: string;
  email: string;
  created_at: string;
  updated_at: string;
  team_id: string;
}

export interface Team {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  owner_id: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  team_id: string;
  created_at: string;
  updated_at: string;
  source_funder?: string;
  target_funder?: string;
  status: 'draft' | 'processing' | 'completed' | 'error';
}

export interface Document {
  id: string;
  organization_id: string;
  name: string;
  type: 'source' | 'converted' | 'exported';
  file_path: string;
  content?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}



export interface FunderOutline {
  funder: string;
  version: string;
  sections: OutlineSection[];
}

export interface OutlineSection {
  id: string;
  title: string;
  description?: string;
  required: boolean;
  max_length?: number;
  subsections?: OutlineSection[];
}

export interface RepurposeRequest {
  projectId: string;
  sourceContent: string;
  targetOutline: FunderOutline;
  customInstructions?: string;
}

export interface RepurposeResponse {
  success: boolean;
  content?: string;
  error?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChecksRequest {
  projectId: string;
  content: string;
  ruleSetId: string;
}

export interface Check {
  id: string;
  rule_id: string;
  status: string;
  message: string;
  details?: any;
  created_at: string;
}

export interface ChecksResponse {
  success: boolean;
  checks: Check[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
  };
}

export interface ExportRequest {
  projectId: string;
  content: string;
  format: 'docx' | 'pdf';
  template?: string;
}

export interface ExportResponse {
  success: boolean;
  downloadUrl?: string;
  error?: string;
}
