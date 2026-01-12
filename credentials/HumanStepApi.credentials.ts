import {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class HumanStepApi implements ICredentialType {
	name = 'humanStepApi';

	displayName = 'HumanStep API';

	documentationUrl = 'https://humanstep.ai/docs';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			required: true,
			placeholder: 'hs_live_...',
			description: 'API key from HumanStep Settings → API Keys',
		},
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.humanstep.ai/api',
			placeholder: 'https://api.humanstep.ai/api',
			description: 'Base URL for the HumanStep API (include the /api suffix)',
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/team',
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};
}
