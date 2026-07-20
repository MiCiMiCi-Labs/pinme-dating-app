const path = require('path');

// A local-only Postgres cluster used exclusively as Prisma's "shadow
// database" (see shadow-db/README.md for why this exists). Never reachable
// from outside this machine, never holds real data — the credentials below
// are throwaway, not real secrets.
module.exports = {
  databaseDir: path.join(__dirname, 'data'),
  port: 55432,
  user: 'postgres',
  password: 'shadow-db-local-only',
  persistent: true,
};
