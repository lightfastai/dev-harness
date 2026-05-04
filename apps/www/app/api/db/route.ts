import {
	redactPostgresUrl,
	resolveDevPostgresConfig,
} from "@lightfastai/dev-services";
import path from "node:path";
import postgres from "postgres";

export const runtime = "nodejs";

export async function GET() {
	const config = resolveDevPostgresConfig({
		baseName: "mfe_sandbox",
		cwd: path.resolve(process.cwd(), "../.."),
	});
	const sql = postgres(config.databaseUrl, {
		connect_timeout: 2,
		idle_timeout: 1,
		max: 1,
	});

	try {
		const rows = await sql`
			select
				current_database() as database,
				current_user as user_name,
				now()::text as server_time
		`;
		const row = rows[0] as {
			database: string;
			user_name: string;
			server_time: string;
		};

		return Response.json({
			app: "www",
			databaseName: config.databaseName,
			databaseUrl: redactPostgresUrl(config.databaseUrl),
			source: config.source,
			currentDatabase: row.database,
			currentUser: row.user_name,
			serverTime: row.server_time,
		});
	} finally {
		await sql.end({ timeout: 1 });
	}
}
