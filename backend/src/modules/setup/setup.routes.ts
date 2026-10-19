import { Router } from 'express';
import { z } from 'zod';
import { createSession } from '../../lib/session';
import { isSetupNeeded, performInitialSetup } from './setup.service';

export const setupRouter = Router();

setupRouter.get('/status', async (_req, res, next) => {
  try {
    res.json({ needsSetup: await isSetupNeeded() });
  } catch (err) {
    next(err);
  }
});

const setupSchema = z.object({
  shopName: z.string().min(1),
  ownerName: z.string().min(1),
  username: z.string().min(3),
  password: z.string().min(8),
});

setupRouter.post('/', async (req, res, next) => {
  try {
    const data = setupSchema.parse(req.body);
    const { business, owner } = await performInitialSetup(data);
    const { token } = await createSession(owner.id, {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });
    res.status(201).json({
      token,
      user: { id: owner.id, name: owner.name, username: owner.username, role: owner.role, businessId: business.id },
    });
  } catch (err) {
    next(err);
  }
});
