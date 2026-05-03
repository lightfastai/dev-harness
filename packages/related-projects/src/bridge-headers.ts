import type { IncomingHttpHeaders } from "node:http";

export type BridgeRequestHeaders = Record<string, string | string[]>;

export interface BuildBridgeRequestHeadersOptions {
	forwardedHost?: string;
	forwardedProto?: string;
	forwardedPort?: string | number;
}

export function buildBridgeRequestHeaders(
	sourceHeaders: IncomingHttpHeaders,
	target: URL,
	options: BuildBridgeRequestHeadersOptions = {},
): BridgeRequestHeaders {
	const headers = stripHopByHopHeaders(sourceHeaders);
	deleteHeader(headers, "x-portless");
	deleteHeader(headers, "x-portless-hops");
	deleteHeader(headers, "x-forwarded-host");
	deleteHeader(headers, "x-forwarded-proto");
	deleteHeader(headers, "x-forwarded-port");
	if (options.forwardedHost) {
		headers["x-forwarded-host"] = options.forwardedHost;
	}
	if (options.forwardedProto) {
		headers["x-forwarded-proto"] = options.forwardedProto;
	}
	if (options.forwardedPort !== undefined) {
		headers["x-forwarded-port"] = String(options.forwardedPort);
	}
	headers.host = target.host;
	return headers;
}

export function stripHopByHopHeaders(
	sourceHeaders: IncomingHttpHeaders,
): BridgeRequestHeaders {
	const blockedHeaders = new Set([
		"connection",
		"keep-alive",
		"proxy-connection",
		"te",
		"trailer",
		"transfer-encoding",
		"upgrade",
	]);
	const headers: BridgeRequestHeaders = {};
	for (const [key, value] of Object.entries(sourceHeaders)) {
		if (value !== undefined && !blockedHeaders.has(key.toLowerCase())) {
			headers[key] = value;
		}
	}
	return headers;
}

function deleteHeader(headers: Record<string, unknown>, headerName: string): void {
	const normalizedHeaderName = headerName.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === normalizedHeaderName) {
			delete headers[key];
		}
	}
}
