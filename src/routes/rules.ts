import { Router, Request, Response } from 'express';
import { RuleField, RuleOperator, RuleAction, EmailCategory } from '@prisma/client';
import { prisma } from '../index';
import { applySuggestions } from '../services/ruleEngine';

const router = Router();

// GET /api/rules - List all rules
router.get('/', async (_req: Request, res: Response) => {
  try {
    const rules = await prisma.rule.findMany({
      orderBy: [
        { confidence: 'desc' },
        { timesApplied: 'desc' },
      ],
    });

    res.json(rules);
  } catch (error) {
    console.error('Error fetching rules:', error);
    res.status(500).json({ error: 'Failed to fetch rules' });
  }
});

// POST /api/rules - Create a rule
router.post('/', async (req: Request, res: Response) => {
  try {
    const { field, operator, value, action, confidence } = req.body;

    // Validate field
    if (!field || !Object.values(RuleField).includes(field)) {
      res.status(400).json({
        error: 'Invalid field',
        validFields: Object.values(RuleField),
      });
      return;
    }

    // Validate operator
    if (!operator || !Object.values(RuleOperator).includes(operator)) {
      res.status(400).json({
        error: 'Invalid operator',
        validOperators: Object.values(RuleOperator),
      });
      return;
    }

    // Validate value
    if (!value || typeof value !== 'string' || value.trim().length === 0) {
      res.status(400).json({ error: 'Value is required' });
      return;
    }

    // Validate action
    if (!action || !Object.values(RuleAction).includes(action)) {
      res.status(400).json({
        error: 'Invalid action',
        validActions: Object.values(RuleAction),
      });
      return;
    }

    // Check for duplicate rule
    const existing = await prisma.rule.findFirst({
      where: { field, operator, value: value.trim(), action },
    });

    if (existing) {
      res.status(409).json({
        error: 'A rule with these exact parameters already exists',
        existingRule: existing,
      });
      return;
    }

    const rule = await prisma.rule.create({
      data: {
        field,
        operator,
        value: value.trim(),
        action,
        confidence: confidence ? Math.min(100, Math.max(1, confidence)) : 100,
      },
    });

    res.status(201).json(rule);
  } catch (error) {
    console.error('Error creating rule:', error);
    res.status(500).json({ error: 'Failed to create rule' });
  }
});

// DELETE /api/rules/:id - Delete a rule
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const rule = await prisma.rule.findUnique({ where: { id } });
    if (!rule) {
      res.status(404).json({ error: 'Rule not found' });
      return;
    }

    await prisma.rule.delete({ where: { id } });

    res.json({ message: 'Rule deleted successfully' });
  } catch (error) {
    console.error('Error deleting rule:', error);
    res.status(500).json({ error: 'Failed to delete rule' });
  }
});

// POST /api/rules/check-sender - Check if sender has an existing rule
router.post('/check-sender', async (req: Request, res: Response) => {
  try {
    const { senderAddress } = req.body;

    if (!senderAddress || typeof senderAddress !== 'string') {
      res.status(400).json({ error: 'senderAddress is required' });
      return;
    }

    const email = senderAddress.toLowerCase().trim();

    // Find rules where field=FROM and value matches the sender address
    const fromRules = await prisma.rule.findMany({
      where: { field: 'FROM' },
    });

    // Check if any FROM rule matches: email contains rule value OR rule value contains email
    const matchingRules = fromRules.filter((rule) => {
      const ruleVal = rule.value.toLowerCase();
      return email.includes(ruleVal) || ruleVal.includes(email);
    });

    res.json({ hasRule: matchingRules.length > 0, rules: matchingRules });
  } catch (error) {
    console.error('Error checking sender rule:', error);
    res.status(500).json({ error: 'Failed to check sender rule' });
  }
});

