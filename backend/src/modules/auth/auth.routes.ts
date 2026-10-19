import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { verifyPassword } from '../../lib/password';
import { createSession, destroySession } from '../../lib/session';
import { writeAuditLog } from '../../lib/audit';
import { AppError } from '../../lib/errors';
import { requireAuth } from '../../middleware/auth';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    // Same generic error whether the username doesn't exist or the password
    // is wrong, so a login attempt can't be used to enumerate usernames.
    const invalidCredentials = () => AppError.unauthorized('Invalid username or password');

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive) throw invalidCredentials();

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) throw invalidCredentials();

    const { token, expiresAt } = await createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

    await writeAuditLog(prisma, {
      businessId: user.businessId,
      userId: user.id,
      action: 'LOGIN',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
    });

    res.json({
      token,
      expiresAt,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        businessId: user.businessId,
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, async (req, res, next) => {
  try {
    const token = req.headers.authorization!.slice('Bearer '.length).trim();
    await destroySession(token);
    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'LOGOUT',
      entityType: 'User',
      entityId: req.user!.id,
      ipAddress: req.ip,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const { id, name, username, role, businessId } = req.user!;
  res.json({ id, name, username, role, businessId });
});
