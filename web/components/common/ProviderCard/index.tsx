import type React from 'react';
import { useState } from 'react';
import { Button, Checkbox, Dropdown, Popconfirm, Tag, Tooltip } from 'antd';
import type { MenuProps } from 'antd';
import {
  CheckCircleOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HolderOutlined,
  LockOutlined,
  MoreOutlined,
  PlusOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import SdkTag from '@/components/common/SdkTag';
import ProviderNameLink from '@/components/common/ProviderNameLink';
import type {
  ProviderDisplayData,
  ModelDisplayData,
  I18nPrefix,
  OfficialModelDisplayData,
} from './types';
import styles from './styles.module.less';

interface ProviderCardProps {
  provider: ProviderDisplayData;
  models: ModelDisplayData[];

  /** Whether the card is draggable */
  draggable?: boolean;
  /** Unique ID for sortable (defaults to provider.id) */
  sortableId?: string;

  /** Provider action callbacks */
  onEdit?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  /** Whether the built-in delete Popconfirm should wrap the delete button. */
  deleteConfirm?: boolean;
  /** Extra action buttons (e.g., "Save to Settings" button for Pi providers) */
  extraActions?: React.ReactNode;

  /** Model action callbacks */
  onAddModel?: () => void;
  onEditModel?: (modelId: string) => void;
  onCopyModel?: (modelId: string) => void;
  onDeleteModel?: (modelId: string) => void;
  onSetPrimaryModel?: (modelId: string) => void;
  modelSelectionMode?: boolean;
  selectedModelIds?: string[];
  onToggleModelSelection?: (modelId: string, selected: boolean) => void;

  /** Model drag-and-drop */
  modelsDraggable?: boolean;
  onReorderModels?: (modelIds: string[]) => void;

  /** Official models from auth.json (read-only, merged display) */
  officialModels?: OfficialModelDisplayData[];

  /** i18n prefix for translations */
  i18nPrefix?: I18nPrefix;
}

/**
 * Flat provider card component with dropdown menu actions
 * 扁平化供应商卡片：无 Card 嵌套、操作集中、模型内联展示
 */
const ProviderCard: React.FC<ProviderCardProps> = ({
  provider,
  models,
  draggable = false,
  sortableId,
  onEdit,
  onCopy,
  onDelete,
  deleteConfirm = true,
  extraActions,
  onAddModel,
  onEditModel,
  onCopyModel,
  onDeleteModel,
  onSetPrimaryModel,
  modelSelectionMode = false,
  selectedModelIds = [],
  onToggleModelSelection,
  modelsDraggable = false,
  onReorderModels,
  officialModels,
  i18nPrefix = 'settings',
}) => {
  const { t } = useTranslation();
  const [modelsExpanded, setModelsExpanded] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: sortableId || provider.id,
    disabled: !draggable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Model drag sensors
  const modelSensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleModelDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const oldIndex = models.findIndex((m) => m.id === active.id);
      const newIndex = models.findIndex((m) => m.id === over.id);

      const newModels = arrayMove(models, oldIndex, newIndex);
      onReorderModels?.(newModels.map((m) => m.id));
    }
  };

  const getStatusTagColor = (status: string): string => {
    switch (status) {
      case 'alpha':
        return 'purple';
      case 'beta':
        return 'blue';
      case 'deprecated':
        return 'red';
      default:
        return 'default';
    }
  };

  // 操作菜单项
  const actionMenuItems: MenuProps['items'] = [
    onEdit && {
      key: 'edit',
      icon: <EditOutlined />,
      label: t('common.edit'),
      onClick: onEdit,
    },
    onCopy && {
      key: 'copy',
      icon: <CopyOutlined />,
      label: t('common.copy'),
      onClick: onCopy,
    },
    onDelete && {
      key: 'delete',
      icon: <DeleteOutlined />,
      label: t('common.delete'),
      danger: true,
      onClick: deleteConfirm ? undefined : onDelete,
    },
  ].filter(Boolean) as MenuProps['items'];

  const totalModelCount = models.length + (officialModels?.length || 0);

  const renderModelList = () => {
    if (models.length === 0 && !officialModels?.length) {
      return (
        <div className={styles.emptyModels}>
          {t(`${i18nPrefix}.model.emptyText`)}
        </div>
      );
    }

    const displayModels = modelsExpanded ? models : models.slice(0, 3);
    const hasMoreModels = models.length > 3;

    const modelItems = displayModels.map((model) => (
      <div
        key={model.id}
        className={`${styles.modelItem} ${modelSelectionMode && selectedModelIds.includes(model.id) ? styles.selected : ''}`}
      >
        {modelsDraggable && !modelSelectionMode && (
          <div className={styles.dragHandle}>
            <HolderOutlined style={{ fontSize: 14 }} />
          </div>
        )}
        {modelSelectionMode && onToggleModelSelection && (
          <Checkbox
            checked={selectedModelIds.includes(model.id)}
            onChange={(e) => onToggleModelSelection(model.id, e.target.checked)}
            aria-label={t(`${i18nPrefix}.model.selectModel`, { name: model.name })}
          />
        )}
        <div className={styles.modelItemMain}>
          <span className={styles.modelName}>{model.name}</span>
          <span className={styles.modelId}>({model.id})</span>
          {model.isPrimary && (
            <span className={styles.modelPrimary}>· {t(`${i18nPrefix}.model.currentPrimary`)}</span>
          )}
          {(model.contextLimit !== undefined || model.outputLimit !== undefined) && (
            <span className={styles.modelLimits}>
              {model.contextLimit !== undefined && `${t(`${i18nPrefix}.model.contextLimit`)}: ${model.contextLimit.toLocaleString()}`}
              {model.contextLimit !== undefined && model.outputLimit !== undefined && ' | '}
              {model.outputLimit !== undefined && `${t(`${i18nPrefix}.model.outputLimit`)}: ${model.outputLimit.toLocaleString()}`}
            </span>
          )}
        </div>
        <div className={styles.modelActions}>
          {onSetPrimaryModel && !modelSelectionMode && (
            <Tooltip title={model.isPrimary ? t(`${i18nPrefix}.model.alreadyPrimary`) : t(`${i18nPrefix}.model.setAsPrimary`)}>
              <button
                className={styles.actionButton}
                onClick={() => onSetPrimaryModel(model.id)}
                disabled={model.isPrimary}
                aria-label={t(`${i18nPrefix}.model.setAsPrimary`)}
              >
                <CheckCircleOutlined style={{ fontSize: 14, color: model.isPrimary ? 'var(--ant-color-primary)' : undefined }} />
              </button>
            </Tooltip>
          )}
          {onEditModel && !modelSelectionMode && (
            <Tooltip title={t('common.edit')}>
              <button
                className={styles.actionButton}
                onClick={() => onEditModel(model.id)}
                aria-label={t('common.edit')}
              >
                <EditOutlined style={{ fontSize: 14 }} />
              </button>
            </Tooltip>
          )}
          {onCopyModel && !modelSelectionMode && (
            <Tooltip title={t('common.copy')}>
              <button
                className={styles.actionButton}
                onClick={() => onCopyModel(model.id)}
                aria-label={t('common.copy')}
              >
                <CopyOutlined style={{ fontSize: 14 }} />
              </button>
            </Tooltip>
          )}
          {onDeleteModel && !modelSelectionMode && (
            <Popconfirm
              title={t(`${i18nPrefix}.model.deleteModel`)}
              description={t(`${i18nPrefix}.model.confirmDelete`, { name: model.name })}
              onConfirm={() => onDeleteModel(model.id)}
              okText={t('common.confirm')}
              cancelText={t('common.cancel')}
            >
              <button
                className={styles.actionButton}
                aria-label={t('common.delete')}
              >
                <DeleteOutlined style={{ fontSize: 14, color: 'var(--color-status-error)' }} />
              </button>
            </Popconfirm>
          )}
        </div>
      </div>
    ));

    // 拖拽上下文包装
    const wrappedModelItems = modelsDraggable && !modelSelectionMode ? (
      <DndContext
        sensors={modelSensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={handleModelDragEnd}
      >
        <SortableContext
          items={models.map((m) => m.id)}
          strategy={verticalListSortingStrategy}
        >
          {modelItems}
        </SortableContext>
      </DndContext>
    ) : modelItems;

    return (
      <>
        <div className={styles.modelsList}>{wrappedModelItems}</div>
        {hasMoreModels && (
          <Button
            type="link"
            size="small"
            onClick={() => setModelsExpanded(!modelsExpanded)}
            style={{ padding: 0, height: 'auto', marginTop: 'var(--space-xs)' }}
          >
            {modelsExpanded
              ? t('common.collapse')
              : t('common.expandMore', { count: models.length - 3 })}
          </Button>
        )}
      </>
    );
  };

  const renderOfficialModels = () => {
    if (!officialModels || officialModels.length === 0) {
      return null;
    }

    return (
      <>
        <div className={styles.officialDivider}>
          <div className={styles.officialDividerLine} />
          <span className={styles.officialDividerText}>
            <SafetyOutlined style={{ fontSize: 12 }} />
            {t(`${i18nPrefix}.official.officialModels`)}
          </span>
          <div className={styles.officialDividerLine} />
        </div>

        {officialModels.map((model) => (
          <div key={model.id} className={styles.officialModelItem}>
            <div className={styles.officialModelContent}>
              <span className={styles.officialModelName}>{model.name || model.id}</span>
              <span className={styles.officialModelMeta}>ID: {model.id}</span>
              {model.isFree && (
                <Tag color="green" style={{ fontSize: 11, margin: 0 }}>
                  {t(`${i18nPrefix}.official.freeModel`)}
                </Tag>
              )}
              {model.status && (
                <Tag color={getStatusTagColor(model.status)} style={{ fontSize: 11, margin: 0 }}>
                  {model.status}
                </Tag>
              )}
              {(model.context !== undefined && model.context !== null) || (model.output !== undefined && model.output !== null) ? (
                <span className={styles.officialModelMeta}>
                  {[
                    model.context !== undefined && model.context !== null ? `${t(`${i18nPrefix}.official.contextLimit`)}: ${model.context.toLocaleString()}` : null,
                    model.output !== undefined && model.output !== null ? `${t(`${i18nPrefix}.official.outputLimit`)}: ${model.output.toLocaleString()}` : null,
                  ].filter(Boolean).join(' | ')}
                </span>
              ) : null}
            </div>
            <LockOutlined className={styles.officialModelLock} />
          </div>
        ))}
      </>
    );
  };

  return (
    <div ref={setNodeRef} style={style} className={`${styles.card} ${isDragging ? styles.dragging : ''}`}>
      <div className={styles.header}>
        {draggable && (
          <div {...attributes} {...listeners} className={styles.dragHandle}>
            <HolderOutlined style={{ fontSize: 16 }} />
          </div>
        )}

        <div className={styles.main}>
          <div className={styles.titleRow}>
            <ProviderNameLink
              name={provider.name}
              baseUrl={provider.baseUrl}
              className={styles.title}
            />
            <div className={styles.actions}>
              {extraActions}
              {actionMenuItems && actionMenuItems.length > 0 && (
                deleteConfirm && onDelete ? (
                  <Popconfirm
                    title={t(`${i18nPrefix}.provider.deleteProvider`)}
                    description={t(`${i18nPrefix}.provider.confirmDelete`, { name: provider.name })}
                    onConfirm={onDelete}
                    okText={t('common.confirm')}
                    cancelText={t('common.cancel')}
                  >
                    <Dropdown menu={{ items: actionMenuItems }} trigger={['click']}>
                      <button className={styles.actionButton} aria-label={t('common.more')}>
                        <MoreOutlined style={{ fontSize: 16 }} />
                      </button>
                    </Dropdown>
                  </Popconfirm>
                ) : (
                  <Dropdown menu={{ items: actionMenuItems }} trigger={['click']}>
                    <button className={styles.actionButton} aria-label={t('common.more')}>
                      <MoreOutlined style={{ fontSize: 16 }} />
                    </button>
                  </Dropdown>
                )
              )}
            </div>
          </div>
          <div className={styles.metaRow}>
            {provider.name !== provider.id && (
              <>
                <span className={`${styles.metaItem} ${styles.metaId}`}>ID: {provider.id}</span>
                <span className={styles.metaDot}>•</span>
              </>
            )}
            <span className={styles.metaItem}>
              <SdkTag name={provider.sdkName} />
            </span>
            <span className={styles.metaDot}>•</span>
            <Tooltip title={provider.baseUrl} placement="topLeft">
              <span className={styles.metaUrl}>{provider.baseUrl}</span>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* 模型区域 */}
      <div className={styles.modelsSection}>
        <div className={styles.modelsHeader}>
          <span className={styles.modelsTitle}>
            {t(`${i18nPrefix}.model.title`)}
            <span className={styles.modelsCount}>({totalModelCount})</span>
          </span>
          <div className={styles.modelsActions}>
            {onAddModel && (
              <Button
                size="small"
                type="text"
                icon={<PlusOutlined />}
                onClick={onAddModel}
                style={{ fontSize: 12 }}
              >
                {t(`${i18nPrefix}.model.addModel`)}
              </Button>
            )}
          </div>
        </div>
        {renderModelList()}
        {renderOfficialModels()}
      </div>
    </div>
  );
};

export default ProviderCard;
