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
const VARIANT_FIELD_PREFIX = '__humanstepVariant__';
const DEFAULT_VARIANT_GROUPS_TO_SHOW = 2;

type VariantSelectionMode = 'single' | 'multiple';

interface VariantFieldReference {
	parentKey: string;
	variantIndex: number;
	subFieldKey: string;
}

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

function isNonEmptyValue(value: unknown): boolean {
	return value !== undefined && value !== null && value !== '';
}

function getFieldKey(field: any): string {
	return field.key || field.id;
}

function getFieldLabel(field: any): string {
	return field.label || field.key || field.id;
}

function getFieldSubFields(field: any): any[] {
	const subFields = field.subFields ?? field.sub_fields;
	return Array.isArray(subFields) ? subFields : [];
}

function getFieldOptions(field: any): Array<{ name: string; value: string }> | undefined {
	const rawOptions = Array.isArray(field.options)
		? field.options
		: Array.isArray(field.statusOptions)
			? field.statusOptions
			: Array.isArray(field.status_options)
				? field.status_options
				: undefined;

	if (!rawOptions) {
		return undefined;
	}

	return rawOptions.map((opt: any) => ({
		name: opt.label || opt.value || opt,
		value: opt.value || opt,
	}));
}

function encodeVariantFieldId(parentKey: string, variantIndex: number, subFieldKey: string): string {
	return [
		VARIANT_FIELD_PREFIX,
		encodeURIComponent(parentKey),
		String(variantIndex),
		encodeURIComponent(subFieldKey),
	].join('::');
}

function decodeVariantFieldId(fieldId: string): VariantFieldReference | undefined {
	const [prefix, encodedParentKey, variantIndexValue, encodedSubFieldKey] = fieldId.split('::');
	if (
		prefix !== VARIANT_FIELD_PREFIX ||
		!encodedParentKey ||
		!encodedSubFieldKey ||
		variantIndexValue === undefined
	) {
		return undefined;
	}

	const variantIndex = Number(variantIndexValue);
	if (!Number.isInteger(variantIndex) || variantIndex < 0) {
		return undefined;
	}

	return {
		parentKey: decodeURIComponent(encodedParentKey),
		variantIndex,
		subFieldKey: decodeURIComponent(encodedSubFieldKey),
	};
}

function getVariantBounds(field: any): { minVariants: number; maxVariants?: number } {
	const rawMin = Number(field.minVariants ?? field.min_variants);
	const rawMax = Number(field.maxVariants ?? field.max_variants);
	const minVariants = Number.isFinite(rawMin) && rawMin > 0 ? Math.floor(rawMin) : 1;
	const maxVariants = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : undefined;

	return { minVariants, maxVariants };
}

function getVariantGroupCount(field: any, requestedCount: number): number {
	const { minVariants, maxVariants } = getVariantBounds(field);
	const normalizedRequested = Number.isFinite(requestedCount) && requestedCount > 0
		? Math.floor(requestedCount)
		: DEFAULT_VARIANT_GROUPS_TO_SHOW;
	const minAdjusted = Math.max(normalizedRequested, minVariants);

	return maxVariants ? Math.min(minAdjusted, maxVariants) : minAdjusted;
}

function getVariantSelectionMode(field: any): VariantSelectionMode {
	return field.selectionMode === 'multiple' || field.selection_mode === 'multiple' ? 'multiple' : 'single';
}

function buildVariantSelectorDescription(field: any): string | undefined {
	if (field.type !== 'variant_selector') {
		return field.description || field.helpText || undefined;
	}

	const descriptionParts = [field.description || field.helpText].filter(Boolean);
	const details: string[] = [];
	const { minVariants, maxVariants } = getVariantBounds(field);
	const selectionMode = getVariantSelectionMode(field);
	const subFields = getFieldSubFields(field);

	details.push(`variants: ${minVariants}-${maxVariants ?? '?'}`);
	if (selectionMode) {
		details.push(`selection: ${selectionMode}`);
	}
	if (subFields.length > 0) {
		const subFieldKeys = subFields
			.map((subField: any) => getFieldKey(subField))
			.filter(Boolean)
			.join(', ');
		if (subFieldKeys) {
			details.push(`sub-fields: ${subFieldKeys}`);
		}
	}

	details.push('Expected object: {"variants":[{...}],"selected":0}');

	return [...descriptionParts, details.join('; ')].filter(Boolean).join(' ');
}

