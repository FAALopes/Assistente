import { Email, Rule, EmailCategory, RuleField, RuleOperator, RuleAction } from '@prisma/client';
import { prisma } from '../index';

export interface EmailSuggestion {
  emailId: string;
  suggestedCategory: EmailCategory;
  matchedRuleId: string;
  confidence: number;
  reason: string;
}

/**
 * Check if a single rule matches an email.
 */
function ruleMatchesEmail(rule: Rule, email: Email): boolean {
  let fieldValue = '';

  switch (rule.field) {
    case 'FROM':
      fieldValue = email.from?.toLowerCase() || '';
      break;
    case 'SUBJECT':
      fieldValue = email.subject?.toLowerCase() || '';
      break;
    case 'BODY':
      fieldValue = email.bodyPreview?.toLowerCase() || '';
      break;
  }

  const ruleValue = rule.value.toLowerCase();

  switch (rule.operator) {
    case 'CONTAINS':
      return fieldValue.includes(ruleValue);
    case 'EQUALS':
      return fieldValue === ruleValue;
    case 'STARTS_WITH':
      return fieldValue.startsWith(ruleValue);
    default:
      return false;
  }
}

/**
 * Map a RuleAction to an EmailCategory.
 */
function actionToCategory(action: RuleAction): EmailCategory {
  switch (action) {
    case 'DELETE':
      return 'DELETE';
    case 'TODO':
      return 'TODO';
    case 'SAVE_LATER':
      return 'SAVE_LATER';
    case 'SAVE_ONEDRIVE':
      return 'SAVE_ONEDRIVE';
    default:
      return 'UNCATEGORIZED';
  }
}

/**
 * Apply all rules to a list of emails and return suggestions.
 */
export function applySuggestions(emails: Email[], rules: Rule[]): EmailSuggestion[] {
  const suggestions: EmailSuggestion[] = [];

  for (const email of emails) {
    // Skip already categorized emails
    if (email.category !== 'UNCATEGORIZED') continue;

    // Find the first matching rule (highest confidence first)
    const sortedRules = [...rules].sort((a, b) => b.confidence - a.confidence);

    for (const rule of sortedRules) {
      if (ruleMatchesEmail(rule, email)) {
        const category = actionToCategory(rule.action);

        let reason = '';
        switch (rule.field) {
          case 'FROM':
            reason = `Remetente ${rule.operator.toLowerCase()} "${rule.value}"`;
            break;
          case 'SUBJECT':
            reason = `Assunto ${rule.operator.toLowerCase()} "${rule.value}"`;
            break;
          case 'BODY':
            reason = `Corpo ${rule.operator.toLowerCase()} "${rule.value}"`;
            break;
        }

        suggestions.push({
          emailId: email.id,
          suggestedCategory: category,
          matchedRuleId: rule.id,
          confidence: rule.confidence,
          reason,
        });

        break; // Only one suggestion per email
      }
    }
  }

  return suggestions;
}

/**
 * Learn from user actions and create/update rules.
 * If the user performs the same action on 3+ emails from the same sender,
 * automatically create a rule.
 */
export async function learnFromAction(
  email: Email,
  action: RuleAction,
): Promise<Rule | null> {
  const senderAddress = email.from?.toLowerCase() || '';
  if (!senderAddress) return null;

  // Count how many emails from the same sender have been categorized with this action
  const category = actionToCategory(action);
  const sameActionCount = await prisma.email.count({
    where: {
      from: { contains: senderAddress, mode: 'insensitive' },
      category,
    },
  });

  // Threshold: create rule after 3+ emails from same sender get same action
  if (sameActionCount >= 3) {
    // Check if rule already exists
    const existingRule = await prisma.rule.findFirst({
      where: {
        field: 'FROM',
        operator: 'CONTAINS',
        value: senderAddress,
        action,
      },
    });

    if (existingRule) {
      // Update confidence and times applied
      const updated = await prisma.rule.update({
        where: { id: existingRule.id },
        data: {
          timesApplied: { increment: 1 },
          confidence: Math.min(existingRule.confidence + 1, 100),
        },
      });
      return updated;
    }

    // Create new rule
    const newRule = await prisma.rule.create({
      data: {
        field: 'FROM',
        operator: 'CONTAINS',
        value: senderAddress,
        action,
        confidence: 75, // Start with 75% confidence for auto-learned rules
        timesApplied: sameActionCount,
      },
    });

    console.log(`Auto-created rule: ${action} emails from "${senderAddress}" (${sameActionCount} matches)`);
    return newRule;
  }

  return null;
}
