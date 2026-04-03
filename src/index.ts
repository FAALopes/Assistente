import 'dotenv/config';
import 'isomorphic-fetch';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import authRoutes from './routes/auth';
import emailRoutes from './routes/emails';
import ruleRoutes from './routes/rules';

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Railway's reverse proxy (needed for secure cookies over HTTPS)
app.set('trust proxy', 1);

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/api/emails', emailRoutes);
app.use('/api/rules', ruleRoutes);

// Serve frontend static files in production
const clientPath = path.join(__dirname, '..', 'dist', 'client');
app.use(express.static(clientPath));

// Catch-all: serve index.html for client-side routing
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path.startsWith('/auth') || _req.path === '/health') {
    return next();
  }
  res.sendFile(path.join(clientPath, 'index.html'));
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

app.listen(PORT, () => {
  console.log(`Assistente backend running on port ${PORT}`);
});
