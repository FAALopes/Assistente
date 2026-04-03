import { Router, Request, Response } from 'express';
import { RuleField, RuleOperator, RuleAction } from '@prisma/client';
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
