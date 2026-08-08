import React from 'react';
import { Button, Space, Spin, Typography, message } from 'antd';
import {
  CloudSyncOutlined,
  EditOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';

import PageContainer from '@/components/common/PageContainer';
import Section from '@/components/common/Section';
import JsonPreviewModal from '@/components/common/JsonPreviewModal';
import RootDirectoryModal from '@/features/coding/shared/RootDirectoryModal';
import { fetchRemotePresetModels } from '@/services/appApi';

import PiModelSettings from '../components/PiModelSettings';
import PiProviderSection from '../components/PiProviderSection';
import { usePiRuntimeController } from '../hooks/usePiRuntimeController';
import styles from './PiPage.module.less';

const { Text, Link } = Typography;

const PiConfigPage: React.FC = () => {
  const { t } = useTranslation();
  const [refreshingModels, setRefreshingModels] = React.useState(false);
  const [previewModalOpen, setPreviewModalOpen] = React.useState(false);

  const ctrl = usePiRuntimeController();

  const handleRefreshModelsCache = async () => {
    setRefreshingModels(true);
    try {
      await fetchRemotePresetModels();
      message.success(t('pi.modelsRefreshSuccess'));
    } catch (error) {
      console.error('Failed to refresh Pi preset models:', error);
      message.error(t('common.error'));
    } finally {
      setRefreshingModels(false);
    }
  };

  const headerActions = (
    <Space wrap>
      <Link
        type="secondary"
        className={styles.headerLink}
        onClick={() => { void openUrl('https://pi.dev/docs/latest/quickstart'); }}
      >
        <LinkOutlined /> {t('pi.viewDocs')}
      </Link>
      <Link
        type="secondary"
        className={styles.headerLink}
        onClick={() => setPreviewModalOpen(true)}
      >
        <EyeOutlined /> {t('common.previewConfig')}
      </Link>
    </Space>
  );

  const pathToolbar = (
    <Space className={styles.pathToolbar} wrap>
      <Text type="secondary" className={styles.pathLabel}>
        {t('pi.configPath')}:
      </Text>
      <Text code className={styles.pathText}>
        {ctrl.runtimeConfig?.rootPathInfo.path}
      </Text>
      <Button
        type="text" size="small" icon={<EditOutlined />}
        onClick={() => ctrl.setRootDirectoryModalOpen(true)}
        className={styles.textAction}
      >
        {t('pi.rootPathSource.customize')}
      </Button>
      <Button
        type="text" size="small" icon={<FolderOpenOutlined />}
        onClick={ctrl.handleOpenRootFolder}
        className={styles.textAction}
      >
        {t('pi.openFolder')}
      </Button>
      <Button
        type="text" size="small" icon={<ReloadOutlined />}
        onClick={() => { ctrl.handleRefreshConfig(); }}
        className={styles.textAction}
      >
        {t('pi.refreshConfig')}
      </Button>
      <Button
        type="text" size="small" icon={<CloudSyncOutlined />}
        onClick={handleRefreshModelsCache}
        loading={refreshingModels}
        className={styles.textAction}
      >
        {t('pi.syncModels')}
      </Button>
    </Space>
  );

  return (
    <Spin spinning={ctrl.loading}>
      <PageContainer
        title={t('pi.title')}
        titleExtra={headerActions}
        subtitle={pathToolbar}
      >
        <Section id="pi-model-settings" showDivider={false}>
          <PiModelSettings
            form={ctrl.modelForm}
            runtimeConfig={ctrl.runtimeConfig}
            onConfigUpdated={ctrl.handleConfigUpdated}
          />
        </Section>

        <Section id="pi-providers" showDivider>
          <PiProviderSection
            runtimeConfig={ctrl.runtimeConfig}
            modelForm={ctrl.modelForm}
            onConfigUpdated={ctrl.handleConfigUpdated}
          />
        </Section>

        <RootDirectoryModal
          open={ctrl.rootDirectoryModalOpen}
          {...ctrl.getRootDirectoryModalProps(ctrl.runtimeConfig?.rootPathInfo || null)}
          onCancel={() => ctrl.setRootDirectoryModalOpen(false)}
          onSubmit={ctrl.handleSaveRootDirectory}
          onReset={ctrl.handleResetRootDirectory}
        />

        <JsonPreviewModal
          open={previewModalOpen}
          onClose={() => setPreviewModalOpen(false)}
          title={t('pi.preview.title')}
          data={ctrl.runtimeConfig}
        />
      </PageContainer>
    </Spin>
  );
};

export default PiConfigPage;
