import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth, requireRole } from '../../middleware/auth';
import { hashPassword, verifyPassword } from '../../lib/password';
import { writeAuditLog } from '../../lib/audit';
import { destroyAllSessionsForUser } from '../../lib/session';
import { AppError } from '../../lib/errors';

export const userRouter = Router();
userRouter.use(requireAuth);

const publicUser = { id: true, name: true, username: true, email: true, role: true, isActive: true, monthlySalary: true, createdAt: true } as const;

userRouter.get('/', requireRole('OWNER'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { businessId: req.businessId! },
      select: publicUser,
      orderBy: { name: 'asc' },
    });
    res.json(users);
  } catch (err) {
    next(err);
  }
});

const usernameSchema = z
  .string()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9._-]+$/, 'Username can only use letters, numbers, dot, dash and underscore');

const meSchema = z
  .object({
    name: z.string().min(1).optional(),
    username: usernameSchema.optional(),
    email: z.string().email().nullish(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  })
  // strict(): a request trying to slip in `role` or `monthlySalary` is
  // rejected outright instead of silently having the key dropped.
  .strict()
  .refine((d) => !d.newPassword || !!d.currentPassword, {
    message: 'Enter your current password to set a new one',
    path: ['currentPassword'],
  });

userRouter.get('/me', async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: publicUser });
    res.json(user);
  } catch (err) {
    next(err);
  }
});

/**
 * Self-service account edits. Deliberately NOT owner-gated: an employee has to
 * be able to change their own password. Role and isActive are absent on purpose
 * — you cannot promote yourself here; that stays on the owner-only route below.
 */
userRouter.patch('/me', async (req, res, next) => {
  try {
    const data = meSchema.parse(req.body);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });

    if (data.newPassword) {
      const ok = await verifyPassword(data.currentPassword!, me.passwordHash);
      if (!ok) throw AppError.badRequest('Current password is incorrect');
    }

    if (data.username && data.username !== me.username) {
      const taken = await prisma.user.findUnique({ where: { username: data.username } });
      if (taken) throw AppError.conflict('That username is already taken');
    }

    const updateData: Record<string, unknown> = { name: data.name, username: data.username };
    if (data.email !== undefined) updateData.email = data.email ?? null;
    if (data.newPassword) updateData.passwordHash = await hashPassword(data.newPassword);

    const updated = await prisma.user.update({ where: { id: me.id }, data: updateData, select: publicUser });

    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: me.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: me.id,
      beforeData: { name: me.name, username: me.username, email: me.email },
      afterData: updated,
      ipAddress: req.ip,
    });

    // A new password or username must not leave old sessions usable elsewhere.
    if (data.newPassword || data.username) await destroyAllSessionsForUser(me.id);

    res.json({ user: updated, mustSignInAgain: Boolean(data.newPassword || data.username) });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  name: z.string().min(1),
  username: usernameSchema,
  email: z.string().email().nullish(),
  monthlySalary: z.number().min(0).nullish(),
  password: z.string().min(8),
  role: z.nativeEnum(UserRole).default(UserRole.EMPLOYEE),
});

userRouter.post('/', requireRole('OWNER'), async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { username: data.username } });
    if (existing) throw AppError.conflict('That username is already taken');

    const passwordHash = await hashPassword(data.password);
    const user = await prisma.user.create({
      data: {
        businessId: req.businessId!,
        name: data.name,
        username: data.username,
        email: data.email ?? null,
        monthlySalary: data.monthlySalary ?? null,
        passwordHash,
        role: data.role,
      },
      select: publicUser,
    });

    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'CREATE',
      entityType: 'User',
      entityId: user.id,
      afterData: user,
      ipAddress: req.ip,
    });

    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  username: usernameSchema.optional(),
  email: z.string().email().nullish(),
  role: z.nativeEnum(UserRole).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(8).optional(),
  monthlySalary: z.number().min(0).nullish(),
});

userRouter.patch('/:id', requireRole('OWNER'), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const target = await prisma.user.findFirst({ where: { id, businessId: req.businessId! } });
    if (!target) throw AppError.notFound('User not found');

    // Locking yourself out, or demoting yourself, has no undo - there may be
    // no other owner left to put it back.
    if (target.id === req.user!.id) {
      if (data.isActive === false) throw AppError.badRequest('You cannot deactivate your own account.');
      if (data.role && data.role !== target.role) throw AppError.badRequest('You cannot change your own role.');
    }

    if (target.role === UserRole.OWNER && data.role === UserRole.EMPLOYEE) {
      const ownerCount = await prisma.user.count({
        where: { businessId: req.businessId!, role: UserRole.OWNER, isActive: true },
      });
      if (ownerCount <= 1) throw AppError.badRequest('A business must keep at least one active owner');
    }

    if (data.username && data.username !== target.username) {
      const taken = await prisma.user.findUnique({ where: { username: data.username } });
      if (taken) throw AppError.conflict('That username is already taken');
    }

    const updateData: Record<string, unknown> = {
      name: data.name,
      username: data.username,
      role: data.role,
      isActive: data.isActive,
    };
    if (data.email !== undefined) updateData.email = data.email ?? null;
    // Owner-only on purpose: salary is deliberately absent from the /me route
    // so staff cannot give themselves a raise.
    if (data.monthlySalary !== undefined) updateData.monthlySalary = data.monthlySalary ?? null;
    if (data.password) updateData.passwordHash = await hashPassword(data.password);

    const updated = await prisma.user.update({ where: { id }, data: updateData, select: publicUser });

    if (data.isActive === false || data.password || data.username) {
      await destroyAllSessionsForUser(id); // force re-login after deactivation or password change
    }

    await writeAuditLog(prisma, {
      businessId: req.businessId!,
      userId: req.user!.id,
      action: 'UPDATE',
      entityType: 'User',
      entityId: id,
      beforeData: { name: target.name, role: target.role, isActive: target.isActive },
      afterData: updated,
      ipAddress: req.ip,
    });

    res.json(updated);
  } catch (err) {
    next(err);
  }
});
