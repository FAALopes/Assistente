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
export async function classifyJunkEmails(emails: EmailForTriage[]): Promise<TriageClassification[]> {
  if (emails.length === 0) return [];

  // Step 1: Check for learned overrides
  const senderAddresses = [...new Set(emails.map(e => e.from))];
  const overrides = await prisma.triageOverride.findMany({
    where: {
      senderAddress: { in: senderAddresses },
      occurrences: { gte: 2 }, // Only apply if confirmed at least twice
    },
  });

  const overrideMap = new Map<string, { action: TriageActionType; }>();
  for (const override of overrides) {
    // Use the most recent user decision for this sender
    overrideMap.set(override.senderAddress, {
      action: override.userDecision as TriageActionType,
    });
  }

  // Step 2: Separate emails with known overrides from those needing AI
  const results: TriageClassification[] = [];
  const needsAI: EmailForTriage[] = [];

  for (const email of emails) {
    const override = overrideMap.get(email.from);
    if (override) {
      results.push({
        emailId: email.id,
        action: override.action,
        reason: 'Baseado na sua preferência anterior',
        confidence: 95,
      });
    } else {
      needsAI.push(email);
    }
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
      } catch (error) {
        console.error('AI classification failed for batch:', error);
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
    model: 'claude-3-5-haiku-20241022',
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
  const senderDomain = senderAddress.includes('@')
    ? senderAddress.split('@')[1]
    : senderAddress;

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
