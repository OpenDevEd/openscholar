import { drizzle } from 'drizzle-orm/node-postgres';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '@/db/schema';

type DBType = PostgresJsDatabase<typeof schema>;

// Fix for "sorry, too many clients already"
declare global {
    // eslint-disable-next-line no-var -- only var works here
    var db: DBType | undefined;
}

const globalForDb = globalThis as typeof globalThis & { db?: DBType };

let db: DBType;

if (process.env.NODE_ENV === "production") {
    db = drizzle(process.env.DATABASE_URL!, { schema });
} else {
    if (!globalForDb.db) globalForDb.db = drizzle(process.env.DATABASE_URL!, { schema });
    db = globalForDb.db;
}

export { db };