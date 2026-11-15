import crypto from 'crypto';

const ALG = 'aes-256-gcm';

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET || process.env.AZURE_CLIENT_SECRET || 'dev-fallback-change-me';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALG, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(blob: string): string {
  const parts = blob.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Invalid encrypted blob');
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const enc = Buffer.from(parts[3], 'base64');
  const decipher = crypto.createDecipheriv(ALG, getKey(), iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}
