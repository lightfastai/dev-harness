import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type PostgresClient = ReturnType<typeof postgres>;
export type PostgresClientOptions = NonNullable<Parameters<typeof postgres>[1]>;

export { sql } from "drizzle-orm";
export type { InferInsertModel, InferSelectModel } from "drizzle-orm";
export {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
export { drizzle };
export { postgres };

export function createPostgresClient(
	databaseUrl: string,
	options: PostgresClientOptions = {},
): PostgresClient {
	return postgres(databaseUrl, options);
}

export function createDrizzlePostgresClient<
	TSchema extends Record<string, unknown>,
>({
	databaseUrl,
	postgresOptions,
	schema,
}: {
	databaseUrl: string;
	postgresOptions?: PostgresClientOptions;
	schema: TSchema;
}) {
	const client = createPostgresClient(databaseUrl, postgresOptions);
	const db = drizzle({ client, schema });

	return { client, db };
}
