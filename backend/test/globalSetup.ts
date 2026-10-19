import path from 'node:path';
import { execSync } from 'node:child_process';
import { config } from 'dotenv';

// Runs once before the whole test run (not per test file), in the main
// process, before worker threads/processes are spawned — so the env it sets
// here is inherited by every test file. Points the suite at a dedicated
// zarikhata_test database (never the dev or production one) and makes sure
// its schema is current.
export default async function globalSetup() {
  config({ path: path.resolve(__dirname, '../.env.test'), override: true });

  if (!process.env.DATABASE_URL?.includes('zarikhata_test')) {
    throw new Error('Refusing to run tests: DATABASE_URL does not point at the zarikhata_test database.');
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
  });
}
