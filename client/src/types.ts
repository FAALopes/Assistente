export enum EmailCategory {
  INBOX = 'INBOX',
  TODO = 'TODO',
  DELETE = 'DELETE',
  ARCHIVE = 'ARCHIVE',
  ONEDRIVE = 'ONEDRIVE',
}

export interface EmailAccount {
  id: string;
  email: string;
  provider: 'microsoft' | 'gmail';
  displayName: string;
  connected: boolean;
  lastSyncAt: string | null;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Email {
  id: string;
  accountId: string;
  externalId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  body: string;
  receivedAt: string;
  isRead: boolean;
  category: EmailCategory;
  suggestedCategory: EmailCategory | null;
  suggestionReason: string | null;
  account?: EmailAccount;
  createdAt: string;
  updatedAt: string;
}

export interface Rule {
  id: string;
  name: string;
  description: string;
  condition: string;
  action: EmailCategory;
  isActive: boolean;
  appliedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Suggestion {
  emailId: string;
  suggestedCategory: EmailCategory;
  reason: string;
  confidence: number;
}

export interface EmailFilters {
  accountId?: string;
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
