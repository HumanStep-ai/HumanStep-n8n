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
