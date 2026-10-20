/** Jest global setup: configure the in-memory SQLite database and reset the
 *  tables between tests. Tests are completely isolated and never touch MySQL. */
process.env.NODE_ENV = 'test';
process.env.DB_DIALECT = 'sqlite';
process.env.DB_STORAGE = ':memory:';
process.env.LOG_LEVEL = 'error';
process.env.CORS_ORIGIN = 'http://localhost:8001';

import { sequelize } from '../config/database';
import { Event, Handler, Registration } from '../models';

beforeAll(async () => {
  await sequelize.sync({ force: true });
});

beforeEach(async () => {
  // Order matters because of foreign keys.
  await Registration.destroy({ where: {}, truncate: false });
  await Event.destroy({ where: {}, truncate: false });
  await Handler.destroy({ where: {}, truncate: false });
});

afterAll(async () => {
  await sequelize.close();
});
