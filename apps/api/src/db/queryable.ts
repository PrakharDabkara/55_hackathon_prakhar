import type { Pool, PoolClient } from 'pg';

/** Anything with `query`: a pool, a checked-out client, or a test double. */
export type Queryable = Pick<Pool | PoolClient, 'query'>;
