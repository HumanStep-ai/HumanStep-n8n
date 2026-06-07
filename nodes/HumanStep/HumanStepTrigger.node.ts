import {
	IHookFunctions,
	IWebhookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookResponseData,
	ILoadOptionsFunctions,
	INodeListSearchResult,
} from 'n8n-workflow';
import {
	extractCategoryId,
	extractTemplateId,
	getWebhookId,
	humanStepApiRequest,
	listActiveTemplates,
	listCategories,
	triggerTestWebhook,
} from './GenericFunctions';
import type { JsonObject } from 'n8n-workflow';

export class HumanStepTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HumanStep Trigger',
		name: 'humanStepTrigger',
		icon: 'file:humanstep.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Triggers when a decision is resolved in HumanStep',
		defaults: {
			name: 'HumanStep Trigger',
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
				displayName:
					'Webhook trigger: click **Execute step** to register a listener and receive a test payload. Activate the workflow for live events. n8n must be reachable from the internet (use n8n Cloud or a tunnel for local instances).',
				name: 'triggerNotice',
				type: 'notice',
				default: '',
			},
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
				displayName: 'Templates',
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
			{
				displayName: 'Use Category',
				name: 'useCategory',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						useTemplate: [false],
					},
				},
				description: 'Whether to filter by a specific category',
			},
			{
				displayName: 'Category',
				name: 'categoryId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						useTemplate: [false],
						useCategory: [true],
					},
				},
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						placeholder: 'Select a Category...',
						typeOptions: {
							searchListMethod: 'getCategories',
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
				description: 'Only trigger for decisions in this category',
			},
			{
				displayName: 'Wait for Real Data',
				name: 'waitForRealData',
				type: 'boolean',
				default: false,
				description:
					'Whether to wait for a real HumanStep webhook instead of receiving an immediate sample payload',
			},
		],
	};

	methods = {
		listSearch: {
			async getTemplates(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const results = await listActiveTemplates.call(this, filter);
				return { results };
			},
			async getCategories(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const results = await listCategories.call(this, filter);
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
				const templateId = useTemplate
					? extractTemplateId(this.getNodeParameter('templateId'))
					: undefined;
				const useCategory = !useTemplate && (this.getNodeParameter('useCategory') as boolean);
				const categoryId = useCategory
					? extractCategoryId(this.getNodeParameter('categoryId'))
					: undefined;
				const waitForRealData = this.getNodeParameter('waitForRealData') as boolean;

				const body: JsonObject = {
					name: `n8n-trigger-${this.getWorkflow().id}`,
					url: webhookUrl,
					events: [event],
					is_active: true,
				};

				if (templateId) {
					body.template_id = templateId;
				}
				if (categoryId) {
					body.category_id = categoryId;
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

				if (!waitForRealData) {
					try {
						await triggerTestWebhook.call(this, webhookId, templateId, categoryId);
					} catch {
						// Test delivery is best-effort; live events still work once n8n is reachable.
					}
				}

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
		const decision = (bodyData as Record<string, unknown>).decision ?? bodyData;

		if (useTemplate) {
			const templateId = extractTemplateId(this.getNodeParameter('templateId'));
			const decisionTemplateId = (decision as Record<string, unknown>).template_id;

			if (templateId && decisionTemplateId !== templateId) {
				return {
					workflowData: [],
				};
			}
		} else {
			const useCategory = this.getNodeParameter('useCategory') as boolean;

			if (useCategory) {
				const categoryId = extractCategoryId(this.getNodeParameter('categoryId'));
				const decisionCategoryId = (decision as Record<string, unknown>).category_id;

				if (categoryId && decisionCategoryId !== categoryId) {
					return {
						workflowData: [],
					};
				}
			}
		}

		return {
			workflowData: [this.helpers.returnJsonArray(bodyData)],
		};
	}
}
