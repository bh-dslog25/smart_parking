import { app } from './app.js';
import { pool } from './db.js';
import { createTemporaryAdmin, promptTemporaryAdmin, pruneTemporaryAdmins } from './temporary-admin.js';
import type { Server } from 'node:http';

let server: Server | undefined;
let temporary: Awaited<ReturnType<typeof createTemporaryAdmin>> | undefined;
let creating: Promise<Awaited<ReturnType<typeof createTemporaryAdmin>>> | undefined;
let stopping = false;
async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  try {
    if (server?.listening) await new Promise<void>(resolve => {
      server!.close(() => resolve());
      server!.closeIdleConnections();
      const timeout = setTimeout(() => server!.closeAllConnections(), 10000);
      timeout.unref();
    });
    temporary ??= await creating;
    await temporary?.remove();
    if (temporary) console.log('Temporary admin removed, including its sessions and recovery records.');
  } catch (error) {
    console.error('Shutdown cleanup failed; startup will retry orphan cleanup:', (error as Error).message);
    exitCode = 1;
  } finally { await pool.end(); process.exit(exitCode); }
}
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
process.on('uncaughtException', error => { console.error(error.message); void shutdown(1); });
process.on('unhandledRejection', error => { console.error(error instanceof Error ? error.message : 'Unhandled rejection'); void shutdown(1); });
try {
  await pruneTemporaryAdmins();
  if (!stopping && process.argv.includes('--temporary-admin')) {
    const details = await promptTemporaryAdmin();
    creating = createTemporaryAdmin(details.name, details.email, details.password, () => { console.error('Temporary admin database lease lost. Stopping server.'); void shutdown(1); });
    temporary = await creating;
    details.password = '';
    console.log(`Temporary admin created for this server run: ${details.email}`);
  }
  if (!stopping) {
    const port = Number(process.env.PORT || 3000);
    server = app.listen(port, () => console.log(`Smart Traffic API: http://localhost:${port}`));
    server.on('error', error => { console.error(error.message); void shutdown(1); });
  }
} catch (error) { console.error((error as Error).message); await shutdown(1); }
