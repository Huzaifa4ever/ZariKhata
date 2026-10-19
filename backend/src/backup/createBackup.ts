// Creates a complete logical backup of the database (mysqldump, gzip
// compressed) independent of whatever backup the database host itself
// might offer — see docs/BACKUP.md once written for the full retention and
// restore story. Run with: npm run backup
//
// Requires the `mysqldump` client binary on PATH (Ubuntu/Debian:
// `sudo apt-get install default-mysql-client`). It is never installed by
// this script — installing packages is a step for a human with sudo, not
// something application code should do silently.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env';
import { prisma } from '../db/prisma';
import { parseDatabaseUrl } from './dbUrl';

const BACKUP_DIR = process.env.BACKUP_DIR ?? path.resolve(__dirname, '../../../backups');
const MYSQLDUMP_BIN = process.env.MYSQLDUMP_BIN ?? 'mysqldump';
const RETENTION_DAILY_DAYS = 14;

function timestampForFilename(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

async function runMysqldump(db: ReturnType<typeof parseDatabaseUrl>, outFile: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(outFile), { recursive: true });

  const args = [
    '--host', db.host,
    '--port', db.port,
    '--user', db.user,
    '--single-transaction', // consistent InnoDB snapshot, no table locks
    '--routines',
    '--triggers',
    '--default-character-set=utf8mb4',
    db.database,
  ];

  const dump = spawn(MYSQLDUMP_BIN, args, {
    env: { ...process.env, MYSQL_PWD: db.password }, // not on argv: keeps the password out of `ps`
  });

  let stderr = '';
  dump.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  const gzip = zlib.createGzip();
  const outStream = fs.createWriteStream(outFile);

  const dumpFailed = new Promise<never>((_, reject) => {
    dump.on('error', reject);
    dump.on('close', (code) => {
      if (code !== 0) reject(new Error(`mysqldump exited with code ${code}: ${stderr}`));
    });
  });

  await Promise.race([pipeline(dump.stdout, gzip, outStream), dumpFailed]);
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Deletes old backup files per a simple, documented retention policy: keep
 * every backup from the last RETENTION_DAILY_DAYS days, and for anything
 * older than that, keep only the first backup of each calendar month. This
 * is a retention policy on *backup files*, not on business records in the
 * database — those are never deleted by this or any other script.
 */
async function applyRetention(businessId: number) {
  const files = (await fs.promises.readdir(BACKUP_DIR))
    .filter((f) => f.startsWith(`zarikhata-biz${businessId}-`) && f.endsWith('.sql.gz'))
    .sort(); // filenames are timestamp-sortable (ISO-like), oldest first

  const now = Date.now();
  const cutoff = now - RETENTION_DAILY_DAYS * 24 * 60 * 60 * 1000;
  const keptMonths = new Set<string>();

  for (const file of files) {
    const match = file.match(/zarikhata-biz\d+-(\d{4}-\d{2}-\d{2})T/);
    if (!match) continue;
    const fileDate = new Date(match[1]);
    if (fileDate.getTime() >= cutoff) continue; // within the daily retention window, always keep

    const monthKey = match[1].slice(0, 7);
    if (keptMonths.has(monthKey)) {
      await fs.promises.unlink(path.join(BACKUP_DIR, file));
      console.log(`Retention: removed old backup ${file} (kept one per month beyond ${RETENTION_DAILY_DAYS} days)`);
    } else {
      keptMonths.add(monthKey);
    }
  }
}

async function main() {
  const startedAt = new Date();
  const db = parseDatabaseUrl(env.DATABASE_URL);
  const business = await prisma.business.findFirst();
  const businessId = business?.id ?? 0;

  const filename = `zarikhata-biz${businessId}-${timestampForFilename(startedAt)}.sql.gz`;
  const outFile = path.join(BACKUP_DIR, filename);

  try {
    await runMysqldump(db, outFile);
    const stat = await fs.promises.stat(outFile);
    const checksum = await sha256File(outFile);
    const finishedAt = new Date();

    if (business) {
      await prisma.backupRecord.create({
        data: {
          businessId: business.id,
          filename,
          sizeBytes: stat.size,
          status: 'SUCCESS',
          storageLocation: outFile,
          checksum,
          startedAt,
          finishedAt,
        },
      });
    }

    console.log(`Backup OK: ${outFile} (${(stat.size / 1024).toFixed(1)} KB, sha256 ${checksum})`);
    await applyRetention(businessId);
  } catch (err) {
    console.error('Backup FAILED:', err);
    if (business) {
      await prisma.backupRecord.create({
        data: {
          businessId: business.id,
          filename,
          status: 'FAILED',
          startedAt,
          finishedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        },
      }).catch(() => undefined);
    }
    process.exitCode = 1;
  }
}

main().finally(() => prisma.$disconnect());
