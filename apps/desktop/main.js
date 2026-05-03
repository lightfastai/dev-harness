const { app, BrowserWindow, net } = require("electron");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const PORTLESS_NAME = process.env.DESKTOP_PORTLESS_NAME || "mfe";
const TARGET_PATH = process.env.DESKTOP_TARGET_PATH || "/sign-in";
const QUIT_AFTER_LOAD = process.env.DESKTOP_QUIT_AFTER_LOAD === "1";

const TARGET = resolveTarget();
const NAME = process.env.DESKTOP_NAME || defaultDesktopName(TARGET);

app.setName(NAME);
app.setPath("userData", path.join(app.getPath("appData"), NAME));

function emit(event, payload) {
	process.stdout.write(`DESKTOP_EVENT ${event} ${JSON.stringify(payload)}\n`);
}

function resolveTarget() {
	if (process.env.DESKTOP_TARGET_URL) {
		return process.env.DESKTOP_TARGET_URL;
	}

	const baseUrl = resolvePortlessUrl(PORTLESS_NAME);
	if (baseUrl) {
		return withTargetPath(baseUrl, TARGET_PATH);
	}

	const protocol = process.env.PORTLESS_HTTPS === "0" ? "http" : "https";
	const explicitPort = process.env.PORTLESS_PORT ? `:${process.env.PORTLESS_PORT}` : "";
	return withTargetPath(`${protocol}://${PORTLESS_NAME}.localhost${explicitPort}`, TARGET_PATH);
}

function resolvePortlessUrl(name) {
	const commands = [
		["portless", ["get", name]],
		["pnpm", ["exec", "portless", "get", name]],
	];

	for (const [command, args] of commands) {
		try {
			const output = execFileSync(command, args, {
				cwd: ROOT,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();

			if (output) {
				return output;
			}
		} catch {
			// Try the next command/fallback. The desktop app can still use an explicit URL.
		}
	}

	return undefined;
}

function withTargetPath(baseUrl, targetPath) {
	const normalizedPath = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
	return new URL(normalizedPath, baseUrl).toString();
}

function defaultDesktopName(target) {
	const baseName = "mfe-desktop";

	try {
		const host = new URL(target).hostname;
		const suffix = `${PORTLESS_NAME}.localhost`;

		if (host === suffix) {
			return baseName;
		}

		if (host.endsWith(`.${suffix}`)) {
			const prefix = host.slice(0, -`.${suffix}`.length);
			const safePrefix = prefix
				.split(".")
				.join("-")
				.replace(/[^a-z0-9-]+/gi, "-")
				.replace(/^-+|-+$/g, "")
				.toLowerCase();

			if (safePrefix) {
				return `${baseName}-${safePrefix}`;
			}
		}
	} catch {
		// Keep the base app name if the target is not a URL.
	}

	return baseName;
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