// POST /api/rules/preview-apply - Preview rule application without applying
router.post('/preview-apply', async (_req: Request, res: Response) => {
  try {
    const rules = await prisma.rule.findMany({
      orderBy: { confidence: 'desc' },
    });

    if (rules.length === 0) {
      res.json({ matches: [], totalMatched: 0 });
      return;
    }

    const emails = await prisma.email.findMany({
      where: { category: 'UNCATEGORIZED' },
      orderBy: { receivedAt: 'desc' },
      take: 500,
    });

    const suggestions = applySuggestions(emails, rules);

    // Group by rule
    const ruleMap = new Map<string, { rule: typeof rules[0]; emails: Array<{ id: string; from: string; subject: string; receivedAt: string }>; action: string }>();

    for (const suggestion of suggestions) {
      const rule = rules.find((r) => r.id === suggestion.matchedRuleId);
      if (!rule) continue;

      const email = emails.find((e) => e.id === suggestion.emailId);
      if (!email) continue;

      if (!ruleMap.has(rule.id)) {
        ruleMap.set(rule.id, {
          rule,
          emails: [],
          action: rule.action,
        });
      }

      ruleMap.get(rule.id)!.emails.push({
        id: email.id,
        from: email.from,
        subject: email.subject || '(sem assunto)',
        receivedAt: email.receivedAt.toISOString(),
      });
    }

    const matches = Array.from(ruleMap.values()).map((m) => ({
      ...m,
      count: m.emails.length,
    }));

    res.json({
      matches,
      totalMatched: suggestions.length,
    });
  } catch (error) {
    console.error('Error previewing rule application:', error);
    res.status(500).json({ error: 'Failed to preview rule application' });
  }
});

// POST /api/rules/apply - Apply rules to uncategorized emails
router.post('/apply', async (_req: Request, res: Response) => {
  try {
    const rules = await prisma.rule.findMany({
      orderBy: { confidence: 'desc' },
    });

    if (rules.length === 0) {
      res.json({ applied: 0 });
      return;
    }

    const emails = await prisma.email.findMany({
      where: { category: 'UNCATEGORIZED' },
      orderBy: { receivedAt: 'desc' },
      take: 500,
    });

    const suggestions = applySuggestions(emails, rules);

    // Map RuleAction to EmailCategory
    const actionToCategory: Record<string, EmailCategory> = {
      DELETE: 'DELETE',
      TODO: 'TODO',
      SAVE_LATER: 'SAVE_LATER',
      SAVE_ONEDRIVE: 'SAVE_ONEDRIVE',
    };

    let applied = 0;

    // Track rule application counts
    const ruleCounts = new Map<string, number>();

    for (const suggestion of suggestions) {
      const category = actionToCategory[suggestion.suggestedCategory] || suggestion.suggestedCategory as EmailCategory;

      await prisma.email.update({
        where: { id: suggestion.emailId },
        data: {
          category,
          categorySetAt: new Date(),
        },
      });

      const count = ruleCounts.get(suggestion.matchedRuleId) || 0;
      ruleCounts.set(suggestion.matchedRuleId, count + 1);
      applied++;
    }

    // Increment timesApplied for each rule
    for (const [ruleId, count] of ruleCounts) {
      await prisma.rule.update({
        where: { id: ruleId },
        data: { timesApplied: { increment: count } },
      });
    }

    res.json({ applied });
  } catch (error) {
    console.error('Error applying rules:', error);
    res.status(500).json({ error: 'Failed to apply rules' });
  }
});

// POST /api/rules/suggest - Suggest categories for emails based on rules
router.post('/suggest', async (req: Request, res: Response) => {
  try {
    const { emailIds } = req.body;

    // Fetch emails
    let emails;
    if (emailIds && Array.isArray(emailIds) && emailIds.length > 0) {
      emails = await prisma.email.findMany({
        where: { id: { in: emailIds } },
      });
    } else {
      // Default: get uncategorized emails
      emails = await prisma.email.findMany({
        where: { category: 'UNCATEGORIZED' },
        take: 100,
        orderBy: { receivedAt: 'desc' },
      });
    }

    // Fetch all rules
    const rules = await prisma.rule.findMany();

    if (rules.length === 0) {
      res.json({
        suggestions: [],
        message: 'Sem regras definidas. Crie regras para receber sugestoes.',
      });
      return;
    }

    const suggestions = applySuggestions(emails, rules);

    res.json({
      suggestions,
      totalEmails: emails.length,
      totalMatched: suggestions.length,
    });
  } catch (error) {
    console.error('Error generating suggestions:', error);
    res.status(500).json({ error: 'Failed to generate suggestions' });
  }
});

export default router;
