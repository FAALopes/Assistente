import axios from 'axios';
import type {
  EmailAccount,
  Email,
  EmailFolder,
  Rule,
  Suggestion,
  EmailCategory,
  EmailFilters,
  PaginatedResponse,
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

export async function getFolders(): Promise<EmailFolder[]> {
  const { data } = await api.get<EmailFolder[]>('/api/emails/folders');
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
