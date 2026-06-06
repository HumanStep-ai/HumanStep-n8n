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
} from 'n8n-workflow';
import { humanStepApiRequest, listActiveTemplates } from './GenericFunctions';

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
						description: 'Create a decision request for human review in HumanStep',
						action: 'Create a decision',
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
						operation: ['createDecision'],
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
						operation: ['createDecision'],
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
						operation: ['createDecision'],
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
						operation: ['createDecision'],
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
						operation: ['createDecision'],
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
						operation: ['createDecision'],
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
							value: field.id || field.key,
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
						const fieldId = field.id || field.key;
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
					if (operation === 'createDecision') {
						const useTemplate = this.getNodeParameter('useTemplate', i) as boolean;
						let requestBody: any = {};

						if (useTemplate) {
							// Using a template
							const templateIdParam = this.getNodeParameter('templateId', i) as any;
							const templateId = templateIdParam?.value;

							// Get payload from resource mapper fields
							const fieldsData = this.getNodeParameter('fields', i, {}) as any;
							const payload: { [key: string]: any } = {};
							
							// resourceMapper returns { mappingMode: string, value: { ... } }
							if (fieldsData.value && typeof fieldsData.value === 'object') {
								for (const [key, value] of Object.entries(fieldsData.value)) {
									if (value !== undefined && value !== null && value !== '') {
										payload[key] = value;
									}
								}
							}

							// Get additional options
							const additionalOptions = this.getNodeParameter('additionalOptions', i, {}) as any;

							requestBody = {
								template_id: templateId,
								payload,
							};

							// Add optional fields
							if (additionalOptions.priority) {
								requestBody.priority = additionalOptions.priority;
							}
							if (additionalOptions.externalId) {
								requestBody.external_id = additionalOptions.externalId;
							}
						} else {
							// Simple boolean validation without template
							const questionTitle = this.getNodeParameter('questionTitle', i) as string;
							const options = this.getNodeParameter('options', i) as any;
							
							let payload = {};
							if (options.payloadJson) {
								try {
									payload = typeof options.payloadJson === 'string' 
										? JSON.parse(options.payloadJson) 
										: options.payloadJson;
								} catch (e) {
									// Keep empty object if JSON parsing fails
								}
							}

							requestBody = {
								title: questionTitle,
								payload,
							};
						}

						const responseData = await humanStepApiRequest.call(this, 'POST', '/decisions', requestBody);

						returnData.push({
							json: responseData,
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
