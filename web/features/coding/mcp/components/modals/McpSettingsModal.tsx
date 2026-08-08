import React from 'react';
import { Modal, Button, message, Input, Space, Switch } from 'antd';
import { ClearOutlined, DeleteOutlined } from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import type { McpServer, StdioConfig, HttpConfig } from '../../types';
import * as mcpApi from '../../services/mcpApi';
import { useMcpStore } from '../../stores/mcpStore';
import { refreshTrayMenu } from '@/services/appApi';
import {
  parseManagementGridColumnSetting,
  type ManagementGridColumnSetting,
} from '@/features/coding/shared/management';
import styles from './McpSettingsModal.module.less';

interface McpSettingsModalProps {
  open: boolean;
  cardColumnSetting?: ManagementGridColumnSetting;
  cardColumnOptions?: readonly ManagementGridColumnSetting[];
  onCardColumnSettingChange?: (value: ManagementGridColumnSetting) => void;
  onClose: () => void;
}

export const McpSettingsModal: React.FC<McpSettingsModalProps> = ({
  open: isOpen,
  cardColumnSetting,
  cardColumnOptions,
  onCardColumnSettingChange,
  onClose,
}) => {
  const { t } = useTranslation();
  const { fetchTools, servers, fetchServers } = useMcpStore();
  const [loading, setLoading] = React.useState(false);
  const [showInTray, setShowInTray] = React.useState(false);
  const [showClearAllModal, setShowClearAllModal] = React.useState(false);
  const [clearAllConfirmText, setClearAllConfirmText] = React.useState('');
  const [clearingAll, setClearingAll] = React.useState(false);

  // Load settings on mount
  React.useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const trayEnabled = await mcpApi.getMcpShowInTray();
      setShowInTray(trayEnabled);
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
  };

  const handleShowInTrayChange = async (checked: boolean) => {
    setShowInTray(checked);
    try {
      await mcpApi.setMcpShowInTray(checked);
      await refreshTrayMenu();
    } catch (error) {
      message.error(String(error));
      setShowInTray(!checked); // Revert on error
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await fetchTools(); // Refresh global store
      message.success(t('common.success'));
      onClose();
    } catch (error) {
      message.error(String(error));
    } finally {
      setLoading(false);
    }
  };

  const getDuplicateServers = (list: McpServer[]): McpServer[] => {
    const groups = new Map<string, McpServer[]>();
    for (const server of list) {
      let key: string;
      if (server.server_type === 'stdio') {
        const config = server.server_config as StdioConfig;
        key = `stdio:${config.command}:${JSON.stringify([...(config.args || [])].sort())}`;
      } else {
        const config = server.server_config as HttpConfig;
        key = `${server.server_type}:${config.url}`;
      }
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(server);
    }

    const duplicates: McpServer[] = [];
    for (const group of groups.values()) {
      if (group.length > 1) {
        group.sort((a, b) => a.created_at - b.created_at);
        duplicates.push(...group.slice(1));
      }
    }
    return duplicates;
  };

  const duplicateServers = React.useMemo(() => getDuplicateServers(servers), [servers]);

  const expectedConfirmText = t('mcp.clearAll.confirmText');

  const handleClearAllServers = async () => {
    if (clearAllConfirmText !== expectedConfirmText) {
      message.error(t('mcp.clearAll.confirmMismatch'));
      return;
    }
    setClearingAll(true);
    try {
      for (const server of servers) {
        await mcpApi.deleteMcpServer(server.id);
      }
      await fetchServers();
      message.success(t('mcp.clearAll.success'));
      setShowClearAllModal(false);
      setClearAllConfirmText('');
    } catch (error) {
      message.error(String(error));
    } finally {
      setClearingAll(false);
    }
  };

  const handleClearDuplicates = () => {
    if (duplicateServers.length === 0) {
      message.info(t('mcp.clearDuplicates.noDuplicates'));
      return;
    }
    Modal.confirm({
      title: t('mcp.clearDuplicates.modalTitle'),
      content: t('mcp.clearDuplicates.modalMessage', { count: duplicateServers.length }),
      okText: t('mcp.clearDuplicates.confirm'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          for (const server of duplicateServers) {
            await mcpApi.deleteMcpServer(server.id);
          }
          await fetchServers();
          message.success(t('mcp.clearDuplicates.success', { count: duplicateServers.length }));
        } catch (error) {
          message.error(String(error));
        }
      },
    });
  };

  return (
    <Modal
      title={t('mcp.settings')}
      open={isOpen}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      <div className={styles.section}>
        <div className={styles.labelArea}>
          <label className={styles.label}>{t('mcp.showInTray')}</label>
        </div>
        <div className={styles.inputArea}>
          <Switch checked={showInTray} onChange={handleShowInTrayChange} />
          <p className={styles.hint}>{t('mcp.showInTrayHint')}</p>
        </div>
      </div>

      {cardColumnSetting !== undefined && cardColumnOptions && onCardColumnSettingChange && (
        <div className={styles.section}>
          <div className={styles.labelArea}>
            <label className={styles.label}>{t('common.cardColumns')}</label>
          </div>
          <div className={styles.inputArea}>
            <select
              className={styles.selectControl}
              value={String(cardColumnSetting)}
              onChange={(event) => onCardColumnSettingChange(parseManagementGridColumnSetting(event.target.value))}
            >
              {cardColumnOptions.map((option) => (
                <option key={option} value={String(option)}>
                  {option === 'auto'
                    ? t('common.cardColumnsAuto')
                    : t('common.cardColumnsCount', { count: option })}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.labelArea}>
          <label className={styles.label}>{t('mcp.clearAll.title')}</label>
        </div>
        <div className={styles.inputArea}>
          <Space>
            <Button
              danger
              icon={<ClearOutlined />}
              onClick={() => setShowClearAllModal(true)}
              disabled={servers.length === 0}
            >
              {t('mcp.clearAll.button')}
            </Button>
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={handleClearDuplicates}
              disabled={duplicateServers.length === 0}
            >
              {t('mcp.clearDuplicates.button')}
            </Button>
          </Space>
          <p className={styles.hint}>{t('mcp.clearAll.hint')}</p>
        </div>
      </div>

      <div className={styles.footer}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="primary" onClick={handleSave} loading={loading}>
          {t('common.save')}
        </Button>
      </div>

      {showClearAllModal && (
        <Modal
          title={t('mcp.clearAll.modalTitle')}
          open={showClearAllModal}
          onCancel={() => {
            setShowClearAllModal(false);
            setClearAllConfirmText('');
          }}
          footer={null}
          width={450}
        >
          <div style={{ marginBottom: 16 }}>
            <p>{t('mcp.clearAll.modalMessage', { count: servers.length })}</p>
            <p style={{ color: '#ff4d4f', fontWeight: 500 }}>
              {t('mcp.clearAll.modalWarning')}
            </p>
          </div>
          <div style={{ marginBottom: 16 }}>
            <p style={{ marginBottom: 8 }}>
              {t('mcp.clearAll.inputPrompt', { text: expectedConfirmText })}
            </p>
            <Input
              value={clearAllConfirmText}
              onChange={(e) => setClearAllConfirmText(e.target.value)}
              placeholder={expectedConfirmText}
            />
          </div>
          <div style={{ textAlign: 'right' }}>
            <Space>
              <Button onClick={() => {
                setShowClearAllModal(false);
                setClearAllConfirmText('');
              }}>
                {t('common.cancel')}
              </Button>
              <Button
                type="primary"
                danger
                onClick={handleClearAllServers}
                loading={clearingAll}
                disabled={clearAllConfirmText !== expectedConfirmText}
              >
                {t('mcp.clearAll.confirm')}
              </Button>
            </Space>
          </div>
        </Modal>
      )}
    </Modal>
  );
};
