import {
	IHookFunctions,
	IWebhookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	ILoadOptionsFunctions,
	INodeListSearchResult,
} from 'n8n-workflow';
import { getWebhookId, humanStepApiRequest } from './GenericFunctions';

export class HumanStepTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Human Step Trigger',
		name: 'humanStepTrigger',
		icon: 'file:humanstep.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Triggers when a decision is resolved in Human Step',
		defaults: {
			name: 'Human Step Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'humanStepApi',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{
						name: 'Decision Resolved',
						value: 'decision.resolved',
						description: 'Triggers when a decision has been resolved',
					},
				],
				default: 'decision.resolved',
				description: 'The event to listen to',
			},
			{
				displayName: 'Use Template',
				name: 'useTemplate',
				type: 'boolean',
				default: false,
				description: 'Whether to filter by a specific template',
			},
			{
				displayName: 'Review Template',
				name: 'templateId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						useTemplate: [true],
					},
				},
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a Review Template...',
						typeOptions: {
							searchListMethod: 'getTemplates',
							searchable: true,
						},
					},
					{
						displayName: 'By ID',
						name: 'id',
						type: 'string',
						placeholder: 'e.g. 550e8400-e29b-41d4-a716-446655440000',
					},
				],
				description: 'Only trigger for decisions using this template',
			},
		],
	};

	methods = {
		listSearch: {
			async getTemplates(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const response = await humanStepApiRequest.call(this, 'GET', '/templates');
				const templates = (Array.isArray(response.templates) ? response.templates : []) as Array<{
					name: string;
					id: string;
				}>;

				let results = templates.map((template: { name: string; id: string }) => ({
					name: template.name,
					value: template.id,
				}));

				// Filter results if search query provided
				if (filter) {
					const filterLower = filter.toLowerCase();
					results = results.filter((t: any) => t.name.toLowerCase().includes(filterLower));
				}

				return { results };
			},
		},
	};

	// @ts-ignore (this is a comment because parameters are optional)
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');

				if (webhookData.webhookId === undefined) {
					return false;
				}

				try {
					const response = await humanStepApiRequest.call(
						this,
						'GET',
						`/webhooks/${webhookData.webhookId}`,
					);
					return getWebhookId(response) !== undefined;
				} catch (error) {
					return false;
				}
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default') as string;
				const webhookData = this.getWorkflowStaticData('node');
				const event = this.getNodeParameter('event') as string;
				const useTemplate = this.getNodeParameter('useTemplate') as boolean;

				const body: any = {
					name: `n8n-trigger-${this.getWorkflow().id}`,
					url: webhookUrl,
					events: [event],
					is_active: true,
				};

				// Include template_id if using template filter
				if (useTemplate) {
					const templateIdParam = this.getNodeParameter('templateId') as any;
					const templateId = templateIdParam?.value;
					if (templateId) {
						body.template_id = templateId;
					}
				}

				const responseData = await humanStepApiRequest.call(
					this,
					'POST',
					'/webhooks',
					body,
				);

				const webhookId = getWebhookId(responseData);
				if (webhookId === undefined) {
					return false;
				}

				webhookData.webhookId = webhookId;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const webhookData = this.getWorkflowStaticData('node');

				if (webhookData.webhookId !== undefined) {
					try {
						await humanStepApiRequest.call(
							this,
							'DELETE',
							`/webhooks/${webhookData.webhookId}`,
						);
					} catch (error) {
						return false;
					}

					delete webhookData.webhookId;
				}

				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const bodyData = this.getBodyData();
		const useTemplate = this.getNodeParameter('useTemplate') as boolean;

		// If template filter is enabled, check if the decision matches
		if (useTemplate) {
			const templateIdParam = this.getNodeParameter('templateId') as any;
			const templateId = templateIdParam?.value;
			
			// Check if the webhook payload contains the decision data
			const decision = (bodyData as any).decision || bodyData;
			
			// Filter by template if specified
			if (templateId && (decision as any).template_id !== templateId) {
				// Return empty response - this decision doesn't match our filter
				return {
					workflowData: [],
				};
			}
		}

		return {
			workflowData: [this.helpers.returnJsonArray(bodyData)],
		};
	}
}
