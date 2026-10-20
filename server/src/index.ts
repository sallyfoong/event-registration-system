import app from './app';
import { connectDatabase, sequelize } from './config/database';
import { logger } from './config/logger';
import { env } from './config/env';
import { isOneMapConfigured, tokenExpiryMs } from './services/onemapService';

// process lifecycle, kept separate from app.ts.
//
// why the order matters:
//   - connect before listen: if the DB is unreachable, exit instead of
//     running in the worst state possible - port open, monitoring green,
//     every request still failing.
//   - close the pool before exiting: a bare process.exit() cuts off in-flight
//     queries and can leave transactions uncommitted.

const shutdown = async (signal: string): Promise<void> => {
  logger.info(`Received ${signal}, shutting down gracefully...`);
  try {
    // closing the pool waits for current queries and releases connections.
    // if this fails we still must exit, hence the unconditional exit below
    await sequelize.close();
  } catch (err) {
    logger.error('Error while closing database', err);
  }
  process.exit(0);
};

const start = async (): Promise<void> => {
  try {
    await connectDatabase();
    // Without credentials this process cannot validate a postal code, and
    // every attempt to create an event will fail. That is a broken
    // deployment, not a degraded one, so it is logged as an error at boot
    // rather than discovered by the first employee who tries.
    if (!isOneMapConfigured()) {
      logger.error(
        'OneMap credentials are not set: creating an event will fail until ONEMAP_TOKEN (or ONEMAP_EMAIL + ONEMAP_PASSWORD) is configured.',
      );
    } else if (env.onemap.token) {
      // A pre-issued token cannot refresh itself. Its expiry is printed at
      // boot so the renewal is a scheduled task, not a surprise 500.
      const expiresAt = tokenExpiryMs(env.onemap.token);
      const remaining =
        expiresAt === null ? null : Math.round((expiresAt - Date.now()) / 3_600_000);
      if (remaining === null) {
        logger.warn('ONEMAP_TOKEN is set but its expiry could not be read from the JWT.');
      } else if (remaining <= 0) {
        logger.warn('ONEMAP_TOKEN has already expired; postal code lookups will fail.');
      } else {
        logger.info(`Using ONEMAP_TOKEN, expires in ${remaining}h.`);
      }
    }
    app.listen(env.port, () => {
      logger.info(`API listening on http://localhost:${env.port}`);
    });
  } catch (err) {
    // startup failure must exit non-zero, or the container orchestrator
    // reads it as a clean exit and never restarts
    logger.error('Failed to start the server', err);
    process.exit(1);
  }
};

// SIGINT = Ctrl+C, SIGTERM = what Docker/K8s sends on container stop.
// Both must be handled or in-flight requests get hard-cut during deploys.
['SIGINT', 'SIGTERM'].forEach((sig) => {
  process.on(sig as NodeJS.Signals, () => {
    void shutdown(sig);
  });
});

void start();
