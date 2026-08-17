import React from 'react';
import { Modal, Form, Input, AutoComplete, Button, Select, message, Typography, Checkbox, InputNumber } from 'antd';
import { RightOutlined, DownOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores';
import { LazyJsonEditor as JsonEditor } from '@/components/common/lazyMonaco';
import type { I18nPrefix } from '@/components/common/ProviderCard/types';
import { hasCompleteModelLimitPair } from '@/utils/modelLimits';

const { Text } = Typography;

// Context limit options with display labels
const CONTEXT_LIMIT_OPTIONS = [
  { value: '4096', label: '4K' },
  { value: '8192', label: '8K' },
  { value: '16384', label: '16K' },
  { value: '32768', label: '32K' },
  { value: '65536', label: '64K' },
  { value: '128000', label: '128K' },
  { value: '200000', label: '200K' },
  { value: '256000', label: '256K' },
  { value: '1000000', label: '1M' },
  { value: '2000000', label: '2M' },
];

// Output limit options with display labels
const OUTPUT_LIMIT_OPTIONS = [
  { value: '2048', label: '2K' },
  { value: '4096', label: '4K' },
  { value: '8192', label: '8K' },
  { value: '16384', label: '16K' },
  { value: '32768', label: '32K' },
  { value: '65536', label: '64K' },
];

// Modality options for input/output
const MODALITY_OPTIONS = [
  { value: 'text', label: 'Text' },
  { value: 'image', label: 'Image' },
  { value: 'pdf', label: 'PDF' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
];

/**
 * Form values for model form
 */
export interface ModelFormValues {
  id: string;
  name: string;
  api?: string;
  contextLimit?: number;
  outputLimit?: number;
  options?: string;
  variants?: string;
  modalities?: string;
  inputTypes?: string;
  reasoning?: boolean;
  thinkingLevelMap?: string;
  compat?: string;
  attachment?: boolean;
  tool_call?: boolean;
  temperature?: boolean;
  costInput?: number;
  costOutput?: number;
  costCacheRead?: number;
  costCacheWrite?: number;
}

interface ModelFormModalProps {
  open: boolean;

  /** Whether this is an edit operation */
  isEdit?: boolean;
  /** Initial form values */
  initialValues?: Partial<ModelFormValues>;

  /** Existing model IDs for duplicate check (only used when !isEdit) */
  existingIds?: string[];

  /** Whether to show options field (settings page: true, Pi model form: false) */
  showOptions?: boolean;
  /** Whether to show variants field (Pi model form only) */
  showVariants?: boolean;
  /** Whether to show modalities field (Pi model form only) */
  showModalities?: boolean;
  /** Whether to show input types as a standalone model field (Pi only) */
  showInputTypes?: boolean;
  /** Whether to show a per-model API override field (Pi only) */
  showApi?: boolean;
  /** API options for the per-model API override field */
  apiOptions?: Array<{ value: string; label: string }>;
  /** Whether to show reasoning as a standalone model capability (Pi only) */
  showReasoning?: boolean;
  /** Whether to show Pi thinking level map JSON */
  showThinkingLevelMap?: boolean;
  /** Whether to show Pi model compatibility JSON */
  showCompat?: boolean;
  /** Whether to show model cost fields */
  showCost?: boolean;
  /** Whether limit fields are required (settings page: true, Pi model form: false) */
  limitRequired?: boolean;
  /** Whether context and output limits must both be filled or both be empty */
  requireCompleteLimitPair?: boolean;
  /** Whether name field is required (settings page: true, Pi model form: false) */
  nameRequired?: boolean;

  /** Modal width override */
  width?: number;

  /** Callbacks */
  onCancel: () => void;
  onSuccess: (values: ModelFormValues) => void;
  /** Custom duplicate ID error handler */
  onDuplicateId?: (id: string) => void;

  /** i18n prefix for translations */
  i18nPrefix?: I18nPrefix;
}

/**
 * A reusable model form modal component
 */
const ModelFormModal: React.FC<ModelFormModalProps> = ({
  open,
  isEdit = false,
  initialValues,
  existingIds = [],
  showOptions = true,
  showVariants = false,
  showModalities = false,
  showInputTypes = false,
  showApi = false,
  apiOptions = [],
  showReasoning = false,
  showThinkingLevelMap = false,
  showCompat = false,
  showCost = false,
  limitRequired = true,
  requireCompleteLimitPair = false,
  nameRequired = true,
  width,
  onCancel,
  onSuccess,
  onDuplicateId,
  i18nPrefix = 'settings',
}) => {
  const { t } = useTranslation();
  const language = useAppStore((state) => state.language);
  const [form] = Form.useForm();
  const [loading, setLoading] = React.useState(false);
  const [jsonOptions, setJsonOptions] = React.useState<unknown>({});
  const [jsonValid, setJsonValid] = React.useState(true);
  const [jsonVariants, setJsonVariants] = React.useState<unknown>({});
  const [variantsValid, setVariantsValid] = React.useState(true);
  const [jsonThinkingLevelMap, setJsonThinkingLevelMap] = React.useState<unknown>({});
  const [thinkingLevelMapValid, setThinkingLevelMapValid] = React.useState(true);
  const [jsonCompat, setJsonCompat] = React.useState<unknown>({});
  const [compatValid, setCompatValid] = React.useState(true);
  const [inputModalities, setInputModalities] = React.useState<string[]>([]);
  const [outputModalities, setOutputModalities] = React.useState<string[]>([]);
  const [advancedExpanded, setAdvancedExpanded] = React.useState(false);
  const [capReasoning, setCapReasoning] = React.useState(true);
  const [capAttachment, setCapAttachment] = React.useState(false);
  const [capToolCall, setCapToolCall] = React.useState(true);
  const [capTemperature, setCapTemperature] = React.useState(true);
  const apiValue = Form.useWatch('api', form);
  const costInputValue = Form.useWatch('costInput', form);
  const costOutputValue = Form.useWatch('costOutput', form);
  const costCacheReadValue = Form.useWatch('costCacheRead', form);
  const costCacheWriteValue = Form.useWatch('costCacheWrite', form);
  const labelCol = { span: language === 'zh-CN' ? 4 : 6 };
  const wrapperCol = { span: 20 };

  // Check if options or variants or modalities has content
  const hasAdvancedContent = React.useMemo(() => {
    const hasOptions = typeof jsonOptions === 'object' && jsonOptions !== null &&
      Object.keys(jsonOptions).length > 0;
    const hasVariants = showVariants &&
      typeof jsonVariants === 'object' && jsonVariants !== null &&
      Object.keys(jsonVariants as object).length > 0;
    const hasModalities = showModalities &&
      (inputModalities.length > 0 || outputModalities.length > 0);
    const hasThinkingLevelMap = showThinkingLevelMap &&
      typeof jsonThinkingLevelMap === 'object' && jsonThinkingLevelMap !== null &&
      Object.keys(jsonThinkingLevelMap as object).length > 0;
    const hasCompat = showCompat &&
      typeof jsonCompat === 'object' && jsonCompat !== null &&
      Object.keys(jsonCompat as object).length > 0;
    const hasApi = showApi && typeof apiValue === 'string' && apiValue.trim() !== '';
    const hasCost = showCost && [
      costInputValue,
      costOutputValue,
      costCacheReadValue,
      costCacheWriteValue,
    ].some((value) => typeof value === 'number');
    return hasOptions || hasVariants || hasModalities || hasThinkingLevelMap || hasCompat || hasApi || hasCost;
  }, [
    jsonOptions,
    jsonVariants,
    jsonThinkingLevelMap,
    jsonCompat,
    apiValue,
    costInputValue,
    costOutputValue,
    costCacheReadValue,
    costCacheWriteValue,
    inputModalities,
    outputModalities,
    showVariants,
    showModalities,
    showThinkingLevelMap,
    showCompat,
    showApi,
    showCost,
  ]);

  React.useEffect(() => {
    if (open) {
      if (initialValues) {
        form.setFieldsValue({
          id: initialValues.id,
          name: initialValues.name,
          api: initialValues.api,
          contextLimit: initialValues.contextLimit,
          outputLimit: initialValues.outputLimit,
          costInput: initialValues.costInput,
          costOutput: initialValues.costOutput,
          costCacheRead: initialValues.costCacheRead,
          costCacheWrite: initialValues.costCacheWrite,
        });
        
        let shouldExpand = false;
        if (typeof initialValues.api === 'string' && initialValues.api.trim() !== '') {
          shouldExpand = true;
        }
        if ([
          initialValues.costInput,
          initialValues.costOutput,
          initialValues.costCacheRead,
          initialValues.costCacheWrite,
        ].some((value) => typeof value === 'number')) {
          shouldExpand = true;
        }
        
        // Parse options JSON
        if (initialValues.options) {
          try {
            const parsed = JSON.parse(initialValues.options);
            setJsonOptions(parsed);
            setJsonValid(true);
            // Auto expand if options has content
            if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
              shouldExpand = true;
            }
          } catch {
            setJsonOptions({});
            setJsonValid(false);
          }
        } else {
          setJsonOptions({});
          setJsonValid(true);
        }
        
        // Parse variants JSON
        if (initialValues.variants) {
          try {
            const parsed = JSON.parse(initialValues.variants);
            setJsonVariants(parsed);
            setVariantsValid(true);
            // Auto expand if variants has content
            if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
              shouldExpand = true;
            }
          } catch {
            setJsonVariants({});
            setVariantsValid(false);
          }
        } else {
          setJsonVariants({});
          setVariantsValid(true);
        }

        // Parse thinking level map JSON
        if (initialValues.thinkingLevelMap) {
          try {
            const parsed = JSON.parse(initialValues.thinkingLevelMap);
            setJsonThinkingLevelMap(parsed);
            setThinkingLevelMapValid(true);
            if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
              shouldExpand = true;
            }
          } catch {
            setJsonThinkingLevelMap({});
            setThinkingLevelMapValid(false);
          }
        } else {
          setJsonThinkingLevelMap({});
          setThinkingLevelMapValid(true);
        }

        // Parse compat JSON
        if (initialValues.compat) {
          try {
            const parsed = JSON.parse(initialValues.compat);
            setJsonCompat(parsed);
            setCompatValid(true);
            if (typeof parsed === 'object' && parsed !== null && Object.keys(parsed).length > 0) {
              shouldExpand = true;
            }
          } catch {
            setJsonCompat({});
            setCompatValid(false);
          }
        } else {
          setJsonCompat({});
          setCompatValid(true);
        }
        
        // Parse modalities JSON
        if (initialValues.modalities) {
          try {
            const parsed = JSON.parse(initialValues.modalities);
            if (parsed && typeof parsed === 'object') {
              if (Array.isArray(parsed.input)) {
                setInputModalities(parsed.input);
              }
              if (Array.isArray(parsed.output)) {
                setOutputModalities(parsed.output);
              }
              // Auto expand if modalities has content
              if ((parsed.input && parsed.input.length > 0) || (parsed.output && parsed.output.length > 0)) {
                shouldExpand = true;
              }
            }
          } catch {
            setInputModalities([]);
            setOutputModalities([]);
          }
        } else {
          setInputModalities(showModalities || showInputTypes ? ['text'] : []);
          setOutputModalities(showModalities ? ['text'] : []);
        }

        if (showInputTypes) {
          if (initialValues.inputTypes !== undefined) {
            try {
              const parsed = JSON.parse(initialValues.inputTypes || '[]');
              setInputModalities(Array.isArray(parsed) ? parsed : []);
            } catch {
              setInputModalities([]);
            }
          } else if (!showModalities) {
            // Text is Pi's baseline input capability. Only an explicit
            // inputTypes value should opt a model out of it.
            setInputModalities(['text']);
          }
        }
        
        setAdvancedExpanded(shouldExpand);

        // Missing capability metadata uses the baseline Pi defaults. Explicit
        // false remains respected for providers that declare a limitation.
        if (showModalities || showReasoning) {
          setCapReasoning(initialValues.reasoning !== undefined ? initialValues.reasoning : true);
        }
        if (showModalities) {
          setCapAttachment(initialValues.attachment !== undefined ? initialValues.attachment : false);
          setCapToolCall(initialValues.tool_call !== undefined ? initialValues.tool_call : false);
          setCapTemperature(initialValues.temperature !== undefined ? initialValues.temperature : false);
        }
      } else {
        form.resetFields();
        // 未手动选择预设的模型默认 256k 上下文
        form.setFieldsValue({ contextLimit: 256000 });
        setJsonOptions({});
        setJsonValid(true);
        setJsonVariants({});
        setVariantsValid(true);
        setJsonThinkingLevelMap({});
        setThinkingLevelMapValid(true);
        setJsonCompat({});
        setCompatValid(true);
        setInputModalities(showModalities || showInputTypes ? ['text'] : []);
        setOutputModalities(showModalities ? ['text'] : []);
        setAdvancedExpanded(true);
        setCapReasoning(true);
        setCapAttachment(false);
        setCapToolCall(true);
        setCapTemperature(true);
      }
    }
  }, [open, initialValues, form]);

  const handleJsonChange = (value: unknown, isValid: boolean) => {
    if (isValid) {
      setJsonOptions(value);
    }
    setJsonValid(isValid);
  };

  const handleVariantsChange = (value: unknown, isValid: boolean) => {
    if (isValid) {
      setJsonVariants(value);
    }
    setVariantsValid(isValid);
  };

  const handleThinkingLevelMapChange = (value: unknown, isValid: boolean) => {
    if (isValid) {
      setJsonThinkingLevelMap(value);
    }
    setThinkingLevelMapValid(isValid);
  };

  const handleCompatChange = (value: unknown, isValid: boolean) => {
    if (isValid) {
      setJsonCompat(value);
    }
    setCompatValid(isValid);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      
      // Validate JSON if showing options
      if (showOptions && !jsonValid) {
        message.error(t('settings.model.invalidJson'));
        return;
      }
      
      // Validate variants JSON if showing variants
      if (showVariants && !variantsValid) {
        message.error(t('piModels.model.invalidVariants'));
        return;
      }

      if (showThinkingLevelMap && !thinkingLevelMapValid) {
        message.error(t(getKey('invalidThinkingLevelMap')));
        return;
      }

      if (showCompat && !compatValid) {
        message.error(t(getKey('invalidCompat')));
        return;
      }
      
      // Validate modalities: either both selected or both empty
      if (showModalities) {
        const hasInput = inputModalities.length > 0;
        const hasOutput = outputModalities.length > 0;
        if (hasInput !== hasOutput) {
          message.error(t('piModels.model.modalitiesBothRequired'));
          return;
        }
      }

      if (requireCompleteLimitPair) {
        if (!hasCompleteModelLimitPair(values.contextLimit, values.outputLimit)) {
          message.error(t('piModels.model.limitsBothRequired'));
          return;
        }
      }

      setLoading(true);

      // Check for duplicate ID when creating
      if (!isEdit && existingIds.includes(values.id)) {
        if (onDuplicateId) {
          onDuplicateId(values.id);
        }
        setLoading(false);
        return;
      }

      const result: ModelFormValues = {
        id: values.id,
        name: values.name,
        api: values.api,
        contextLimit: values.contextLimit,
        outputLimit: values.outputLimit,
      };

      if (showOptions) {
        result.options = JSON.stringify(jsonOptions);
      }
      
      if (showVariants) {
        result.variants = JSON.stringify(jsonVariants);
      }

      if (showThinkingLevelMap) {
        result.thinkingLevelMap = JSON.stringify(jsonThinkingLevelMap);
      }

      if (showCompat) {
        result.compat = JSON.stringify(jsonCompat);
      }

      if (showModalities && inputModalities.length > 0 && outputModalities.length > 0) {
        result.modalities = JSON.stringify({
          input: inputModalities,
          output: outputModalities,
        });
      }

      if (showInputTypes && inputModalities.length > 0) {
        result.inputTypes = JSON.stringify(inputModalities);
      }

      if (showModalities || showReasoning) {
        result.reasoning = capReasoning;
      }

      if (showCost) {
        result.costInput = values.costInput;
        result.costOutput = values.costOutput;
        result.costCacheRead = values.costCacheRead;
        result.costCacheWrite = values.costCacheWrite;
      }

      if (showModalities) {
        result.attachment = capAttachment;
        result.tool_call = capToolCall;
        result.temperature = capTemperature;
      }

      onSuccess(result);
      form.resetFields();
    } catch (error: unknown) {
      console.error('Model form validation error:', error);
      // Form validation errors are already shown by Form
    } finally {
      setLoading(false);
    }
  };

  // Build i18n keys based on prefix
  const getKey = (key: string) => `${i18nPrefix}.model.${key}`;

  const limitRules = limitRequired
    ? [
        { required: true, message: t(getKey('contextLimitPlaceholder')) },
        {
          validator: (_: unknown, value: unknown) => {
            if (value && !/^\d+$/.test(String(value))) {
              return Promise.reject(t('settings.model.invalidNumber'));
            }
            return Promise.resolve();
          },
        },
      ]
    : [
        {
          validator: (_: unknown, value: unknown) => {
            if (value && !/^\d+$/.test(String(value))) {
              return Promise.reject(t('settings.model.invalidNumber'));
            }
            return Promise.resolve();
          },
        },
      ];

  const outputLimitRules = limitRequired
    ? [
        { required: true, message: t(getKey('outputLimitPlaceholder')) },
        {
          validator: (_: unknown, value: unknown) => {
            if (value && !/^\d+$/.test(String(value))) {
              return Promise.reject(t('settings.model.invalidNumber'));
            }
            return Promise.resolve();
          },
        },
      ]
    : [
        {
          validator: (_: unknown, value: unknown) => {
            if (value && !/^\d+$/.test(String(value))) {
              return Promise.reject(t('settings.model.invalidNumber'));
            }
            return Promise.resolve();
          },
        },
      ];

  return (
    <Modal
      title={isEdit ? t(getKey('editModel')) : t(getKey('addModel'))}
      open={open}
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          {t('common.cancel')}
        </Button>,
        <Button key="submit" type="primary" loading={loading} onClick={handleSubmit}>
          {t('common.save')}
        </Button>,
      ]}
      width={width ?? (showOptions ? 700 : 500)}
    >
      <Form
        form={form}
        autoComplete="off"
        layout="horizontal"
        labelCol={labelCol}
        wrapperCol={wrapperCol}
        style={{ marginTop: 24 }}
      >
        <Form.Item
          label={t(getKey('id'))}
          name="id"
          rules={[{ required: true, message: t(getKey('idPlaceholder')) }]}
        >
          <Input
            placeholder={t(getKey('idPlaceholder'))}
            disabled={isEdit}
          />
        </Form.Item>

        <Form.Item
          label={t(getKey('name'))}
          name="name"
          rules={nameRequired ? [{ required: true, message: t(getKey('namePlaceholder')) }] : []}
        >
          <Input placeholder={nameRequired ? t(getKey('namePlaceholder')) : t(getKey('nameOptionalPlaceholder'))} />
        </Form.Item>

        <Form.Item
          label={t(getKey('contextLimit'))}
          name="contextLimit"
          rules={limitRules}
          getValueFromEvent={(val) => {
            const num = parseInt(val, 10);
            return isNaN(num) ? undefined : num;
          }}
        >
          <AutoComplete
            options={CONTEXT_LIMIT_OPTIONS}
            placeholder={t(getKey('contextLimitPlaceholder'))}
            style={{ width: '100%' }}
            filterOption={(inputValue, option) =>
              (option?.label.toLowerCase().includes(inputValue.toLowerCase()) ||
              option?.value.includes(inputValue)) ?? false
            }
          />
        </Form.Item>

        <Form.Item
          label={t(getKey('outputLimit'))}
          name="outputLimit"
          rules={outputLimitRules}
          getValueFromEvent={(val) => {
            const num = parseInt(val, 10);
            return isNaN(num) ? undefined : num;
          }}
        >
          <AutoComplete
            options={OUTPUT_LIMIT_OPTIONS}
            placeholder={t(getKey('outputLimitPlaceholder'))}
            style={{ width: '100%' }}
            filterOption={(inputValue, option) =>
              (option?.label.toLowerCase().includes(inputValue.toLowerCase()) ||
              option?.value.includes(inputValue)) ?? false
            }
          />
        </Form.Item>

        {showInputTypes && (
          <Form.Item
            label={t(getKey('inputTypes'))}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{t(getKey('inputTypesHint'))}</Text>}
          >
            <Select
              mode="multiple"
              allowClear
              placeholder={t(getKey('inputTypesPlaceholder'))}
              options={MODALITY_OPTIONS.filter((option) => option.value === 'text' || option.value === 'image')}
              value={inputModalities}
              onChange={setInputModalities}
            />
          </Form.Item>
        )}

        {showReasoning && !showModalities && (
          <Form.Item
            label={t(getKey('capabilities'))}
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{t(getKey('capabilitiesHint'))}</Text>}
          >
            <Checkbox checked={capReasoning} onChange={(e) => setCapReasoning(e.target.checked)}>
              {t(getKey('reasoning'))}
            </Checkbox>
          </Form.Item>
        )}

        {(showOptions || showVariants || showModalities || showThinkingLevelMap || showCompat || showApi || showCost) && (
          <>
            <div style={{ marginBottom: advancedExpanded ? 16 : 0 }}>
              <Button
                type="link"
                onClick={() => setAdvancedExpanded(!advancedExpanded)}
                style={{ padding: 0, height: 'auto' }}
              >
                {advancedExpanded ? <DownOutlined /> : <RightOutlined />}
                <span style={{ marginLeft: 4 }}>
                  {t('common.advancedSettings')}
                  {hasAdvancedContent && !advancedExpanded && (
                    <span style={{ marginLeft: 4, color: 'var(--ant-color-primary)' }}>*</span>
                  )}
                </span>
              </Button>
            </div>
            {advancedExpanded && (
              <>
                {showModalities && (
                  <>
                    <Form.Item
                      label={t('piModels.model.inputModalities')}
                    >
                      <Select
                        mode="multiple"
                        allowClear
                        placeholder={t('piModels.model.inputModalitiesPlaceholder')}
                        options={MODALITY_OPTIONS}
                        value={inputModalities}
                        onChange={setInputModalities}
                      />
                    </Form.Item>
                    <Form.Item
                      label={t('piModels.model.outputModalities')}
                      extra={<Text type="secondary" style={{ fontSize: 12 }}>{t('piModels.model.modalitiesHint')}</Text>}
                    >
                      <Select
                        mode="multiple"
                        allowClear
                        placeholder={t('piModels.model.outputModalitiesPlaceholder')}
                        options={MODALITY_OPTIONS}
                        value={outputModalities}
                        onChange={setOutputModalities}
                      />
                    </Form.Item>
                    <Form.Item
                      label={t('piModels.model.capabilities')}
                      extra={<Text type="secondary" style={{ fontSize: 12 }}>{t('piModels.model.capabilitiesHint')}</Text>}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                        <Checkbox checked={capReasoning} onChange={(e) => setCapReasoning(e.target.checked)}>
                          {t('piModels.model.reasoning')}
                        </Checkbox>
                        <Checkbox checked={capToolCall} onChange={(e) => setCapToolCall(e.target.checked)}>
                          {t('piModels.model.toolCall')}
                        </Checkbox>
                        <Checkbox checked={capTemperature} onChange={(e) => setCapTemperature(e.target.checked)}>
                          {t('piModels.model.temperatureSetting')}
                        </Checkbox>
                        <Checkbox checked={capAttachment} onChange={(e) => setCapAttachment(e.target.checked)}>
                          {t('piModels.model.attachment')}
                        </Checkbox>
                      </div>
                    </Form.Item>
                  </>
                )}

                {showVariants && (
                  <Form.Item
                    label={t('piModels.model.variants')}
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>{t('piModels.model.variantsHint')}</Text>}
                  >
                    <JsonEditor
                      value={typeof jsonVariants === 'object' && jsonVariants !== null && Object.keys(jsonVariants as object).length === 0 ? undefined : jsonVariants}
                      onChange={handleVariantsChange}
                      mode="text"
                      height={200}
                      resizable
                      placeholder={`{
    "minimal": { "thinkingLevel": "minimal" },
    "low": { "thinkingLevel": "low" },
    "medium": { "thinkingLevel": "medium" },
    "high": { "thinkingLevel": "high" }
}`}
                    />
                  </Form.Item>
                )}

                {showThinkingLevelMap && (
                  <Form.Item
                    label={t(getKey('thinkingLevelMap'))}
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>{t(getKey('thinkingLevelMapHint'))}</Text>}
                  >
                    <JsonEditor
                      value={typeof jsonThinkingLevelMap === 'object' && jsonThinkingLevelMap !== null && Object.keys(jsonThinkingLevelMap as object).length === 0 ? undefined : jsonThinkingLevelMap}
                      onChange={handleThinkingLevelMapChange}
                      mode="text"
                      height={180}
                      resizable
                      placeholder={`{
    "minimal": null,
    "low": null,
    "medium": null,
    "high": "high",
    "xhigh": "xhigh",
    "max": "max"
}`}
                    />
                  </Form.Item>
                )}

                {showCompat && (
                  <Form.Item
                    label={t(getKey('compat'))}
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>{t(getKey('compatHint'))}</Text>}
                  >
                    <JsonEditor
                      value={typeof jsonCompat === 'object' && jsonCompat !== null && Object.keys(jsonCompat as object).length === 0 ? undefined : jsonCompat}
                      onChange={handleCompatChange}
                      mode="text"
                      height={180}
                      resizable
                      placeholder={`{
    "supportsDeveloperRole": false,
    "supportsReasoningEffort": false
}`}
                    />
                  </Form.Item>
                )}

                {showApi && (
                  <Form.Item
                    label={t(getKey('api'))}
                    name="api"
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>{t(getKey('apiHint'))}</Text>}
                  >
                    <Select
                      allowClear
                      showSearch
                      placeholder={t(getKey('apiPlaceholder'))}
                      options={apiOptions}
                    />
                  </Form.Item>
                )}

                {showCost && (
                  <Form.Item
                    label={t(getKey('cost'))}
                    extra={<Text type="secondary" style={{ fontSize: 12 }}>{t(getKey('costHint'))}</Text>}
                  >
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                      <Form.Item name="costInput" label={t(getKey('costInput'))} noStyle>
                        <InputNumber min={0} placeholder="0" style={{ width: '100%' }} addonBefore={t(getKey('costInput'))} />
                      </Form.Item>
                      <Form.Item name="costOutput" label={t(getKey('costOutput'))} noStyle>
                        <InputNumber min={0} placeholder="0" style={{ width: '100%' }} addonBefore={t(getKey('costOutput'))} />
                      </Form.Item>
                      <Form.Item name="costCacheRead" label={t(getKey('costCacheRead'))} noStyle>
                        <InputNumber min={0} placeholder="0" style={{ width: '100%' }} addonBefore={t(getKey('costCacheRead'))} />
                      </Form.Item>
                      <Form.Item name="costCacheWrite" label={t(getKey('costCacheWrite'))} noStyle>
                        <InputNumber min={0} placeholder="0" style={{ width: '100%' }} addonBefore={t(getKey('costCacheWrite'))} />
                      </Form.Item>
                    </div>
                  </Form.Item>
                )}

                {showOptions && (
                  <Form.Item label={t('settings.model.options')}>
                    <JsonEditor
                      value={typeof jsonOptions === 'object' && jsonOptions !== null && Object.keys(jsonOptions).length === 0 ? undefined : jsonOptions}
                      onChange={handleJsonChange}
                      mode="text"
                      height={200}
                      resizable
                      placeholder={`{
    "store": false
}`}
                    />
                  </Form.Item>
                )}
              </>
            )}
          </>
        )}
      </Form>
    </Modal>
  );
};

export default ModelFormModal;
