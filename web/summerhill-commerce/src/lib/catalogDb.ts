import { Pool } from 'pg';

const catalogPool = new Pool({
  host: '127.0.0.1',
  port: 5432,
  user: 'postgres',
  password: 'password',
  database: 'summerhill',
});

export default catalogPool;