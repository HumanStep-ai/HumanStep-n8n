import {
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
	NodeOperationError,
} from 'n8n-workflow';

const DEFAULT_BASE_URL = 'https://api.humanstep.ai/api';
const DEFAULT_WAIT_POLL_MS = 2000;
const DEFAULT_WAIT_TIMEOUT_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 60_000;

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

function appendQueryParams(url: string, qs: JsonObject): string {
	if (Object.keys(qs).length === 0) {
		return url;
	}

	const parsed = new URL(url);
	for (const [key, value] of Object.entries(qs)) {
		if (value !== undefined && value !== null) {
			parsed.searchParams.set(key, String(value));
		}
	}
	return parsed.toString();
}

function formatApiError(error: unknown): string {
	const err = error as {
		message?: string;
		error?: { message?: string };
		response?: {
			data?: { error?: string; message?: string } | string;
			body?: { error?: string; message?: string };
		};
	};

	const responseData = err.response?.data ?? err.response?.body;
	if (typeof responseData === 'string' && responseData.trim()) {
		return `HumanStep API error: ${responseData}`;
	}
	if (responseData && typeof responseData === 'object') {
		const apiMessage =
			(responseData as { error?: string }).error ?? (responseData as { message?: string }).message;
		if (apiMessage) {
			return `HumanStep API error: ${apiMessage}`;
		}
	}

	if (err.error?.message) {
		return `HumanStep API error: ${err.error.message}`;
	}

	return `HumanStep API error: ${err.message ?? 'Unknown error'}`;
}

