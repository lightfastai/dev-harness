const SERVER_ID = Math.random().toString(36).slice(2, 10);

export async function GET() {
	return Response.json({
		ok: true,
		cwd: process.cwd(),
		serverId: SERVER_ID,
		receivedAt: new Date().toISOString(),
	});
}
