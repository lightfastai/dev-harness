import type { IncomingHttpHeaders } from "node:http";

export type BridgeRequestHeaders = Record<string, string | string[]>;

export const BRIDGE_EXTERNAL_ORIGIN_HEADER = "x-portless-mfe-external-origin";

export interface BuildBridgeRequestHeadersOptions {
	forwardedHost?: string;
	forwardedProto?: string;
	forwardedPort?: string | number;
	externalOrigin?: string;
}

export interface BuildBridgeExternalOriginOptions {
	sourceHeaders?: IncomingHttpHeaders;
	externalHost: string;
	target: URL;
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
	deleteHeader(headers, BRIDGE_EXTERNAL_ORIGIN_HEADER);
	if (options.forwardedHost) {
		headers["x-forwarded-host"] = options.forwardedHost;
	}
	if (options.forwardedProto) {
		headers["x-forwarded-proto"] = options.forwardedProto;
	}
	if (options.forwardedPort !== undefined) {
		headers["x-forwarded-port"] = String(options.forwardedPort);
	}
	if (options.externalOrigin) {
		headers[BRIDGE_EXTERNAL_ORIGIN_HEADER] = options.externalOrigin;
	}
	headers.host = target.host;
	return headers;
}

export function buildBridgeExternalOrigin(
	options: BuildBridgeExternalOriginOptions,
): string;
export function buildBridgeExternalOrigin(externalHost: string, target: URL): string;
export function buildBridgeExternalOrigin(
	optionsOrExternalHost: BuildBridgeExternalOriginOptions | string,
	target?: URL,
): string {
	const options =
		typeof optionsOrExternalHost === "string"
			? { externalHost: optionsOrExternalHost, target: target as URL }
			: optionsOrExternalHost;
	const forwardedOrigin = buildForwardedExternalOrigin(
		options.sourceHeaders,
		options.externalHost,
	);
	if (forwardedOrigin) {
		return forwardedOrigin;
	}

	const port = options.target.port ? `:${options.target.port}` : "";
	return `${options.target.protocol}//${options.externalHost}${port}`;
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

function buildForwardedExternalOrigin(
	sourceHeaders: IncomingHttpHeaders | undefined,
	externalHost: string,
): string | undefined {
	if (!sourceHeaders) {
		return undefined;
	}

	const forwardedHost = firstHeaderValue(sourceHeaders["x-forwarded-host"]);
	const forwardedProto = firstHeaderValue(sourceHeaders["x-forwarded-proto"]);
	const forwardedPort = firstHeaderValue(sourceHeaders["x-forwarded-port"]);
	if (!forwardedHost || !forwardedProto) {
		return undefined;
	}

	try {
		const origin = new URL(`${normalizeProto(forwardedProto)}://${forwardedHost}`);
		if (isLoopbackHostname(origin.hostname)) {
			return buildDefaultPortExternalOrigin(externalHost, forwardedPort);
		}
		if (!origin.port) {
			if (forwardedPort && !isDefaultPort(origin.protocol, forwardedPort)) {
				origin.port = forwardedPort;
			}
		}
		return origin.origin;
	} catch {
		return undefined;
	}
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
	const firstValue = Array.isArray(value) ? value[0] : value;
	return firstValue?.split(",")[0]?.trim() || undefined;
}

function normalizeProto(proto: string): string {
	return proto.endsWith(":") ? proto.slice(0, -1) : proto;
}

function isDefaultPort(protocol: string, port: string): boolean {
	return (
		(protocol === "https:" && port === "443") ||
		(protocol === "http:" && port === "80")
	);
}

function isLoopbackHostname(hostname: string): boolean {
	return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function buildDefaultPortExternalOrigin(
	externalHost: string,
	forwardedPort: string | undefined,
): string | undefined {
	if (forwardedPort === "443") {
		return `https://${externalHost}`;
	}
	if (forwardedPort === "80") {
		return `http://${externalHost}`;
	}
	return undefined;
}
