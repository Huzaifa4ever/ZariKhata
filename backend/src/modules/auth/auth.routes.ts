import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../db/prisma';
import { hashPassword, verifyPassword } from '../../lib/password';
import { createSession, destroySession, destroyAllSessionsForUser } from '../../lib/session';
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

/* ────────────────────── owner password recovery ──────────────────────
   There is no email on this system and no second administrator, so a
   forgotten owner password used to mean the books were locked for good. The
   answer is a recovery code the owner generates once and keeps the way they
   keep the shop keys: a slip in the cash box, or a photo on their phone.

   It is deliberately not a "security question" - those are guessable by the
   staff who work there. The code is random, stored only as a bcrypt hash,
   works exactly once, and signing in with it ends every other session, so a
   code that was quietly copied stops working the moment it is used.

   Staff never get one. An employee who forgets their password is reset by the
   owner from the Users page, which is the correct chain of authority. */

/** Groups of four from an unambiguous alphabet - no O/0, I/1, confusable by hand. */
function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]);
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12), chars.slice(12, 16)]
    .map((group) => group.join(''))
    .join('-');
}

/** Typed back in by hand, so spacing, dashes and case are all forgiven. */
function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Whether a recovery code exists, so Settings can nag if it does not. */
authRouter.get('/recovery-code', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.role !== 'OWNER') throw AppError.forbidden('Only the owner has a recovery code.');
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { recoveryCodeHash: true, recoveryCodeSetAt: true },
    });
    res.json({ configured: user.recoveryCodeHash !== null, setAt: user.recoveryCodeSetAt });
  } catch (err) {
    next(err);
  }
});

/**
 * Mint a fresh recovery code.
 *
 * The current password is required: this endpoint hands back the one string
 * that can bypass the password, so an unattended logged-in counter must not be
 * enough to walk away with it. Generating a new one voids the old one.
 */
authRouter.post('/recovery-code', requireAuth, async (req, res, next) => {
  try {
    if (req.user!.role !== 'OWNER') throw AppError.forbidden('Only the owner has a recovery code.');
    const { password } = z.object({ password: z.string().min(1) }).parse(req.body);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await verifyPassword(password, user.passwordHash))) {
      throw AppError.unauthorized('That password is not correct.');
    }

    const code = generateRecoveryCode();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        recoveryCodeHash: await hashPassword(normalizeRecoveryCode(code)),
        recoveryCodeSetAt: new Date(),
      },
    });

    await writeAuditLog(prisma, {
      businessId: user.businessId,
      userId: user.id,
      action: 'RECOVERY_CODE_ISSUED',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
    });

    // The only time the plaintext ever exists outside the owner's hands.
    res.json({ code });
  } catch (err) {
    next(err);
  }
});

const recoverSchema = z.object({
  username: z.string().min(1),
  code: z.string().min(1),
  newPassword: z.string().min(8, 'Pick a password of at least 8 characters.'),
});

/** Sign in with the recovery code instead of the password, and set a new one. */
authRouter.post('/recover', async (req, res, next) => {
  try {
    const { username, code, newPassword } = recoverSchema.parse(req.body);
    // One message for every failure: a wrong username must not be
    // distinguishable from a wrong code.
    const invalid = () => AppError.unauthorized('That username and recovery code do not match.');

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.isActive || user.role !== 'OWNER' || !user.recoveryCodeHash) throw invalid();
    if (!(await verifyPassword(normalizeRecoveryCode(code), user.recoveryCodeHash))) throw invalid();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(newPassword),
        // Single use. Settings will prompt for a new one on the way back in.
        recoveryCodeHash: null,
        recoveryCodeSetAt: null,
      },
    });

    // Anyone already signed in as the owner is signed out - including whoever
    // may have been the reason the password needed resetting.
    await destroyAllSessionsForUser(user.id);

    await writeAuditLog(prisma, {
      businessId: user.businessId,
      userId: user.id,
      action: 'PASSWORD_RECOVERED',
      entityType: 'User',
      entityId: user.id,
      ipAddress: req.ip,
    });

    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
