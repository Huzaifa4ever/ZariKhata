import { Router } from 'express';
import { z } from 'zod';
import { TaskPriority, TaskStatus } from '@prisma/client';
import { prisma } from '../../db/prisma';
import { requireAuth } from '../../middleware/auth';
import { AppError } from '../../lib/errors';
import { parseBusinessDate } from '../../lib/dates';

export const taskRouter = Router();
taskRouter.use(requireAuth);

taskRouter.get('/', async (req, res, next) => {
  try {
    const { status, assignedUserId } = req.query as Record<string, string | undefined>;
    const tasks = await prisma.task.findMany({
      where: {
        businessId: req.businessId!,
        ...(status ? { status: status as TaskStatus } : {}),
        ...(assignedUserId ? { assignedUserId: Number(assignedUserId) } : {}),
      },
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
    });
    res.json(tasks);
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  relatedType: z.string().optional(),
  relatedId: z.number().int().optional(),
  dueDate: z.string().optional(),
  priority: z.nativeEnum(TaskPriority).default(TaskPriority.MEDIUM),
  assignedUserId: z.number().int().optional(),
});

taskRouter.post('/', async (req, res, next) => {
  try {
    const data = createSchema.parse(req.body);
    const task = await prisma.task.create({
      data: {
        businessId: req.businessId!,
        title: data.title,
        description: data.description,
        relatedType: data.relatedType,
        relatedId: data.relatedId,
        dueDate: data.dueDate ? parseBusinessDate(data.dueDate) : null,
        priority: data.priority,
        assignedUserId: data.assignedUserId,
      },
    });
    res.status(201).json(task);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  dueDate: z.string().optional(),
  priority: z.nativeEnum(TaskPriority).optional(),
  status: z.nativeEnum(TaskStatus).optional(),
  assignedUserId: z.number().int().optional(),
});

taskRouter.patch('/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const data = updateSchema.parse(req.body);
    const existing = await prisma.task.findFirst({ where: { id, businessId: req.businessId! } });
    if (!existing) throw AppError.notFound('Task not found');
    const updated = await prisma.task.update({
      where: { id },
      data: {
        ...data,
        dueDate: data.dueDate ? parseBusinessDate(data.dueDate) : undefined,
        completedAt: data.status === TaskStatus.COMPLETED ? new Date() : existing.completedAt,
      },
    });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
