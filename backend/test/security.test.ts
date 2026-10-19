import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { prisma } from '../src/db/prisma';
import { hashPassword } from '../src/lib/password';
import { app, getTestContext, uniqueSuffix, TestContext } from './helpers';

describe('security and tenant isolation', () => {
  let ctx: TestContext;
  let auth: string;

  beforeAll(async () => {
    ctx = await getTestContext();
    auth = `Bearer ${ctx.token}`;
  });

  it('rejects requests with no token', async () => {
    const res = await request(app).get('/api/farmers');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a garbage token', async () => {
    const res = await request(app).get('/api/farmers').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });

  it('rejects invalid login credentials without revealing whether the username exists', async () => {
    const badUser = await request(app).post('/api/auth/login').send({ username: 'no-such-user', password: 'whatever' });
    const badPassword = await request(app).post('/api/auth/login').send({ username: 'test-owner', password: 'wrong-password' });
    expect(badUser.status).toBe(401);
    expect(badPassword.status).toBe(401);
    expect(badUser.body.error).toBe(badPassword.body.error);
  });

  it('a non-owner employee cannot create other users', async () => {
    const username = `employee-${uniqueSuffix()}`;
    await request(app)
      .post('/api/users')
      .set('Authorization', auth)
      .send({ name: 'Employee', username, password: 'Password123!', role: UserRole.EMPLOYEE });

    const employeeLogin = await request(app).post('/api/auth/login').send({ username, password: 'Password123!' });
    const employeeAuth = `Bearer ${employeeLogin.body.token}`;

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', employeeAuth)
      .send({ name: 'Should Fail', username: `fail-${uniqueSuffix()}`, password: 'Password123!' });
    expect(res.status).toBe(403);
  });

  it('a user from one business cannot see another business\'s farmers', async () => {
    const otherBusiness = await prisma.business.create({ data: { name: `Other Biz ${uniqueSuffix()}` } });
    const otherUsername = `other-owner-${uniqueSuffix()}`;
    await prisma.user.create({
      data: {
        businessId: otherBusiness.id,
        name: 'Other Owner',
        username: otherUsername,
        passwordHash: await hashPassword('Password123!'),
        role: UserRole.OWNER,
      },
    });
    const otherLogin = await request(app).post('/api/auth/login').send({ username: otherUsername, password: 'Password123!' });
    const otherAuth = `Bearer ${otherLogin.body.token}`;

    const farmer = await request(app).post('/api/farmers').set('Authorization', auth).send({ name: `Isolated Farmer ${uniqueSuffix()}` });

    const crossAccess = await request(app).get(`/api/farmers/${farmer.body.id}`).set('Authorization', otherAuth);
    expect(crossAccess.status).toBe(404); // not found, not leaked

    const otherList = await request(app).get('/api/farmers').set('Authorization', otherAuth);
    expect(otherList.body.find((f: { id: number }) => f.id === farmer.body.id)).toBeUndefined();
  });

  it('rejects malformed input instead of crashing', async () => {
    const res = await request(app)
      .post('/api/farmers')
      .set('Authorization', auth)
      .send({ name: '' }); // empty name fails zod's min(1)
    expect(res.status).toBe(400);
  });

  it('logout revokes the session so the old token stops working', async () => {
    const username = `logout-test-${uniqueSuffix()}`;
    await request(app)
      .post('/api/users')
      .set('Authorization', auth)
      .send({ name: 'Logout Test', username, password: 'Password123!' });
    const login = await request(app).post('/api/auth/login').send({ username, password: 'Password123!' });
    const tempAuth = `Bearer ${login.body.token}`;

    const before = await request(app).get('/api/auth/me').set('Authorization', tempAuth);
    expect(before.status).toBe(200);

    await request(app).post('/api/auth/logout').set('Authorization', tempAuth);

    const after = await request(app).get('/api/auth/me').set('Authorization', tempAuth);
    expect(after.status).toBe(401);
  });
});
