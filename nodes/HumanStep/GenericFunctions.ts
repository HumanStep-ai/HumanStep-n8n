import {
	IExecuteFunctions,
	IHookFunctions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';

const DEFAULT_BASE_URL = 'https://api.humanstep.ai/api';

function normalizeBaseUrl(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, '');
}

function formatApiError(error: unknown): string {
	const err = error as {
		message?: string;
		error?: { message?: string };
		response?: { body?: { error?: string; message?: string } };
	};

	const body = err.response?.body;
	const apiMessage = body?.error ?? body?.message;
	if (apiMessage) {
		return `HumanStep API error: ${apiMessage}`;
	}

	if (err.error?.message) {
		return `HumanStep API error: ${err.error.message}`;
	}

	return `HumanStep API error: ${err.message ?? 'Unknown error'}`;
}

export function extractTemplateId(param: unknown): string | undefined {
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

	const options: JsonObject = {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${credentials.apiKey as string}`,
		},
		method,
		body,
		qs,
		uri: uri || `${baseUrl}${path}`,
		json: true,
	};

	if (Object.keys(option).length !== 0) {
		Object.assign(options, option);
	}

	if (Object.keys(body).length === 0) {
		delete options.body;
	}

	try {
		return (await this.helpers.request!(options)) as JsonObject;
	} catch (error) {
		throw new Error(formatApiError(error));
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
): Promise<void> {
	const credentials = await this.getCredentials('humanStepApi');
	const apiBase = normalizeBaseUrl((credentials.baseUrl as string) || DEFAULT_BASE_URL);
	const appBase = getAppBaseUrl(apiBase);
	const body: JsonObject = templateId ? { template_id: templateId } : {};

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
