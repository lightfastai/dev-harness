import { getDb, redactDbUrl, sql } from "@example/db-app";

export const runtime = "nodejs";

export async function GET() {
	const { config, db } = getDb();
	const rows = await db.execute(sql`
			select
				current_database() as database,
				current_user as user_name,
				now()::text as server_time,
				to_regclass('public.example_probe_events') is not null as schema_ready
		`);
	const row = rows[0] as {
		database: string;
		schema_ready: boolean;
		user_name: string;
		server_time: string;
	};

	return Response.json({
		app: "www",
		databaseName: config.databaseName,
		databaseUrl: redactDbUrl(config.databaseUrl),
		driver: "drizzle",
		source: config.source,
		currentDatabase: row.database,
		currentUser: row.user_name,
		schemaReady: Boolean(row.schema_ready),
		serverTime: row.server_time,
	});
}
