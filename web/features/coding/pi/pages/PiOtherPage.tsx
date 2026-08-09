import React from 'react';
import { Form, Spin, Typography, message } from 'antd';
import { SettingOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

import PageContainer from '@/components/common/PageContainer';
import Section from '@/components/common/Section';
import { LazyJsonEditor as JsonEditor } from '@/components/common/lazyMonaco';
import { refreshTrayMenu } from '@/services/appApi';
import { savePiOtherSettings } from '@/services/piApi';

import PiPromptSection from '../components/PiPromptSection';
import PiSessionSection from '../components/PiSessionSection';
import { usePiRuntimeController } from '../hooks/usePiRuntimeController';

const { Text } = Typography;

const PiOtherPage: React.FC = () => {
  const { t } = useTranslation();
  const ctrl = usePiRuntimeController();
  const [otherSettings, setOtherSettings] = React.useState<Record<string, unknown>>({});
  const [otherSettingsValid, setOtherSettingsValid] = React.useState(true);

  React.useEffect(() => {
    setOtherSettings(ctrl.runtimeConfig?.otherSettings || {});
  }, [ctrl.runtimeConfig]);

  const handlePromptUpdated = React.useCallback(async () => {
    await ctrl.loadConfig(true);
    await refreshTrayMenu();
  }, [ctrl]);

  const handleOtherSettingsBlur = async (value: unknown, isValid: boolean) => {
    if (!isValid || !otherSettingsValid) {
      message.error(t('pi.invalidJson'));
      return;
    }
    const nextOtherSettings = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
    try {
      const nextConfig = await savePiOtherSettings(nextOtherSettings);
      setOtherSettings(nextConfig.otherSettings || {});
      await refreshTrayMenu();
      message.success(t('common.success'));
    } catch (error) {
      console.error('Failed to save Pi other settings:', error);
      message.error(t('common.error'));
    }
  };

  return (
    <Spin spinning={ctrl.loading}>
      <PageContainer title={t('pi.other.title')}>
        <Section id="pi-global-prompt">
          <PiPromptSection onUpdated={handlePromptUpdated} />
        </Section>

        <Section id="pi-session-manager" showDivider>
          <PiSessionSection />
        </Section>

        <div style={{ height: 'var(--space-md)' }} />

        <Section
          id="pi-other-configuration"
          title={t('pi.otherConfig.title')}
          icon={<SettingOutlined />}
          collapsible
          defaultExpanded={false}
          showDivider
        >
          <Form.Item
            help={
              <span>
                <Text type="secondary">{t('pi.otherConfig.hint')}，</Text>
                <span style={{ color: 'var(--ant-color-primary)' }}>
                  {t('pi.otherConfig.autoSaveHint')}
                </span>
              </span>
            }
            style={{ marginBottom: 0 }}
          >
            <JsonEditor
              value={otherSettings}
              height={260}
              onChange={(value, isValid) => {
                setOtherSettings((value && typeof value === 'object' && !Array.isArray(value))
                  ? value as Record<string, unknown>
                  : {});
                setOtherSettingsValid(isValid);
              }}
              onBlur={handleOtherSettingsBlur}
            />
          </Form.Item>
        </Section>
      </PageContainer>
    </Spin>
  );
};

export default PiOtherPage;
