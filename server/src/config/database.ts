import { Sequelize } from 'sequelize';
import { env } from './env';
import { logger } from './logger';

// one Sequelize instance for the whole system. All models/*.ts import this
// same object to init; if each module constructed its own, models would be
// registered against different instances and associations silently break
// (symptom: include can't find handler, or FK constraints never get created).
//
// This is also the single place where "one codebase, two databases" is
// resolved: production MySQL, in-memory SQLite for tests. Business code
// never sees the difference.

const sqlLogging = (sql: string) => logger.debug(sql);

export const sequelize =
  env.db.dialect === 'sqlite'
    ? new Sequelize({
        dialect: 'sqlite',
        storage: env.db.storage,
        // no SQL logging under test; SQLite locks at database level, so the
        // pool must be capped at 1 connection or concurrent writes die
        // with SQLITE_BUSY
        logging: env.isTest ? false : sqlLogging,
        pool: { max: 1, min: 0, idle: 10000, acquire: 30000 },
      })
    : new Sequelize(env.db.name, env.db.user, env.db.password, {
        host: env.db.host,
        port: env.db.port,
        dialect: 'mysql',
        logging: sqlLogging,
        // fixed +08:00: how stored dates are interpreted must not follow
        // the host machine's local timezone, otherwise redeploying to a
        // different machine shifts every historical timestamp by hours
        timezone: '+08:00',
        pool: { max: 10, min: 0, idle: 10000, acquire: 30000 },
        define: {
          // event names and addresses can contain any unicode; plain utf8
          // chokes on emoji
          charset: 'utf8mb4',
          collate: 'utf8mb4_unicode_ci',
        },
      });

/** Called at startup: authenticate first (throw immediately on failure -
 *  never listen with a broken connection), then sync the schema. sync()
 *  only exists so a fresh clone can boot directly; a real project would
 *  use migrations here. */
export const connectDatabase = async (): Promise<void> => {
  await sequelize.authenticate();
  await sequelize.sync(env.db.syncAlter ? { alter: true } : undefined);
  logger.info(
    `Database connected (${env.db.dialect}${env.db.dialect === 'mysql' ? ` @ ${env.db.host}:${env.db.port}/${env.db.name}` : ` storage=${env.db.storage}`})`,
  );
};
