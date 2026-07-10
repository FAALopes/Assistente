import Anthropic from '@anthropic-ai/sdk';
import { prisma } from '../index';

export type TriageActionType = 'DELETE' | 'MOVE_TO_INBOX' | 'REVIEW';

export interface TriageClassification {
  emailId: string;
  action: TriageActionType;
  reason: string;
  confidence: number;
}

interface EmailForTriage {
  id: string;
  from: string;
  subject: string | null;
  bodyPreview: string | null;
  receivedAt: Date;
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const BATCH_SIZE = 20;

const SYSTEM_PROMPT = `Tu és um assistente de triagem de email. Classifica emails da pasta de lixo/spam em exatamente uma de três categorias:

- DELETE: Spam óbvio, marketing não solicitado, phishing, scams, cold outreach de desconhecidos, notificações automáticas sem valor
- MOVE_TO_INBOX: Emails legítimos classificados incorretamente como lixo — conversas reais, notificações importantes, confirmações de encomenda, alertas de segurança de conta, emails de colegas/clientes/parceiros
- REVIEW: Casos incertos — newsletters que o utilizador pode querer, emails promocionais de serviços conhecidos, casos ambíguos

Responde APENAS com um array JSON válido. Para cada email, fornece:
{"id": "<email_id>", "action": "DELETE|MOVE_TO_INBOX|REVIEW", "reason": "<razão breve em português>", "confidence": <0-100>}

Sê conservador: em caso de dúvida, classifica como REVIEW em vez de DELETE. É melhor rever um email a mais do que apagar algo importante.`;

/**
 * Classify junk emails using AI + learned overrides
 */
// Extract display name from "Name <email>" or plain email
function extractDisplayName(sender: string): string | null {
  if (!sender) return null;
  const match = sender.match(/^(.+?)\s*<[^>]+>\s*$/);
  const raw = match ? match[1] : sender;
  const cleaned = raw.replace(/^"|"$/g, '').trim().toLowerCase();
  // If cleaned looks like an email (has @), no useful display name
  if (!cleaned || cleaned.includes('@')) return null;
  return cleaned;
}

// Minimum aggregate DELETE overrides to trigger auto-DELETE by display name
const NAME_AGGREGATE_THRESHOLD = 3;

export async function classifyJunkEmails(emails: EmailForTriage[]): Promise<TriageClassification[]> {
  if (emails.length === 0) return [];

  // Step 1a: Exact sender-address overrides (confirmed twice)
  const senderAddresses = [...new Set(emails.map(e => e.from))];
  const exactOverrides = await prisma.triageOverride.findMany({
    where: {
      senderAddress: { in: senderAddresses },
      occurrences: { gte: 2 },
    },
  });
  const exactMap = new Map<string, TriageActionType>();
  for (const o of exactOverrides) {
    exactMap.set(o.senderAddress, o.userDecision as TriageActionType);
  }

  // Step 1b: Aggregate DELETE overrides by display name (catches rotating-domain spam)
  //   e.g., "Orangetheory Fitness" appears in 21 overrides across different domains → auto-DELETE
  const allDeleteOverrides = await prisma.triageOverride.findMany({
    where: { userDecision: 'DELETE' as any },
    select: { senderAddress: true, occurrences: true },
  });
  const deleteCountByName = new Map<string, number>();
  for (const o of allDeleteOverrides) {
    const name = extractDisplayName(o.senderAddress);
    if (!name) continue;
    deleteCountByName.set(name, (deleteCountByName.get(name) || 0) + o.occurrences);
  }

  // Step 2: Separate emails with known preferences from those needing AI
  const results: TriageClassification[] = [];
  const needsAI: EmailForTriage[] = [];

  for (const email of emails) {
    // Priority 1: exact sender match (confirmed twice)
    const exact = exactMap.get(email.from);
    if (exact) {
      results.push({
        emailId: email.id,
        action: exact,
        reason: 'Baseado na sua preferência anterior (remetente exato)',
        confidence: 95,
      });
      continue;
    }
    // Priority 2: aggregate display-name match (≥N DELETE overrides for this name)
    const name = extractDisplayName(email.from);
    const nameCount = name ? deleteCountByName.get(name) || 0 : 0;
    if (name && nameCount >= NAME_AGGREGATE_THRESHOLD) {
      results.push({
        emailId: email.id,
        action: 'DELETE',
        reason: `Padrão de spam detectado: já apagou ${nameCount} emails de "${name}"`,
        confidence: 95,
      });
      continue;
    }
    needsAI.push(email);
  }

  // Step 3: Batch AI classification
  if (needsAI.length > 0 && process.env.ANTHROPIC_API_KEY) {
    const batches: EmailForTriage[][] = [];
    for (let i = 0; i < needsAI.length; i += BATCH_SIZE) {
      batches.push(needsAI.slice(i, i + BATCH_SIZE));
    }

    for (const batch of batches) {
      try {
        const batchResults = await classifyBatchWithAI(batch);
        results.push(...batchResults);
      } catch (error: any) {
        console.error('AI classification failed for batch:', error?.message || error);
        console.error('Full error:', JSON.stringify(error, null, 2));
        // Fallback: mark all as REVIEW
        for (const email of batch) {
          results.push({
            emailId: email.id,
            action: 'REVIEW',
            reason: 'Erro na classificação AI — requer revisão manual',
            confidence: 0,
          });
        }
      }
    }
  } else if (needsAI.length > 0) {
    // No API key: all go to REVIEW
    for (const email of needsAI) {
      results.push({
        emailId: email.id,
        action: 'REVIEW',
        reason: 'API key não configurada — requer revisão manual',
        confidence: 0,
      });
    }
  }

  return results;
}

/**
 * Send a batch of emails to Claude Haiku for classification
 */
async function classifyBatchWithAI(emails: EmailForTriage[]): Promise<TriageClassification[]> {
  const emailData = emails.map(e => ({
    id: e.id,
    from: e.from,
    subject: e.subject || '(sem assunto)',
    bodyPreview: e.bodyPreview ? e.bodyPreview.substring(0, 200) : '',
    date: e.receivedAt.toISOString().split('T')[0],
  }));

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Classifica estes ${emails.length} emails da pasta de lixo:\n\n${JSON.stringify(emailData, null, 2)}`,
      },
    ],
  });

  // Extract text from response
  const textBlock = response.content.find(b => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from AI');
  }

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = textBlock.text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  const parsed = JSON.parse(jsonStr) as Array<{
    id: string;
    action: string;
    reason: string;
    confidence: number;
  }>;

  return parsed.map(item => ({
    emailId: item.id,
    action: (item.action === 'DELETE' || item.action === 'MOVE_TO_INBOX' || item.action === 'REVIEW')
      ? item.action
      : 'REVIEW',
    reason: item.reason || 'Sem razão fornecida',
    confidence: Math.min(100, Math.max(0, item.confidence || 50)),
  }));
}

/**
 * Record a user override for learning
 */
export async function recordOverride(
  senderAddress: string,
  aiDecision: TriageActionType,
  userDecision: TriageActionType,
): Promise<void> {
  // Extract domain: handles "Name <user@domain.com>" and plain "user@domain.com"
  const emailMatch = senderAddress.match(/<([^>]+)>/);
  const emailPart = emailMatch ? emailMatch[1] : senderAddress;
  const senderDomain = emailPart.includes('@')
    ? emailPart.split('@')[1].replace(/>$/, '').trim().toLowerCase()
    : emailPart.replace(/>$/, '').trim().toLowerCase();

  await prisma.triageOverride.upsert({
    where: {
      senderAddress_userDecision: {
        senderAddress,
        userDecision,
      },
    },
    create: {
      senderAddress,
      senderDomain,
      aiDecision: aiDecision as any,
      userDecision: userDecision as any,
      occurrences: 1,
    },
    update: {
      occurrences: { increment: 1 },
      aiDecision: aiDecision as any,
    },
  });
}
