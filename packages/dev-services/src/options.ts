import type { Env } from "./types.js";

export interface DevServiceOptions {
	cwd?: string;
	configPath?: string;
	env?: Env;
}

export interface DevServicesDoctorOptions extends DevServiceOptions {
	postgresTable?: string;
}
