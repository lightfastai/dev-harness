import { redactPostgresUrl } from "@lightfastai/dev-services";
import { sql } from "drizzle-orm";

import { getAppDb } from "../../../lib/db";

export const runtime = "nodejs";

export async function GET() {
	const { config, db } = getAppDb();
	const rows = await db.execute(sql`
			select
				current_database() as database,
				current_user as user_name,
				now()::text as server_time
		`);
	const row = rows[0] as {
		database: string;
		user_name: string;
		server_time: string;
	};

	return Response.json({
		app: "app",
		databaseName: config.databaseName,
		databaseUrl: redactPostgresUrl(config.databaseUrl),
		driver: "drizzle",
		source: config.source,
		currentDatabase: row.database,
		currentUser: row.user_name,
		serverTime: row.server_time,
	});
}