function createMapperField(field: any, id?: string, displayName?: string, description?: string) {
	const fieldType = field.type || 'text';

	return {
		id: id ?? getFieldKey(field),
		displayName: displayName ?? `${getFieldLabel(field)} (${fieldType})`,
		description: description ?? buildVariantSelectorDescription(field),
		required: field.required || false,
		defaultMatch: false,
		canBeUsedToMatch: false,
		display: true,
		type: mapFieldType(fieldType),
		options: getFieldOptions(field),
	};
}

function expandVariantSelectorFields(field: any, requestedCount: number) {
	const parentKey = getFieldKey(field);
	const parentLabel = getFieldLabel(field);
	const subFields = getFieldSubFields(field);
	const variantCount = getVariantGroupCount(field, requestedCount);

	if (!parentKey || subFields.length === 0) {
		return [createMapperField(field)];
	}

	const fields = [];
	for (let variantIndex = 0; variantIndex < variantCount; variantIndex++) {
		const variantLabel = String.fromCharCode(65 + variantIndex);
		for (const subField of subFields) {
			const subFieldKey = getFieldKey(subField);
			if (!subFieldKey) {
				continue;
			}

			fields.push(createMapperField(
				subField,
				encodeVariantFieldId(parentKey, variantIndex, subFieldKey),
				`[${variantLabel}] ${getFieldLabel(subField)}`,
				[
					`${parentLabel} / Variation ${variantLabel} / ${getFieldLabel(subField)}`,
					subField.description || subField.helpText,
				].filter(Boolean).join(' '),
			));
		}
	}

	return fields;
}

function buildVariantPayload(fieldsValue: Record<string, unknown>, schemaFields: any[]): JsonObject {
	const payload: JsonObject = {};
	const variantFields = new Map<string, any>();
	const variantValues = new Map<string, Map<number, Record<string, unknown>>>();

	for (const field of schemaFields) {
		const fieldKey = getFieldKey(field);
		if (fieldKey && field.type === 'variant_selector') {
			variantFields.set(fieldKey, field);
		}
	}

	for (const [key, value] of Object.entries(fieldsValue)) {
		if (!isNonEmptyValue(value)) {
			continue;
		}

		const variantReference = decodeVariantFieldId(key);
		if (!variantReference) {
			payload[key] = value as JsonObject[string];
			continue;
		}

		if (!variantFields.has(variantReference.parentKey)) {
			continue;
		}

		let variants = variantValues.get(variantReference.parentKey);
		if (!variants) {
			variants = new Map<number, Record<string, unknown>>();
			variantValues.set(variantReference.parentKey, variants);
		}

		let variant = variants.get(variantReference.variantIndex);
		if (!variant) {
			variant = {};
			variants.set(variantReference.variantIndex, variant);
		}

		variant[variantReference.subFieldKey] = value;
	}

	for (const [parentKey, variantsByIndex] of variantValues.entries()) {
		const field = variantFields.get(parentKey);
		const variants = Array.from(variantsByIndex.entries())
			.sort(([leftIndex], [rightIndex]) => leftIndex - rightIndex)
			.map(([, variant]) => variant);

		if (variants.length === 0) {
			continue;
		}

		payload[parentKey] = {
			variants,
			selected: getVariantSelectionMode(field) === 'multiple' ? [0] : 0,
		} as JsonObject[string];
	}

	return payload;
}

function fieldsValueNeedsVariantSchema(fieldsValue: Record<string, unknown>): boolean {
	return Object.keys(fieldsValue).some((key) => key.startsWith(VARIANT_FIELD_PREFIX));
}

