// Restores a backup created by createBackup.ts. SAFE BY DEFAULT: unless you
// pass --overwrite-existing, it creates a brand-new, uniquely-named database
// and restores into that — it will never touch an existing database unless
// you explicitly say so. This is also how to test that a backup is actually
// restorable (Phase 14's "test a restore into a separate temporary database
// before claiming recovery works").
//
// Usage:
//   npm run restore -- /path/to/backup.sql.gz
//   npm run restore -- /path/to/backup.sql.gz --overwrite-existing zarikhata
//
// Requires `mysql` client binary on PATH (same package as mysqldump).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { env } from '../config/env';
import { parseDatabaseUrl } from './dbUrl';

const MYSQL_BIN = process.env.MYSQL_BIN ?? 'mysql';

function runMysqlCommand(db: ReturnType<typeof parseDatabaseUrl>, sql: string, database = ''): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['--host', db.host, '--port', db.port, '--user', db.user];
    if (database) args.push(database);
    const proc = spawn(MYSQL_BIN, args, { env: { ...process.env, MYSQL_PWD: db.password } });
    let stderr = '';
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.stdin.write(sql);
    proc.stdin.end();
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`mysql exited ${code}: ${stderr}`))));
  });
}

async function restoreDump(db: ReturnType<typeof parseDatabaseUrl>, database: string, dumpFile: string): Promise<void> {
  const args = ['--host', db.host, '--port', db.port, '--user', db.user, database];
  const proc = spawn(MYSQL_BIN, args, { env: { ...process.env, MYSQL_PWD: db.password } });
  let stderr = '';
  proc.stderr.on('data', (c) => { stderr += c.toString(); });

  // Feeding stdin finishing (pipeline resolving) only means every byte was
  // written — mysql can still be mid-way through executing the buffered
  // statements. Must also wait for the process to actually exit before
  // treating the restore as done, or a sanity check right after can race
  // ahead of table creation.
  const exited = new Promise<void>((resolve, reject) => {
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`mysql restore exited ${code}: ${stderr}`));
    });
  });

  const gunzip = zlib.createGunzip();
  const inStream = fs.createReadStream(dumpFile);
  await pipeline(inStream, gunzip, proc.stdin);
  await exited;
}

async function sanityCheck(db: ReturnType<typeof parseDatabaseUrl>, database: string) {
  const tables = ['Business', 'Farmer', 'Supplier', 'Product', 'Sale', 'Purchase'];
  console.log(`\nRow counts in restored database "${database}":`);
  for (const table of tables) {
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(
        MYSQL_BIN,
        ['--host', db.host, '--port', db.port, '--user', db.user, '-N', '-B', '-e', `SELECT COUNT(*) FROM \`${table}\``, database],
        { env: { ...process.env, MYSQL_PWD: db.password } },
      );
      let out = '';
      proc.stdout.on('data', (c) => { out += c.toString(); });
      proc.on('error', reject);
      let stderr = '';
      proc.stderr.on('data', (c) => { stderr += c.toString(); });
      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`  ${table}: ${out.trim()}`);
          resolve();
        } else {
          reject(new Error(`sanity check query failed for ${table} (code ${code}): ${stderr}`));
        }
      });
    });
  }
}

async function main() {
  const [, , dumpFile, flag, overwriteTarget] = process.argv;
  if (!dumpFile) {
    console.error('Usage: npm run restore -- /path/to/backup.sql.gz [--overwrite-existing <dbname>]');
    process.exitCode = 1;
    return;
  }
  if (!fs.existsSync(dumpFile)) {
    console.error(`File not found: ${dumpFile}`);
    process.exitCode = 1;
    return;
  }

  const db = parseDatabaseUrl(env.DATABASE_URL);
  const overwrite = flag === '--overwrite-existing';

  if (overwrite) {
    if (!overwriteTarget) {
      console.error('--overwrite-existing requires a database name argument.');
      process.exitCode = 1;
      return;
    }
    console.log(`\n⚠  About to DROP and recreate database "${overwriteTarget}" and restore into it.`);
    console.log('This is for real disaster recovery only. Make sure this is really what you want.');
    await runMysqlCommand(db, `DROP DATABASE IF EXISTS \`${overwriteTarget}\`; CREATE DATABASE \`${overwriteTarget}\`;`);
    await restoreDump(db, overwriteTarget, dumpFile);
    await sanityCheck(db, overwriteTarget);
    console.log(`\nRestore into "${overwriteTarget}" complete.`);
  } else {
    const tempDb = `zarikhata_restore_verify_${Date.now()}`;
    console.log(`\nRestoring into a fresh verification database: ${tempDb}`);
    await runMysqlCommand(db, `CREATE DATABASE \`${tempDb}\`;`);
    await restoreDump(db, tempDb, dumpFile);
    await sanityCheck(db, tempDb);
    console.log(`\nRestore verified successfully in "${tempDb}".`);
    console.log(`This database was only created to prove the backup restores cleanly — drop it when done:`);
    console.log(`  mysql -h ${db.host} -P ${db.port} -u ${db.user} -p -e "DROP DATABASE \`${tempDb}\`;"`);
  }
}

main().catch((err) => {
  console.error('Restore FAILED:', err);
  process.exitCode = 1;
});
