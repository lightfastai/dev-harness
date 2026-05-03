const { app, BrowserWindow, net } = require("electron");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORTLESS_NAME = process.env.DESKTOP_PORTLESS_NAME || "mfe";
const TARGET_PATH = process.env.DESKTOP_TARGET_PATH || "/sign-in";
const QUIT_AFTER_LOAD = process.env.DESKTOP_QUIT_AFTER_LOAD === "1";
const DESKTOP_BASE_NAME = "mfe-desktop";

const IDENTITY = resolveIdentity();
const TARGET = IDENTITY.targetUrl;
const NAME = process.env.DESKTOP_NAME || IDENTITY.name;

app.setName(NAME);
app.setPath("userData", path.join(app.getPath("appData"), NAME));

function emit(event, payload) {
	process.stdout.write(`DESKTOP_EVENT ${event} ${JSON.stringify(payload)}\n`);
}

function resolveIdentity() {
	const args = [
		"identity",
		"--json",
		"--name",
		PORTLESS_NAME,
		"--path",
		TARGET_PATH,
		"--app-name",
		DESKTOP_BASE_NAME,
	];

	if (process.env.DESKTOP_TARGET_URL) {
		args.push("--target-url", process.env.DESKTOP_TARGET_URL);
	}

	const commands = [
		["portless-mfe", args],
		["pnpm", ["exec", "portless-mfe", ...args]],
	];

	for (const [command, args] of commands) {
		try {
			const output = execFileSync(command, args, {
				cwd: ROOT,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();

			if (output) {
				return JSON.parse(output);
			}
		} catch {
			// Try the next command. URL and identity resolution lives in portless-mfe.
		}
	}

	throw new Error("Unable to resolve desktop target via portless-mfe identity.");
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

app.whenReady().then(async () => {
	emit("ready", { name: NAME, target: TARGET, userData: app.getPath("userData") });

	const win = new BrowserWindow({
		width: 900,
		height: 600,
		title: `${NAME} -> ${TARGET}`,
		webPreferences: { contextIsolation: true },
	});

	win.webContents.on("did-fail-load", (_e, code, desc, url) => {
		emit("did-fail-load", { code, desc, url });
	});

	try {
		await win.loadURL(TARGET);
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

		const origin = new URL(TARGET).origin;
		const mainApi = await fetchViaNet(`${origin}/api/ping`);
		emit("api-call:main-net", mainApi);
	} catch (err) {
		emit("error", { message: String(err) });
	}

	if (QUIT_AFTER_LOAD) {
		setTimeout(() => app.quit(), 500);
	}
});

app.on("window-all-closed", () => app.quit());