function getMappedFieldValues(executeFunctions: IExecuteFunctions, itemIndex: number): Record<string, unknown> {
	// Reading `fields` directly can hang in execute on some n8n versions because it
	// re-triggers the resource mapper loader. Dot notation avoids that deadlock.
	const directValue = executeFunctions.getNodeParameter('fields.value', itemIndex, {}) as Record<
		string,
		unknown
	>;
	if (directValue && typeof directValue === 'object' && !Array.isArray(directValue)) {
		return directValue;
	}
	return {};
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

async function buildDecisionRequestBody(
	executeFunctions: IExecuteFunctions,
	itemIndex: number,
): Promise<JsonObject> {
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
		const fieldsValue = getMappedFieldValues(executeFunctions, itemIndex);
		const priority = executeFunctions.getNodeParameter(
			'additionalOptions.priority',
			itemIndex,
			'',
		) as string;
		const externalId = executeFunctions.getNodeParameter(
			'additionalOptions.externalId',
			itemIndex,
			'',
		) as string;
		const callbackUrl = executeFunctions.getNodeParameter(
			'additionalOptions.callbackUrl',
			itemIndex,
			'',
		) as string;
		let payload: JsonObject = {};

		if (Object.keys(fieldsValue).length > 0) {
			if (fieldsValueNeedsVariantSchema(fieldsValue)) {
				const response = await humanStepApiRequest.call(
					executeFunctions,
					'GET',
					`/templates/${templateId}`,
				);
				const schemaFields = response.fields_schema || response.fieldsSchema || [];
				payload = Array.isArray(schemaFields)
					? buildVariantPayload(fieldsValue, schemaFields)
					: {};
			} else {
				for (const [key, value] of Object.entries(fieldsValue)) {
					if (isNonEmptyValue(value)) {
						payload[key] = value as JsonObject[string];
					}
				}
			}
		}
		if (priority) {
			payload.priority = priority;
		}
		if (externalId) {
			payload.external_id = externalId;
		}

		const requestBody: JsonObject = {
			template_id: templateId,
			payload,
		};

		if (callbackUrl) {
			requestBody.callback_url = callbackUrl;
		}

		return requestBody;
	}

	const questionTitle = executeFunctions.getNodeParameter('questionTitle', itemIndex) as string;
	const payloadJson = executeFunctions.getNodeParameter('options.payloadJson', itemIndex, '{}');
	const callbackUrl = executeFunctions.getNodeParameter('options.callbackUrl', itemIndex, '') as string;
	let payload: JsonObject = {};
	try {
		payload = parsePayloadJson(payloadJson);
	} catch {
		throw new NodeOperationError(executeFunctions.getNode(), 'Payload JSON is invalid', {
			itemIndex,
		});
	}
	const requestBody: JsonObject = {
		title: questionTitle,
		payload,
	};

	if (callbackUrl) {
		requestBody.callback_url = callbackUrl;
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
				displayName: 'Variant Fields',
				name: 'variantInputMode',
				type: 'options',
				default: 'expanded',
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
						useTemplate: [true],
					},
				},
				options: [
					{
						name: 'One Field per Variation',
						value: 'expanded',
						description: 'Split each variant into separate mapper fields (recommended)',
					},
					{
						name: 'Single JSON Object',
						value: 'raw',
						description: 'Keep variant selectors as one object field for advanced JSON input',
					},
				],
				description:
					'Only used when the selected template includes variant selector fields. Ignored for templates without variants.',
			},
			{
				displayName: 'Variations to Show',
				name: 'variantGroupsToShow',
				type: 'number',
				default: DEFAULT_VARIANT_GROUPS_TO_SHOW,
				displayOptions: {
					show: {
						resource: ['validation'],
						operation: CREATE_DECISION_OPERATIONS,
						useTemplate: [true],
						variantInputMode: ['expanded'],
					},
				},
				typeOptions: {
					minValue: 1,
				},
				description:
					'Only used for templates with variant selectors when Variant Fields is set to One Field per Variation. HumanStep clamps this to the template minimum and maximum.',
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
						displayName:
							'The decision is created immediately. This node then keeps running until it is resolved in HumanStep or the timeout is reached.',
						name: 'waitNotice',
						type: 'notice',
						default: '',
					},
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

					const variantInputMode = this.getCurrentNodeParameter('variantInputMode') as string | undefined;
					const variantGroupsToShowParam = this.getCurrentNodeParameter('variantGroupsToShow') as number | undefined;
					const variantGroupsToShow = Number(variantGroupsToShowParam ?? DEFAULT_VARIANT_GROUPS_TO_SHOW);
					const fields = schemaFields.flatMap((field: any) => {
						if (field.type === 'variant_selector' && variantInputMode !== 'raw') {
							return expandVariantSelectorFields(field, variantGroupsToShow);
						}

						return [createMapperField(field)];
					});

					return { fields };
				} catch {
					return { fields: [] };
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		let items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;

		// Allow manual step execution without upstream input (common in the n8n editor).
		if (items.length === 0) {
			items = [{ json: {}, pairedItem: { item: 0 } }];
		}

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'validation') {
					if (CREATE_DECISION_OPERATIONS.includes(operation)) {
						const requestBody = await buildDecisionRequestBody(this, i);
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
							const pollIntervalSeconds = this.getNodeParameter(
								'waitOptions.pollIntervalSeconds',
								i,
								2,
							) as number;
							const timeoutMinutes = this.getNodeParameter(
								'waitOptions.timeoutMinutes',
								i,
								5,
							) as number;
							const resolveUrl =
								typeof responseData.resolve_url === 'string' ? responseData.resolve_url : undefined;
							outputData = await waitForDecision.call(this, decisionId, {
								pollMs: (pollIntervalSeconds ?? 2) * 1000,
								timeoutMs: (timeoutMinutes ?? 5) * 60 * 1000,
								resolveUrl,
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
