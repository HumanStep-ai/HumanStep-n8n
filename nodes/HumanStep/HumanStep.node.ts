import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	ResourceMapperFields,
	FieldType,
	JsonObject,
	NodeOperationError,
} from 'n8n-workflow';
import { extractTemplateId, humanStepApiRequest, listActiveTemplates, waitForDecision } from './GenericFunctions';

const CREATE_DECISION_OPERATIONS = ['createDecision', 'createDecisionAndWait'];

// Map HumanStep field types to n8n field types
function mapFieldType(hsType: string): FieldType {
	switch (hsType) {
		case 'text':
		case 'textarea':
		case 'richtext':
			return 'string';
		case 'number':
		case 'decimal':
		case 'currency':
			return 'number';
		case 'toggle':
			return 'boolean';
		case 'date':
		case 'datetime':
			return 'dateTime';
		case 'select':
		case 'radio':
			return 'options';
		case 'multiselect':
		case 'checkbox_group':
			return 'array';
		case 'json':
		case 'key_value':
		case 'variant_selector':
			return 'object';
		case 'url':
		case 'email':
		case 'phone':
		case 'image':
		case 'file':
			return 'string';
		default:
			return 'string';
	}
}

function buildVariantSelectorDescription(field: any): string | undefined {
	if (field.type !== 'variant_selector') {
		return field.description || field.helpText || undefined;
	}

	const descriptionParts = [field.description || field.helpText].filter(Boolean);
	const details: string[] = [];
	const minVariants = field.minVariants ?? field.min_variants;
	const maxVariants = field.maxVariants ?? field.max_variants;
	const selectionMode = field.selectionMode ?? field.selection_mode;
	const subFields = field.subFields ?? field.sub_fields;

	if (minVariants !== undefined || maxVariants !== undefined) {
		details.push(
			`variants: ${minVariants ?? '?'}-${maxVariants ?? '?'}`
		);
	}
	if (selectionMode) {
		details.push(`selection: ${selectionMode}`);
	}
	if (Array.isArray(subFields) && subFields.length > 0) {
		const subFieldKeys = subFields
			.map((subField: any) => subField.key || subField.id)
			.filter(Boolean)
			.join(', ');
		if (subFieldKeys) {
			details.push(`sub-fields: ${subFieldKeys}`);
		}
	}

	details.push('Expected object: {"variants":[{...}],"selected":0}');

	return [...descriptionParts, details.join('; ')].filter(Boolean).join(' ');
}

function parsePayloadJson(value: unknown): JsonObject {
	if (value === undefined || value === null || value === '') {
		return {};
	}
	if (typeof value === 'string') {
		return JSON.parse(value) as JsonObject;
	}
	if (typeof value === 'object' && !Array.isArray(value)) {
		return value as JsonObject;
	}
	return {};
}

function getResponseDecisionId(response: JsonObject): string | undefined {
	const decision = (response.decision ?? response) as Record<string, unknown>;
	return typeof decision.id === 'string' ? decision.id : undefined;
}

function buildDecisionRequestBody(
	executeFunctions: IExecuteFunctions,
	itemIndex: number,
): JsonObject {
	const useTemplate = executeFunctions.getNodeParameter('useTemplate', itemIndex) as boolean;

	if (useTemplate) {
		const templateId = extractTemplateId(executeFunctions.getNodeParameter('templateId', itemIndex));
		if (!templateId) {
			throw new NodeOperationError(
				executeFunctions.getNode(),
				'A HumanStep review template is required',
				{ itemIndex },
			);
		}
		const fieldsData = executeFunctions.getNodeParameter('fields', itemIndex, {}) as {
			value?: Record<string, unknown>;
		};
		const additionalOptions = executeFunctions.getNodeParameter(
			'additionalOptions',
			itemIndex,
			{},
		) as Record<string, unknown>;
		const payload: JsonObject = {};

		if (fieldsData.value && typeof fieldsData.value === 'object') {
			for (const [key, value] of Object.entries(fieldsData.value)) {
				if (value !== undefined && value !== null && value !== '') {
					payload[key] = value as JsonObject[string];
				}
			}
		}
		if (additionalOptions.priority) {
			payload.priority = additionalOptions.priority as string;
		}
		if (additionalOptions.externalId) {
			payload.external_id = additionalOptions.externalId as string;
		}

		const requestBody: JsonObject = {
			template_id: templateId,
			payload,
		};

		if (additionalOptions.callbackUrl) {
			requestBody.callback_url = additionalOptions.callbackUrl as string;
		}

		return requestBody;
	}

	const questionTitle = executeFunctions.getNodeParameter('questionTitle', itemIndex) as string;
	const options = executeFunctions.getNodeParameter('options', itemIndex, {}) as Record<string, unknown>;
	const requestBody: JsonObject = {
		title: questionTitle,
		payload: parsePayloadJson(options.payloadJson),
	};

	if (options.callbackUrl) {
		requestBody.callback_url = options.callbackUrl as string;
	}

	return requestBody;
}

