const { app, BrowserWindow, net } = require("electron");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORTLESS_NAME = process.env.DESKTOP_PORTLESS_NAME;
const TARGET_PATH = process.env.DESKTOP_TARGET_PATH || "/sign-in";
const QUIT_AFTER_LOAD = process.env.DESKTOP_QUIT_AFTER_LOAD === "1";

function emit(event, payload) {
	process.stdout.write(`DESKTOP_EVENT ${event} ${JSON.stringify(payload)}\n`);
}

async function resolveIdentity() {
	const { resolvePortlessMfeRuntime } = await import("@lightfastai/related-projects");

	return resolvePortlessMfeRuntime({
		cwd: ROOT,
		name: PORTLESS_NAME,
		path: TARGET_PATH,
		targetUrl: process.env.DESKTOP_TARGET_URL,
	});
}

function fetchViaNet(url) {
	return new Promise((resolve, reject) => {
		const req = net.request(url);
		let body = "";
		req.on("response", (resp) => {
			resp.on("data", (chunk) => {
				body += chunk.toString();
			});
			resp.on("end", () => resolve({ statusCode: resp.statusCode, body }));
			resp.on("error", reject);
		});
		req.on("error", reject);
		req.end();
	});
}

async function main() {
	const identity = await resolveIdentity();
	const target = identity.targetUrl;
	const name = process.env.DESKTOP_NAME || identity.name;

	app.setName(name);
	app.setPath("userData", path.join(app.getPath("appData"), name));

	await app.whenReady();

	emit("ready", { name, target, userData: app.getPath("userData") });

	const win = new BrowserWindow({
		width: 900,
		height: 600,
		title: `${name} -> ${target}`,
		webPreferences: { contextIsolation: true },
	});

	win.webContents.on("did-fail-load", (_e, code, desc, url) => {
		emit("did-fail-load", { code, desc, url });
	});

	try {
		await win.loadURL(target);
		const mainText = await win.webContents.executeJavaScript(
			'document.querySelector("main")?.textContent || ""',
		);
		emit("did-finish-load", { loadedUrl: win.webContents.getURL(), mainText });

		const rendererApi = await win.webContents.executeJavaScript(`
			fetch('/api/ping')
				.then(r => r.json())
				.catch(e => ({ error: String(e), message: e?.message }))
		`);
		emit("api-call:renderer", rendererApi);

		const origin = new URL(target).origin;
		const mainApi = await fetchViaNet(`${origin}/api/ping`);
		emit("api-call:main-net", mainApi);
	} catch (err) {
		emit("error", { message: String(err) });
	}

	if (QUIT_AFTER_LOAD) {
		setTimeout(() => app.quit(), 500);
	}
}

main().catch((err) => {
	emit("error", { message: String(err) });
	app.quit();
});

app.on("window-all-closed", () => app.quit());
