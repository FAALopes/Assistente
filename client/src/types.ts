export enum EmailCategory {
  INBOX = 'INBOX',
  TODO = 'TODO',
  DELETE = 'DELETE',
  SAVE_LATER = 'SAVE_LATER',
  SAVE_ONEDRIVE = 'SAVE_ONEDRIVE',
  UNCATEGORIZED = 'UNCATEGORIZED',
}

export interface EmailAccount {
  id: string;
  email: string;
  provider: 'MICROSOFT' | 'GMAIL' | 'IMAP';
  displayName: string | null;
  createdAt: string;
  _count?: { emails: number };
}

export interface Email {
  id: string;
  accountId: string;
  externalId: string;
  from: string;
  to: string | null;
  subject: string | null;
  bodyPreview: string | null;
  folder: string;
  receivedAt: string;
  isRead: boolean;
  importance: string | null;
  hasAttachments: boolean;
  category: EmailCategory;
  categorySetAt: string | null;
  createdAt: string;
  account?: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

export interface EmailFolder {
  id: string;
  label: string;
  count: number;
}

export interface Rule {
  id: string;
  field: 'FROM' | 'SUBJECT' | 'BODY';
  operator: 'CONTAINS' | 'EQUALS' | 'STARTS_WITH';
  value: string;
  action: 'DELETE' | 'TODO' | 'SAVE_LATER' | 'SAVE_ONEDRIVE';
  confidence: number;
  timesApplied: number;
  createdAt: string;
}

export interface Suggestion {
  emailId: string;
  suggestedCategory: EmailCategory;
  reason: string;
  confidence: number;
}

export interface EmailFilters {
  account?: string;
  folder?: string;
  category?: EmailCategory;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}
