import { Client } from '@microsoft/microsoft-graph-client';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { prisma } from '../index';

interface GraphEmail {
  id: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  isRead?: boolean;
  importance?: string;
  hasAttachments?: boolean;
}

interface MailFolder {
  id: string;
  displayName: string;
  totalItemCount: number;
  unreadItemCount: number;
}

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.AZURE_CLIENT_ID || '',
    authority: 'https://login.microsoftonline.com/common',
    clientSecret: process.env.AZURE_CLIENT_SECRET || '',
  },
});

/**
 * Refresh the access token using the refresh token stored in DB.
 * Updates the account record with new tokens.
 */
export async function refreshAccessToken(accountId: string): Promise<string> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account || !account.refreshToken) {
    throw new Error('No refresh token available for account');
  }

  try {
    const result = await msalClient.acquireTokenByRefreshToken({
      refreshToken: account.refreshToken,
      scopes: ['user.read', 'mail.read', 'mail.readwrite', 'offline_access'],
    });

    if (!result) {
      throw new Error('Token refresh returned null');
    }

    const newRefreshToken = (result as any).refreshToken || account.refreshToken;

    await prisma.emailAccount.update({
      where: { id: accountId },
      data: {
        accessToken: result.accessToken,
        refreshToken: newRefreshToken,
        tokenExpiry: result.expiresOn || null,
      },
    });

    return result.accessToken;
  } catch (error) {
    console.error(`Failed to refresh token for account ${accountId}:`, error);
    throw new Error('Token refresh failed. User may need to re-authenticate.');
  }
}

/**
 * Get a valid access token for the account, refreshing if expired.
 */
export async function getValidToken(accountId: string): Promise<string> {
  const account = await prisma.emailAccount.findUnique({ where: { id: accountId } });
  if (!account) {
    throw new Error('Account not found');
  }

  // Check if token is expired (with 5-minute buffer)
  if (account.tokenExpiry && new Date(account.tokenExpiry) < new Date(Date.now() + 5 * 60 * 1000)) {
    return refreshAccessToken(accountId);
  }

  return account.accessToken;
}

/**
 * Create an authenticated Microsoft Graph client.
 */
function createGraphClient(accessToken: string): Client {
  return Client.init({
    authProvider: (done) => {
      done(null, accessToken);
    },
  });
}

/**
 * Fetch emails from Microsoft Graph inbox (or specific folder).
 */
export async function fetchEmails(
  accessToken: string,
  folderId?: string,
  top: number = 50,
  skip: number = 0,
): Promise<GraphEmail[]> {
  try {
    const client = createGraphClient(accessToken);
    const folder = folderId || 'inbox';

    const response = await client
      .api(`/me/mailFolders/${folder}/messages`)
      .top(top)
      .skip(skip)
      .select('id,from,toRecipients,subject,bodyPreview,receivedDateTime,isRead,importance,hasAttachments')
      .orderby('receivedDateTime desc')
      .get();

    return response.value || [];
  } catch (error: any) {
    console.error('Error fetching emails from Graph:', error?.message || error);
    throw new Error('Failed to fetch emails from Microsoft Graph');
  }
}

/**
 * Move an email to the Deleted Items folder (trash).
 */
export async function deleteEmail(accessToken: string, emailId: string): Promise<void> {
  try {
    const client = createGraphClient(accessToken);

    // Move to deletedItems folder
    await client
      .api(`/me/messages/${emailId}/move`)
      .post({ destinationId: 'deleteditems' });
  } catch (error: any) {
    console.error('Error deleting email via Graph:', error?.message || error);
    throw new Error('Failed to delete email via Microsoft Graph');
  }
}

/**
 * List mail folders for the account.
 */
export async function getMailFolders(accessToken: string): Promise<MailFolder[]> {
  try {
    const client = createGraphClient(accessToken);

    const response = await client
      .api('/me/mailFolders')
      .select('id,displayName,totalItemCount,unreadItemCount')
      .get();

    return response.value || [];
  } catch (error: any) {
    console.error('Error fetching mail folders from Graph:', error?.message || error);
    throw new Error('Failed to fetch mail folders from Microsoft Graph');
  }
}
