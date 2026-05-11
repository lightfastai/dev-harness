import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import {
	createLinkedRuntime,
	createSingleChildRuntime,
} from "../src/runtime-internal.js";

const longLived = (extraGrandchildren = 0) =>
	spawn(
		process.execPath,
		[
			"-e",
			`for (let i = 0; i < ${extraGrandchildren}; i++) require("child_process").spawn(process.execPath, ["-e", "setInterval(()=>{}, 1<<30)"]); setInterval(()=>{}, 1<<30);`,
		],
		{ detached: process.platform !== "win32", stdio: "ignore" },
	);

const shortLived = () =>
	spawn(
		process.execPath,
		["-e", "setTimeout(()=>process.exit(0), 50)"],
		{ detached: process.platform !== "win32", stdio: "ignore" },
	);

// A child that ignores SIGTERM. Useful for asserting escalation behavior.
// Caller must wait long enough for the handler to register before signalling.
const sigtermIgnoring = () =>
	spawn(
		process.execPath,
		["-e", "process.on('SIGTERM', ()=>{}); setInterval(()=>{}, 1<<30);"],
		{ detached: process.platform !== "win32", stdio: "ignore" },
	);

// Node startup + handler install takes ~30-80ms. Give 200ms of headroom before
// any test sends a signal that the child is expected to ignore.
const HANDLER_INSTALL_WAIT_MS = 200;

const pidAlive = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("waits for the main child even when an auxiliary exits first", { timeout: 10_000 }, async () => {
	// Main ignores SIGTERM, so when aux's exit triggers crash-recovery shutdown
	// (Phase 1 §3), main survives long enough for us to observe that
	// runtime.exit does NOT resolve from aux exit alone.
	const main = sigtermIgnoring();
	await wait(HANDLER_INSTALL_WAIT_MS);
	const aux = shortLived();
	const runtime = createLinkedRuntime(main, [aux]);

	// Aux exits in ~50ms → triggers beginShutdown → main sent SIGTERM (ignored).
	await wait(300);

	// runtime.exit must still be pending because main is alive.
	let settled = false;
	void runtime.exit.then(() => {
		settled = true;
	});
	await wait(100);
	assert.equal(settled, false);
	assert.equal(pidAlive(main.pid!), true);

	// Force escalation: second stop maps to SIGKILL via Phase 1's beginShutdown.
	runtime.stop("SIGTERM");
	await runtime.exit;
	assert.equal(pidAlive(main.pid!), false);
});

test("kills the entire process group on stop()", { timeout: 10_000 }, async () => {
	const main = longLived(2);
	const runtime = createSingleChildRuntime(main);

	// Wait for the child to actually fork its grandchildren.
	await wait(200);

	runtime.stop("SIGTERM");
	await runtime.exit;
	assert.equal(pidAlive(main.pid!), false);

	// Group is gone — process.kill(-pgid, 0) should ESRCH.
	assert.throws(() => process.kill(-main.pid!, 0), /ESRCH/);
});

test(
	"escalates to SIGKILL when stop() is called a second time (linked runtime)",
	{ timeout: 10_000 },
	async () => {
		const stubborn = sigtermIgnoring();
		await wait(HANDLER_INSTALL_WAIT_MS);
		const aux = shortLived();
		const runtime = createLinkedRuntime(stubborn, [aux]);

		runtime.stop("SIGTERM");
		await wait(100);
		assert.equal(pidAlive(stubborn.pid!), true); // ignored SIGTERM

		runtime.stop("SIGTERM"); // second call → SIGKILL via beginShutdown
		await runtime.exit;
		assert.equal(pidAlive(stubborn.pid!), false);
	},
);

test(
	"escalates to SIGKILL after the grace window (single-child runtime)",
	{ timeout: 10_000 },
	async () => {
		const stubborn = sigtermIgnoring();
		await wait(HANDLER_INSTALL_WAIT_MS);
		const runtime = createSingleChildRuntime(stubborn);

		runtime.stop("SIGTERM");
		// SIGTERM ignored; wait past SHUTDOWN_GRACE_MS for the timer-driven SIGKILL.
		await runtime.exit;
		assert.equal(pidAlive(stubborn.pid!), false);
	},
);