function extractResourceLocatorValue(param: unknown): string | undefined {
	if (typeof param === 'string' && param.trim()) {
		return param.trim();
	}
	if (param && typeof param === 'object') {
		const value = (param as Record<string, unknown>).value;
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

export function extractTemplateId(param: unknown): string | undefined {
	return extractResourceLocatorValue(param);
}

export function extractCategoryId(param: unknown): string | undefined {
	return extractResourceLocatorValue(param);
}

export function getAppBaseUrl(apiBaseUrl: string): string {
	const normalized = normalizeBaseUrl(apiBaseUrl);
	if (normalized.includes('://api.humanstep.ai')) {
		return 'https://app.humanstep.ai';
	}
	if (normalized.includes('://api.humanstep.local')) {
		return 'http://app.humanstep.local:3000';
	}
	if (normalized.includes('localhost:5173') || normalized.includes('127.0.0.1:5173')) {
		return normalized.replace(/\/api$/i, '') || 'http://localhost:5173';
	}
	if (normalized.includes('://api.')) {
		return normalized.replace(/\/api$/i, '').replace('://api.', '://app.');
	}
	return normalized.replace(/\/api$/i, '');
}

function isExecuteContext(
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions,
): context is IExecuteFunctions {
	return typeof (context as IExecuteFunctions).getInputData === 'function';
}

async function performHttpRequest(
	context: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions,
	options: {
		method: string;
		url: string;
		headers: Record<string, string>;
		body?: JsonObject;
	},
): Promise<JsonObject> {
	const hasBody = options.body !== undefined && Object.keys(options.body).length > 0;
	const useHttpRequest = isExecuteContext(context) && !!context.helpers.httpRequest;

	if (useHttpRequest) {
		const httpOptions: IHttpRequestOptions = {
			method: options.method as IHttpRequestOptions['method'],
			url: options.url,
			headers: options.headers,
			timeout: REQUEST_TIMEOUT_MS,
			...(hasBody ? { body: options.body } : {}),
		};
		return (await context.helpers.httpRequest!(httpOptions)) as JsonObject;
	}

	if (context.helpers.request) {
		const legacyOptions: JsonObject = {
			method: options.method,
			uri: options.url,
			headers: options.headers,
			json: true,
			timeout: REQUEST_TIMEOUT_MS,
			...(hasBody && options.body ? { body: options.body } : {}),
		};
		return (await context.helpers.request(legacyOptions)) as JsonObject;
	}

	if (context.helpers.httpRequest) {
		const httpOptions: IHttpRequestOptions = {
			method: options.method as IHttpRequestOptions['method'],
			url: options.url,
			headers: options.headers,
			timeout: REQUEST_TIMEOUT_MS,
			...(hasBody ? { body: options.body } : {}),
		};
		return (await context.helpers.httpRequest(httpOptions)) as JsonObject;
	}

	throw new Error('HumanStep node: HTTP helpers are unavailable in this n8n version');
}

export async function humanStepApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions,
	method: string,
	resource: string,
	body: JsonObject = {},
	qs: JsonObject = {},
	uri?: string,
	option: JsonObject = {},
): Promise<JsonObject> {
	const credentials = await this.getCredentials('humanStepApi');

	if (credentials === undefined) {
		throw new Error('No credentials returned');
	}

	const baseUrl = normalizeBaseUrl((credentials.baseUrl as string) || DEFAULT_BASE_URL);
	const path = resource.startsWith('/') ? resource : `/${resource}`;
	let targetUrl = appendQueryParams(uri || `${baseUrl}${path}`, qs);

	if (Object.keys(option).length !== 0 && typeof option.uri === 'string') {
		targetUrl = appendQueryParams(option.uri as string, qs);
	}

	const headers = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${credentials.apiKey as string}`,
	};

	try {
		return await performHttpRequest(this, {
			method,
			url: targetUrl,
			headers,
			body: Object.keys(body).length > 0 ? body : undefined,
		});
	} catch (error) {
		throw new Error(formatApiError(error));
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getDecision(
	this: IExecuteFunctions,
	decisionId: string,
): Promise<JsonObject> {
	return humanStepApiRequest.call(this, 'GET', `/decisions/${encodeURIComponent(decisionId)}`);
}

export async function waitForDecision(
	this: IExecuteFunctions,
	decisionId: string,
	options: { pollMs?: number; timeoutMs?: number; resolveUrl?: string } = {},
): Promise<JsonObject> {
	const pollMs = Math.max(500, options.pollMs ?? DEFAULT_WAIT_POLL_MS);
	const timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS);
	const deadline = Date.now() + timeoutMs;

	while (true) {
		const decision = await getDecision.call(this, decisionId);
		if (decision.status !== 'pending') {
			return decision;
		}
		if (Date.now() >= deadline) {
			const resolveHint = options.resolveUrl
				? ` Resolve it at ${options.resolveUrl}.`
				: '';
			throw new NodeOperationError(
				this.getNode(),
				`Timeout waiting for decision ${decisionId} after ${timeoutMs}ms.${resolveHint}`,
			);
		}
		await sleep(Math.min(pollMs, Math.max(0, deadline - Date.now())));
	}
}

export function getWebhookId(response: unknown): string | undefined {
	const record = response as Record<string, unknown>;
	const webhook = (record.webhook ?? record) as Record<string, unknown>;
	return typeof webhook.id === 'string' ? webhook.id : undefined;
}

export async function triggerTestWebhook(
	this: IHookFunctions,
	webhookId: string,
	templateId?: string,
	categoryId?: string,
): Promise<void> {
	const credentials = await this.getCredentials('humanStepApi');
	const apiBase = normalizeBaseUrl((credentials.baseUrl as string) || DEFAULT_BASE_URL);
	const appBase = getAppBaseUrl(apiBase);
	const body: JsonObject = {};

	if (templateId) {
		body.template_id = templateId;
	}
	if (categoryId) {
		body.category_id = categoryId;
	}

	await humanStepApiRequest.call(
		this,
		'POST',
		'',
		body,
		{},
		`${appBase}/api/webhooks/${webhookId}/test`,
	);
}

export async function listActiveTemplates(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<Array<{ name: string; value: string }>> {
	const response = await humanStepApiRequest.call(this, 'GET', '/templates', {}, { status: 'active' });
	const templates = (Array.isArray(response.templates) ? response.templates : []) as Array<{
		name: string;
		id: string;
	}>;

	let results = templates.map((template) => ({
		name: template.name,
		value: template.id,
	}));

	if (filter) {
		const filterLower = filter.toLowerCase();
		results = results.filter((t) => t.name.toLowerCase().includes(filterLower));
	}

	return results;
}

export async function listCategories(
	this: ILoadOptionsFunctions,
	filter?: string,
): Promise<Array<{ name: string; value: string }>> {
	const response = await humanStepApiRequest.call(this, 'GET', '/categories');
	const categories = (Array.isArray(response.categories) ? response.categories : []) as Array<{
		name: string;
		id: string;
	}>;

	let results = categories.map((category) => ({
		name: category.name,
		value: category.id,
	}));

	if (filter) {
		const filterLower = filter.toLowerCase();
		results = results.filter((category) => category.name.toLowerCase().includes(filterLower));
	}

	return results;
}