export class HumanStep implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HumanStep',
		name: 'humanStep',
		icon: 'file:humanstep.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with the HumanStep API',
		defaults: {
			name: 'HumanStep',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'humanStepApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Validation',
						value: 'validation',
					},
				],
				default: 'validation',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['validation'],
					},
				},
				options: [
					{
						name: 'Create Decision',
						value: 'createDecision',
						description: 'Create a decision request and continue immediately',
						action: 'Create a decision',
					},
					{
						name: 'Create Decision and Wait',
						value: 'createDecisionAndWait',
						description: 'Create a decision request and wait until it is resolved',
						action: 'Create a decision and wait',
					},
				],
				default: 'createDecision',
			},
			{
				displayName: 'Use Template',
				name: 'useTemplate',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
					},
				},
				description: 'Whether to use a predefined template for this validation',
			},
			{
				displayName: 'Question Title',
				name: 'questionTitle',
				type: 'string',
				required: true,
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
						useTemplate: [false],
					},
				},
				default: '',
				placeholder: 'e.g. Approve this request?',
				description: 'The question shown in HumanStep for this validation (boolean response)',
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
						useTemplate: [false],
					},
				},
				options: [
					{
						displayName: 'Payload',
						name: 'payloadJson',
						type: 'json',
						default: '{}',
						description: 'JSON payload to include with the validation request',
					},
					{
						displayName: 'Callback URL',
						name: 'callbackUrl',
						type: 'string',
						default: '',
						description:
							'Optional URL HumanStep should call when this decision is resolved. Use the trigger node for managed n8n webhooks.',
					},
				],
			},
			{
				displayName: 'Review Template',
				name: 'templateId',
				type: 'resourceLocator',
				default: { mode: 'list', value: '' },
				required: true,
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
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
			},
			{
				displayName: 'Fields',
				name: 'fields',
				type: 'resourceMapper',
				noDataExpression: true,
				default: {
					mappingMode: 'defineBelow',
					value: null,
				},
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
						useTemplate: [true],
					},
				},
				typeOptions: {
					loadOptionsDependsOn: ['templateId.value'],
					resourceMapper: {
						resourceMapperMethod: 'getTemplateFieldsMapping',
						mode: 'add',
						fieldWords: {
							singular: 'field',
							plural: 'fields',
						},
						addAllFields: true,
						multiKeyMatch: false,
						noFieldsError: 'No fields found. Please select a template first.',
						supportAutoMap: false,
					},
				},
			},
			{
				displayName: 'Additional Options',
				name: 'additionalOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
						useTemplate: [true],
					},
				},
				options: [
					{
						displayName: 'Priority',
						name: 'priority',
						type: 'options',
						options: [
							{ name: 'Low', value: 'low' },
							{ name: 'Normal', value: 'normal' },
							{ name: 'High', value: 'high' },
							{ name: 'Urgent', value: 'urgent' },
						],
						default: 'normal',
						description: 'Priority level for this validation request',
					},
					{
						displayName: 'External ID',
						name: 'externalId',
						type: 'string',
						default: '',
						description: 'Your own reference ID to track this request',
					},
					{
						displayName: 'Callback URL',
						name: 'callbackUrl',
						type: 'string',
						default: '',
						description:
							'Optional URL HumanStep should call when this decision is resolved. Use the trigger node for managed n8n webhooks.',
					},
				],
			},
			{
				displayName: 'Wait Options',
				name: 'waitOptions',
				type: 'collection',
				placeholder: 'Add Wait Option',
				default: {},
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: ['createDecisionAndWait'],
					},
				},
				options: [
					{
						displayName: 'Poll Interval (Seconds)',
						name: 'pollIntervalSeconds',
						type: 'number',
						default: 2,
						typeOptions: {
							minValue: 0.5,
						},
						description: 'How often to check HumanStep for the resolved decision',
					},
					{
						displayName: 'Timeout (Minutes)',
						name: 'timeoutMinutes',
						type: 'number',
						default: 5,
						typeOptions: {
							minValue: 1,
						},
						description: 'Maximum time to wait before failing the node',
					},
				],
			},
		],
	};

	methods = {
		listSearch: {
			async getTemplates(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
				const results = await listActiveTemplates.call(this, filter);
				return { results };
			},
		},
		loadOptions: {
			async getTemplateFields(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const templateIdParam = this.getCurrentNodeParameter('templateId') as any;
				
				let templateId: string | undefined;
				if (typeof templateIdParam === 'string') {
					templateId = templateIdParam;
				} else if (templateIdParam && typeof templateIdParam === 'object') {
					if (typeof templateIdParam.value === 'string') {
						templateId = templateIdParam.value;
					}
				}
				
				if (!templateId || templateId.trim() === '') {
					return [];
				}

				try {
					const response = await humanStepApiRequest.call(this, 'GET', `/templates/${templateId}`);
					const fields = response.fields_schema || response.fieldsSchema || [];
					
					if (!Array.isArray(fields) || fields.length === 0) {
						return [];
					}

					return fields.map((field: any) => {
						const displayName = field.label || field.key || field.id;
						const metadata: string[] = [];
						
						if (field.type) {
							metadata.push(field.type);
						}
						if (field.required) {
							metadata.push('required');
						}
						
						const label = metadata.length > 0 
							? `${displayName} (${metadata.join(', ')})` 
							: displayName;

						return {
							name: label,
							value: field.key || field.id,
							description: field.description || field.helpText || undefined,
						};
					});
				} catch {
					return [];
				}
			},
		},
		resourceMapping: {
			async getTemplateFieldsMapping(this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
				const templateIdParam = this.getCurrentNodeParameter('templateId') as any;

				let templateId: string | undefined;
				if (typeof templateIdParam === 'string') {
					templateId = templateIdParam;
				} else if (templateIdParam && typeof templateIdParam === 'object') {
					if (typeof templateIdParam.value === 'string') {
						templateId = templateIdParam.value;
					}
				}

				if (!templateId || templateId.trim() === '') {
					return { fields: [] };
				}

				try {
					const response = await humanStepApiRequest.call(this, 'GET', `/templates/${templateId}`);
					const schemaFields = response.fields_schema || response.fieldsSchema || [];

					if (!Array.isArray(schemaFields) || schemaFields.length === 0) {
						return { fields: [] };
					}

					const fields = schemaFields.map((field: any) => {
						const fieldId = field.key || field.id;
						const displayName = field.label || field.key || field.id;
						const fieldType = field.type || 'text';
						const n8nType = mapFieldType(fieldType);

						let options: Array<{ name: string; value: string }> | undefined;
						if (field.options && Array.isArray(field.options)) {
							options = field.options.map((opt: any) => ({
								name: opt.label || opt.value || opt,
								value: opt.value || opt,
							}));
						}

						return {
							id: fieldId,
							displayName: `${displayName} (${fieldType})`,
							description: buildVariantSelectorDescription(field),
							required: field.required || false,
							defaultMatch: false,
							canBeUsedToMatch: false,
							display: true,
							type: n8nType,
							options,
						};
					});

					return { fields };
				} catch {
					return { fields: [] };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'validation') {
					if (CREATE_DECISION_OPERATIONS.includes(operation)) {
						const requestBody = buildDecisionRequestBody(this, i);
						const responseData = await humanStepApiRequest.call(this, 'POST', '/decisions', requestBody);
						let outputData = responseData;

						if (operation === 'createDecisionAndWait') {
							const decisionId = getResponseDecisionId(responseData);
							if (!decisionId) {
								throw new NodeOperationError(
									this.getNode(),
									'HumanStep API response did not include a decision id to wait for',
									{ itemIndex: i },
								);
							}
							const waitOptions = this.getNodeParameter('waitOptions', i, {}) as Record<string, number>;
							outputData = await waitForDecision.call(this, decisionId, {
								pollMs: (waitOptions.pollIntervalSeconds ?? 2) * 1000,
								timeoutMs: (waitOptions.timeoutMinutes ?? 5) * 60 * 1000,
							});
						}

						returnData.push({
							json: outputData,
							pairedItem: { item: i },
						});
					}
				}
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({ json: { error: (error as Error).message } });
					continue;
				}
				throw error;
			}
		}

		return [returnData];
	}
}
