import axios from 'axios';
import type {
  EmailAccount,
  Email,
  FoldersByAccount,
  Rule,
  Suggestion,
  EmailCategory,
  EmailFilters,
  PaginatedResponse,
  TriageAction,
  TriageResult,
  TriageExecuteResult,
  RulePreviewResult,
} from './types';

const api = axios.create({
  baseURL: '/',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Accounts
export async function getAccounts(): Promise<EmailAccount[]> {
  const { data } = await api.get<EmailAccount[]>('/auth/accounts');
  return data;
}

// Emails
export async function getEmails(
  params?: EmailFilters,
): Promise<PaginatedResponse<Email>> {
  const { data } = await api.get<PaginatedResponse<Email>>('/api/emails', {
    params,
  });
  return data;
}

export async function getFoldersByAccount(): Promise<FoldersByAccount> {
  const { data } = await api.get<FoldersByAccount>('/api/emails/folders');
  return data;
}

export async function syncEmails(): Promise<{ synced: number }> {
  const { data } = await api.post<{ synced: number }>('/api/emails/sync');
  return data;
}

export async function updateCategory(
  id: string,
  category: EmailCategory,
): Promise<Email> {
  const { data } = await api.patch<Email>(`/api/emails/${id}/category`, {
    category,
  });
  return data;
}

export async function bulkUpdateCategory(
  ids: string[],
  category: EmailCategory,
): Promise<{ updated: number }> {
  const { data } = await api.patch<{ updated: number }>(
    '/api/emails/bulk/category',
    { ids, category },
  );
  return data;
}

export async function deleteEmail(id: string): Promise<void> {
  await api.delete(`/api/emails/${id}`);
}

export async function bulkDeleteEmails(
  ids: string[],
): Promise<{ deleted: number }> {
  const { data } = await api.post<{ deleted: number }>(
    '/api/emails/bulk/delete',
    { ids },
  );
  return data;
}

// Rules
export async function getRules(): Promise<Rule[]> {
  const { data } = await api.get<Rule[]>('/api/rules');
  return data;
}

export async function createRule(
  rule: Omit<Rule, 'id' | 'appliedCount' | 'createdAt' | 'updatedAt'>,
): Promise<Rule> {
  const { data } = await api.post<Rule>('/api/rules', rule);
  return data;
}

export async function deleteRule(id: string): Promise<void> {
  await api.delete(`/api/rules/${id}`);
}

// Suggestions
export async function getSuggestions(
  emailIds?: string[],
): Promise<Suggestion[]> {
  const { data } = await api.post<{ suggestions: Suggestion[] }>('/api/rules/suggest', {
    emailIds,
  });
  return data.suggestions || [];
}

// Triage
export async function triageJunkEmails(accountId?: string, forceReclassify?: boolean): Promise<TriageResult> {
  const { data } = await api.post<TriageResult>('/api/emails/triage', { accountId, forceReclassify });
  return data;
}

export async function executeTriageActions(
  actions: Array<{ emailId: string; action: TriageAction }>,
): Promise<TriageExecuteResult> {
  const { data } = await api.post<TriageExecuteResult>('/api/emails/triage/execute', { actions });
  return data;
}

export async function recordTriageOverride(
  emailId: string,
  aiDecision: TriageAction,
  userDecision: TriageAction,
): Promise<void> {
  await api.post('/api/emails/triage/override', { emailId, aiDecision, userDecision });
}

// Check if sender has a rule
export async function checkSenderRule(senderAddress: string): Promise<{ hasRule: boolean }> {
  const { data } = await api.post<{ hasRule: boolean; rules: Rule[] }>('/api/rules/check-sender', { senderAddress });
  return data;
}

// Preview rule application
export async function previewRuleApplication(): Promise<RulePreviewResult> {
  const { data } = await api.post<RulePreviewResult>('/api/rules/preview-apply');
  return data;
}

// Apply rules
export async function applyRules(): Promise<{ applied: number }> {
  const { data } = await api.post<{ applied: number }>('/api/rules/apply');
  return data;
}
