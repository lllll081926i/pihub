import React from 'react';
import { Modal, InputNumber, Button, message, Checkbox, Input, Space, Tooltip, Switch, Radio, Alert } from 'antd';
import { FolderOpenOutlined, DeleteOutlined, ClearOutlined, ReloadOutlined, SwapOutlined } from '@ant-design/icons';
import { open } from '@tauri-apps/plugin-dialog';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useTranslation } from 'react-i18next';
import type { SkillViewMode, CentralRepoPathPreview, CentralRepoScan } from '../../types';
import * as api from '../../services/skillsApi';
import { useSkillsStore } from '../../stores/skillsStore';
import { refreshTrayMenu } from '@/services/appApi';
import {
  parseManagementGridColumnSetting,
  type ManagementGridColumnSetting,
} from '@/features/coding/shared/management';
import styles from './SkillsSettingsModal.module.less';

interface SkillsSettingsModalProps {
  open: boolean;
  cardColumnSetting?: ManagementGridColumnSetting;
  cardColumnOptions?: readonly ManagementGridColumnSetting[];
  onCardColumnSettingChange?: (value: ManagementGridColumnSetting) => void;
  onDefaultViewModeApply?: (mode: SkillViewMode) => void;
  onClose: () => void;
}

export const SkillsSettingsModal: React.FC<SkillsSettingsModalProps> = ({
  open: isOpen,
  cardColumnSetting,
  cardColumnOptions,
  onCardColumnSettingChange,
  onDefaultViewModeApply,
  onClose,
}) => {
  const { t } = useTranslation();
  const { loadToolStatus, skills, loadSkills, loadCentralRepoPath } = useSkillsStore();
  const [path, setPath] = React.useState('');
  const [pathUsesDefault, setPathUsesDefault] = React.useState(false);
  const [pathWarning, setPathWarning] = React.useState<string | null>(null);
  const [pathActionLoading, setPathActionLoading] = React.useState(false);
  const [pathPreview, setPathPreview] = React.useState<CentralRepoPathPreview | null>(null);
  const [selectedMigrations, setSelectedMigrations] = React.useState<string[]>([]);
  const [selectedRepairs, setSelectedRepairs] = React.useState<string[]>([]);
  const [selectedAdoptions, setSelectedAdoptions] = React.useState<string[]>([]);
  const [scanResult, setScanResult] = React.useState<CentralRepoScan | null>(null);
  const [selectedScanRepairs, setSelectedScanRepairs] = React.useState<string[]>([]);
  const [selectedScanAdoptions, setSelectedScanAdoptions] = React.useState<string[]>([]);
  const [cleanupDays, setCleanupDays] = React.useState(30);
  const [loading, setLoading] = React.useState(false);
  const [clearingCache, setClearingCache] = React.useState(false);
  const [showInTray, setShowInTray] = React.useState(false);
  const [defaultViewMode, setDefaultViewMode] = React.useState<SkillViewMode>('flat');
  const [showClearAllModal, setShowClearAllModal] = React.useState(false);
  const [clearAllConfirmText, setClearAllConfirmText] = React.useState('');
  const [clearingAll, setClearingAll] = React.useState(false);

  // Load settings on mount
  React.useEffect(() => {
    loadPathStatus();
    api.getGitCacheCleanupDays().then(setCleanupDays).catch(console.error);
    api.getShowSkillsInTray().then(setShowInTray).catch(console.error);
    api.getDefaultViewMode().then(setDefaultViewMode).catch(console.error);
    loadSkills();
  }, []);

  const loadPathStatus = async () => {
    try {
      const status = await api.getCentralRepoPathStatus();
      setPath(status.current_path);
      setPathUsesDefault(status.uses_default);
      setPathWarning(status.warning);
    } catch (error) {
      console.error('Failed to load central repo path:', error);
    }
  };

  const handleOpenFolder = async () => {
    if (path) {
      try {
        await revealItemInDir(path);
      } catch (error) {
        message.error(String(error));
      }
    }
  };

  const openPathPreview = async (nextPath: string) => {
    setPathActionLoading(true);
    try {
      const preview = await api.previewCentralRepoPath(nextPath);
      setPathPreview(preview);
      setSelectedMigrations(preview.migration_candidates.map((item) => item.skill_id));
      setSelectedRepairs(preview.repair_candidates.map((item) => item.skill_id));
      setSelectedAdoptions(preview.unmanaged_detected.map((item) => item.relative_path));
    } catch (error) {
      message.error(String(error));
    } finally {
      setPathActionLoading(false);
    }
  };

  const handleChooseCentralPath = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      if (typeof selected === 'string') {
        await openPathPreview(selected);
      }
    } catch (error) {
      message.error(String(error));
    }
  };

  const handleRestoreDefaultPath = async () => {
    try {
      const defaultPath = await api.getDefaultCentralRepoPath();
      await openPathPreview(defaultPath);
    } catch (error) {
      message.error(String(error));
    }
  };

  const refreshAfterCentralRepoChange = async () => {
    await Promise.all([
      loadPathStatus(),
      loadCentralRepoPath(),
      loadSkills(),
      loadToolStatus(),
    ]);
    await refreshTrayMenu();
  };

  const handleApplyPathPreview = async () => {
    if (!pathPreview) {
      return;
    }
    setPathActionLoading(true);
    try {
      const repairExistingSkillPaths = Object.fromEntries(
        pathPreview.repair_candidates
          .filter((item) => selectedRepairs.includes(item.skill_id))
          .map((item) => [item.skill_id, item.detected_relative_path]),
      );
      const result = await api.applyCentralRepoPathChange(pathPreview.resolved_path, {
        adoptDetectedSkillPaths: selectedAdoptions,
        repairExistingSkillPaths,
        migrateExistingSkillIds: selectedMigrations,
        useDefaultPath: pathPreview.requested_is_default,
        resyncEnabledTools: true,
      });
      await refreshAfterCentralRepoChange();
      setPathPreview(null);
      if (result.warnings.length > 0) {
        message.warning(t('skills.globalDir.appliedWithWarnings', { count: result.warnings.length }));
      } else {
        message.success(t('skills.globalDir.applied'));
      }
    } catch (error) {
      message.error(String(error));
    } finally {
      setPathActionLoading(false);
    }
  };

  const handleScanCentralRepo = async () => {
    setPathActionLoading(true);
    try {
      const result = await api.scanCentralRepo();
      setScanResult(result);
      setSelectedScanRepairs(result.repair_candidates.map((item) => item.skill_id));
      setSelectedScanAdoptions(result.unmanaged_detected.map((item) => item.relative_path));
    } catch (error) {
      message.error(String(error));
    } finally {
      setPathActionLoading(false);
    }
  };

  const handleApplyScanResult = async () => {
    if (!scanResult) {
      return;
    }
    setPathActionLoading(true);
    try {
      for (const repair of scanResult.repair_candidates) {
        if (selectedScanRepairs.includes(repair.skill_id)) {
          await api.repairCentralRepoSkill(repair.skill_id, repair.detected_relative_path);
        }
      }
      if (selectedScanAdoptions.length > 0) {
        await api.adoptCentralRepoSkills(selectedScanAdoptions);
      }
      await refreshAfterCentralRepoChange();
      setScanResult(null);
      message.success(t('skills.globalDir.scanApplied'));
    } catch (error) {
      message.error(String(error));
    } finally {
      setPathActionLoading(false);
    }
  };

  const handleShowInTrayChange = async (checked: boolean) => {
    setShowInTray(checked);
    try {
      await api.setShowSkillsInTray(checked);
      await refreshTrayMenu();
    } catch (error) {
      message.error(String(error));
      setShowInTray(!checked); // Revert on error
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await api.setGitCacheCleanupDays(cleanupDays);
      await api.setDefaultViewMode(defaultViewMode);
      await loadToolStatus(); // Refresh global store
      onDefaultViewModeApply?.(defaultViewMode);
      message.success(t('common.success'));
      onClose();
    } catch (error) {
      message.error(String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      const count = await api.clearGitCache();
      message.success(t('skills.status.gitCacheCleared', { count }));
    } catch (error) {
      message.error(String(error));
    } finally {
      setClearingCache(false);
    }
  };

  const handleOpenCacheFolder = async () => {
    try {
      const cachePath = await api.getGitCachePath();
      await revealItemInDir(cachePath);
    } catch (error) {
      message.error(String(error));
    }
  };

  const expectedConfirmText = t('skills.clearAll.confirmText');

  const handleClearAllSkills = async () => {
    if (clearAllConfirmText !== expectedConfirmText) {
      message.error(t('skills.clearAll.confirmMismatch'));
      return;
    }
    setClearingAll(true);
    try {
      // Delete all managed skills one by one
      for (const skill of skills) {
        await api.deleteManagedSkill(skill.id, { deleteSourceFiles: false });
      }
      await loadSkills();
      message.success(t('skills.clearAll.success'));
      setShowClearAllModal(false);
      setClearAllConfirmText('');
    } catch (error) {
      message.error(String(error));
    } finally {
      setClearingAll(false);
    }
  };

  return (
    <Modal
      title={t('skills.settings')}
      open={isOpen}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      <div className={styles.section}>
        <div className={styles.labelArea}>
          <label className={styles.label}>{t('skills.skillsStoragePath')}</label>
        </div>
        <div className={styles.inputArea}>
          <div className={styles.pathRow}>
            <span className={styles.pathText}>{path}</span>
            {pathUsesDefault && (
              <span className={styles.pathTag}>{t('skills.globalDir.defaultTag')}</span>
            )}
            <Tooltip title={t('skills.globalDir.openFolder')}>
              <Button
                type="text"
                size="small"
                className={styles.pathIconButton}
                icon={<FolderOpenOutlined />}
                aria-label={t('skills.globalDir.openFolder')}
                onClick={handleOpenFolder}
              />
            </Tooltip>
          </div>
          <Space size="small" wrap className={styles.pathActions}>
            <Button
              size="small"
              className={styles.pathActionButton}
              icon={<SwapOutlined />}
              loading={pathActionLoading && !pathPreview && !scanResult}
              onClick={handleChooseCentralPath}
            >
              {t('skills.globalDir.change')}
            </Button>
            <Button
              size="small"
              className={styles.pathActionButton}
              disabled={pathUsesDefault}
              onClick={handleRestoreDefaultPath}
            >
              {t('skills.globalDir.restoreDefault')}
            </Button>
            <Button
              size="small"
              className={styles.pathActionButton}
              icon={<ReloadOutlined />}
              onClick={handleScanCentralRepo}
              loading={pathActionLoading && !pathPreview && !scanResult}
            >
              {t('skills.globalDir.scan')}
            </Button>
          </Space>
          {pathWarning && (
            <Alert
              className={styles.inlineAlert}
              type="warning"
              showIcon
              message={pathWarning}
            />
          )}
          <p className={styles.hint}>{t('skills.skillsStorageHint')}</p>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.labelArea}>
          <label className={styles.label}>{t('skills.showInTray')}</label>
        </div>
        <div className={styles.inputArea}>
          <Switch checked={showInTray} onChange={handleShowInTrayChange} />
          <p className={styles.hint}>{t('skills.showInTrayHint')}</p>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.labelArea}>
          <label className={styles.label}>{t('skills.defaultViewMode')}</label>
        </div>
        <div className={styles.inputArea}>
          <Radio.Group
            value={defaultViewMode}
            onChange={(event) => setDefaultViewMode(event.target.value as SkillViewMode)}
          >
            <Radio value="flat">{t('skills.viewFlat')}</Radio>
            <Radio value="grouped">{t('skills.viewGrouped')}</Radio>
          </Radio.Group>
          <p className={styles.hint}>{t('skills.defaultViewModeHint')}</p>
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
          <label className={styles.label}>{t('skills.gitCacheCleanupDays')}</label>
        </div>
        <div className={styles.inputArea}>
          <Space size="small">
            <InputNumber
              min={0}
              max={365}
              value={cleanupDays}
              onChange={(v) => setCleanupDays(v || 0)}
              style={{ width: 120 }}
            />
            <Button
              type="link"
              size="small"
              icon={<DeleteOutlined />}
              onClick={handleClearCache}
              loading={clearingCache}
            >
              {t('skills.cleanNow')}
            </Button>
            <Button
              type="link"
              size="small"
              icon={<FolderOpenOutlined />}
              onClick={handleOpenCacheFolder}
            />
          </Space>
          <p className={styles.hint}>{t('skills.gitCacheCleanupHint')}</p>
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.labelArea}>
          <label className={styles.label}>{t('skills.clearAll.title')}</label>
        </div>
        <div className={styles.inputArea}>
          <Button
            danger
            icon={<ClearOutlined />}
            onClick={() => setShowClearAllModal(true)}
            disabled={skills.length === 0}
          >
            {t('skills.clearAll.button')}
          </Button>
          <p className={styles.hint}>{t('skills.clearAll.hint')}</p>
        </div>
      </div>

      <div className={styles.footer}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="primary" onClick={handleSave} loading={loading}>
          {t('common.save')}
        </Button>
      </div>

      <Modal
        title={t('skills.globalDir.previewTitle')}
        open={!!pathPreview}
        onCancel={() => setPathPreview(null)}
        onOk={handleApplyPathPreview}
        okText={t('skills.globalDir.apply')}
        cancelText={t('common.cancel')}
        confirmLoading={pathActionLoading}
        okButtonProps={{
          disabled: !pathPreview?.can_apply || !!pathPreview?.migration_conflicts.length,
        }}
        width={680}
      >
        {pathPreview && (
          <div className={styles.previewBody}>
            <div className={styles.pathCompare}>
              <div>
                <span className={styles.previewLabel}>{t('skills.globalDir.currentPath')}</span>
                <span className={styles.previewPath}>{pathPreview.current_path}</span>
              </div>
              <div>
                <span className={styles.previewLabel}>{t('skills.globalDir.targetPath')}</span>
                <span className={styles.previewPath}>{pathPreview.resolved_path}</span>
              </div>
            </div>

            {pathPreview.blocking_errors.length > 0 && (
              <Alert
                type="error"
                showIcon
                message={t('skills.globalDir.blockingErrors')}
                description={pathPreview.blocking_errors.join('\n')}
              />
            )}
            {pathPreview.root_skill_warning && (
              <Alert type="warning" showIcon message={pathPreview.root_skill_warning} />
            )}
            {pathPreview.path_warnings.map((warning) => (
              <Alert key={warning} type="warning" showIcon message={warning} />
            ))}

            <div className={styles.summaryGrid}>
              <div>
                <span>{t('skills.globalDir.detectedCount')}</span>
                <strong>{pathPreview.detected_skills.length}</strong>
              </div>
              <div>
                <span>{t('skills.globalDir.migrationCount')}</span>
                <strong>{pathPreview.migration_candidates.length}</strong>
              </div>
              <div>
                <span>{t('skills.globalDir.unmanagedCount')}</span>
                <strong>{pathPreview.unmanaged_detected.length}</strong>
              </div>
              <div>
                <span>{t('skills.globalDir.repairCount')}</span>
                <strong>{pathPreview.repair_candidates.length}</strong>
              </div>
            </div>

            {pathPreview.conflicts.length > 0 && (
              <div className={styles.listPanel}>
                <div className={styles.listTitle}>{t('skills.globalDir.conflicts')}</div>
                {pathPreview.conflicts.map((conflict) => (
                  <div
                    key={`${conflict.name}:${conflict.paths.join('|')}`}
                    className={styles.listItem}
                  >
                    <strong>{conflict.name}</strong>
                    <span className={styles.pathSmall}>{conflict.reason}</span>
                    <span className={styles.pathSmall}>{conflict.paths.join(', ')}</span>
                  </div>
                ))}
              </div>
            )}

            {pathPreview.migration_conflicts.length > 0 && (
              <div className={styles.listPanel}>
                <div className={styles.listTitle}>{t('skills.globalDir.migrationConflicts')}</div>
                {pathPreview.migration_conflicts.map((conflict) => (
                  <div
                    key={`${conflict.name}:${conflict.paths.join('|')}`}
                    className={styles.listItem}
                  >
                    <strong>{conflict.name}</strong>
                    <span className={styles.pathSmall}>{conflict.reason}</span>
                    <span className={styles.pathSmall}>{conflict.paths.join(', ')}</span>
                  </div>
                ))}
              </div>
            )}

            {pathPreview.migration_candidates.length > 0 && (
              <div className={styles.listPanel}>
                <div className={styles.listTitle}>{t('skills.globalDir.migrationItems')}</div>
                <Checkbox.Group
                  className={styles.checkList}
                  value={selectedMigrations}
                  onChange={(values) => setSelectedMigrations(values.map(String))}
                  options={pathPreview.migration_candidates.map((item) => ({
                    value: item.skill_id,
                    label: (
                      <span className={styles.checkLabel}>
                        <strong>{item.name}</strong>
                        <span className={styles.pathSmall}>{item.relative_path}</span>
                      </span>
                    ),
                  }))}
                />
              </div>
            )}

            {pathPreview.repair_candidates.length > 0 && (
              <div className={styles.listPanel}>
                <div className={styles.listTitle}>{t('skills.globalDir.repairItems')}</div>
                <Checkbox.Group
                  className={styles.checkList}
                  value={selectedRepairs}
                  onChange={(values) => setSelectedRepairs(values.map(String))}
                  options={pathPreview.repair_candidates.map((item) => ({
                    value: item.skill_id,
                    label: (
                      <span className={styles.checkLabel}>
                        <strong>{item.name}</strong>
                        <span className={styles.pathSmall}>
                          {item.current_relative_path} -&gt; {item.detected_relative_path}
                        </span>
                      </span>
                    ),
                  }))}
                />
              </div>
            )}

            {pathPreview.unmanaged_detected.length > 0 && (
              <div className={styles.listPanel}>
                <div className={styles.listTitle}>{t('skills.globalDir.adoptItems')}</div>
                <Checkbox.Group
                  className={styles.checkList}
                  value={selectedAdoptions}
                  onChange={(values) => setSelectedAdoptions(values.map(String))}
                  options={pathPreview.unmanaged_detected.map((item) => ({
                    value: item.relative_path,
                    label: (
                      <span className={styles.checkLabel}>
                        <strong>{item.name}</strong>
                        <span className={styles.pathSmall}>{item.relative_path}</span>
                      </span>
                    ),
                  }))}
                />
              </div>
            )}

            {pathPreview.affected_targets.length > 0 && (
              <Alert
                type="info"
                showIcon
                message={t('skills.globalDir.resyncHint', { count: pathPreview.affected_targets.length })}
              />
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={t('skills.globalDir.scanTitle')}
        open={!!scanResult}
        onCancel={() => setScanResult(null)}
        onOk={handleApplyScanResult}
        okText={t('skills.globalDir.applyScan')}
        cancelText={t('common.cancel')}
        confirmLoading={pathActionLoading}
        okButtonProps={{ disabled: !!scanResult?.conflicts.length }}
        width={640}
      >
        {scanResult && (
          <div className={styles.previewBody}>
            <div className={styles.pathCompare}>
              <div>
                <span className={styles.previewLabel}>{t('skills.globalDir.currentPath')}</span>
                <span className={styles.previewPath}>{scanResult.central_path}</span>
              </div>
            </div>
            {scanResult.root_skill_warning && (
              <Alert type="warning" showIcon message={scanResult.root_skill_warning} />
            )}
            {scanResult.conflicts.length > 0 && (
              <Alert
                type="error"
                showIcon
                message={t('skills.globalDir.conflicts')}
                description={scanResult.conflicts.map((item) => `${item.name}: ${item.paths.join(', ')}`).join('\n')}
              />
            )}
            <div className={styles.summaryGrid}>
              <div>
                <span>{t('skills.globalDir.detectedCount')}</span>
                <strong>{scanResult.detected_skills.length}</strong>
              </div>
              <div>
                <span>{t('skills.globalDir.unmanagedCount')}</span>
                <strong>{scanResult.unmanaged_detected.length}</strong>
              </div>
              <div>
                <span>{t('skills.globalDir.repairCount')}</span>
                <strong>{scanResult.repair_candidates.length}</strong>
              </div>
            </div>

            {scanResult.repair_candidates.length > 0 && (
              <div className={styles.listPanel}>
                <div className={styles.listTitle}>{t('skills.globalDir.repairItems')}</div>
                <Checkbox.Group
                  className={styles.checkList}
                  value={selectedScanRepairs}
                  onChange={(values) => setSelectedScanRepairs(values.map(String))}
                  options={scanResult.repair_candidates.map((item) => ({
                    value: item.skill_id,
                    label: (
                      <span className={styles.checkLabel}>
                        <strong>{item.name}</strong>
                        <span className={styles.pathSmall}>
                          {item.current_relative_path} -&gt; {item.detected_relative_path}
                        </span>
                      </span>
                    ),
                  }))}
                />
              </div>
            )}

            {scanResult.unmanaged_detected.length > 0 && (
              <div className={styles.listPanel}>
                <div className={styles.listTitle}>{t('skills.globalDir.adoptItems')}</div>
                <Checkbox.Group
                  className={styles.checkList}
                  value={selectedScanAdoptions}
                  onChange={(values) => setSelectedScanAdoptions(values.map(String))}
                  options={scanResult.unmanaged_detected.map((item) => ({
                    value: item.relative_path,
                    label: (
                      <span className={styles.checkLabel}>
                        <strong>{item.name}</strong>
                        <span className={styles.pathSmall}>{item.relative_path}</span>
                      </span>
                    ),
                  }))}
                />
              </div>
            )}

            {scanResult.unmanaged_detected.length === 0 && scanResult.repair_candidates.length === 0 && (
              <Alert type="success" showIcon message={t('skills.globalDir.scanEmpty')} />
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={t('skills.clearAll.modalTitle')}
        open={showClearAllModal}
        onCancel={() => {
          setShowClearAllModal(false);
          setClearAllConfirmText('');
        }}
        footer={null}
        width={450}
      >
        <div style={{ marginBottom: 16 }}>
          <p>{t('skills.clearAll.modalMessage', { count: skills.length })}</p>
          <p style={{ color: 'var(--color-status-error)', fontWeight: 500 }}>
            {t('skills.clearAll.modalWarning')}
          </p>
        </div>
        <div style={{ marginBottom: 16 }}>
          <p style={{ marginBottom: 8 }}>
            {t('skills.clearAll.inputPrompt', { text: expectedConfirmText })}
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
              onClick={handleClearAllSkills}
              loading={clearingAll}
              disabled={clearAllConfirmText !== expectedConfirmText}
            >
              {t('skills.clearAll.confirm')}
            </Button>
          </Space>
        </div>
      </Modal>
    </Modal>
  );
};
