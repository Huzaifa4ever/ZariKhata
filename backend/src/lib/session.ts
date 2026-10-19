import crypto from 'node:crypto';
import { prisma } from '../db/prisma';

// Sessions are opaque server-side tokens (not JWTs): the client (the
// Electron desktop app) sends `Authorization: Bearer <token>` instead of a
// cookie. A desktop client talking to a remote API origin is a cross-site
// context for cookie purposes (SameSite=None; Secure, which some Chromium
// builds restrict further for non-browser contexts), so a bearer token sent
// explicitly on each request sidesteps that entirely while keeping the same
// security properties: the token is opaque, only its SHA-256 hash is stored,
// it expires, and logout revokes it server-side immediately.
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: number,
  meta: { userAgent?: string; ipAddress?: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: meta.userAgent,
      ipAddress: meta.ipAddress,
    },
  });
  return { token, expiresAt };
}

export async function getSessionUser(token: string) {
  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (!session.user.isActive) return null;
  return session.user;
}

export async function destroySession(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.session.deleteMany({ where: { tokenHash } });
}

export async function destroyAllSessionsForUser(userId: number): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
