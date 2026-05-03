import type { IncomingHttpHeaders } from "node:http";

export type BridgeRequestHeaders = Record<string, string | string[]>;

export function buildBridgeRequestHeaders(
	sourceHeaders: IncomingHttpHeaders,
	target: URL,
): BridgeRequestHeaders {
	const headers = stripHopByHopHeaders(sourceHeaders);
	deleteHeader(headers, "x-portless");
	deleteHeader(headers, "x-portless-hops");
	deleteHeader(headers, "x-forwarded-host");
	deleteHeader(headers, "x-forwarded-proto");
	deleteHeader(headers, "x-forwarded-port");
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
