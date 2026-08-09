import React from 'react';
import { message } from 'antd';
import {
  Code2,
  Copy,
  Globe2,
  MoreHorizontal,
  Pencil,
  Tags,
  Terminal,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import ContextMenu, { useContextMenu } from '@/components/common/ContextMenu';
import {
  ManagementCard,
  ManagementCardActions,
  ManagementCardCheckboxArea,
  ManagementCardDragHandle,
  ManagementCardHeader,
  ManagementCardIcon,
  ManagementCardMain,
  ManagementCardMetaRow,
  ManagementCardToolMatrix,
  ManagementCheckbox,
  ManagementIconButton,
  ManagementMenu,
  type ManagementMenuItem,
} from '@/features/coding/shared/management';
import type { McpServer, McpTool } from '../types';
import {
  formatMcpCommandPackageVersionLabel,
  getMcpCommandPackageVersion,
  getMcpCommandPackageVersionKey,
} from '../utils/mcpCommandPackageVersion';
import { getMcpDisplayNote } from '../utils/mcpGrouping';
import styles from './McpCard.module.less';

interface McpCardProps {
  server: McpServer;
  tools: McpTool[];
  loading: boolean;
  dragDisabled?: boolean;
  selected?: boolean;
  selectable?: boolean;
  toolsReadOnly?: boolean;
  resolvedPackageVersions?: Record<string, string>;
  enterDelay?: number;
  onSelectChange?: (serverId: string, checked: boolean) => void;
  onEdit: (server: McpServer) => void;
  onEditMetadata: (server: McpServer) => void;
  onDelete: (serverId: string) => void;
  onToggleTool: (serverId: string, toolKey: string) => void;
}

interface McpCardContentProps extends Omit<McpCardProps, 'dragDisabled'> {
  dragHandle?: React.ReactNode;
  containerRef?: (node: HTMLDivElement | null) => void;
  containerStyle?: React.CSSProperties;
}

const McpCardContent = React.memo(function McpCardContent({
  server,
  tools,
  loading,
  selected,
  selectable,
  toolsReadOnly,
  resolvedPackageVersions,
  enterDelay,
  onSelectChange,
  onEdit,
  onEditMetadata,
  onDelete,
  onToggleTool,
  dragHandle,
  containerRef,
  containerStyle,
}: McpCardContentProps) {
  const { t } = useTranslation();
  const { position, openMenu, closeMenu } = useContextMenu();

  const copyText = React.useCallback(async (text: string, successKey: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(t(successKey));
    } catch {
      message.error(t('common.error'));
    }
  }, [t]);

  const contextItems = React.useMemo<import('@/components/common/ContextMenu').ContextMenuItem[]>(() => {
    const shellQuote = (part: string) => (
      /\s/.test(part) && !/^["'].*["']$/.test(part)
        ? `"${part.replace(/"/g, '\\"')}"`
        : part
    );
    const command = server.server_type === 'stdio'
      ? (() => {
        const config = server.server_config as { command?: string; args?: string[] };
        return [config.command, ...(config.args ?? [])]
          .filter((part): part is string => Boolean(part))
          .map(shellQuote)
          .join(' ')
          .trim();
      })()
      : (server.server_config as { url?: string })?.url ?? '';

    return [
      {
        key: 'edit',
        label: t('common.edit'),
        icon: <Pencil size={13} />,
        onClick: () => onEdit(server),
      },
      {
        key: 'metadata',
        label: t('mcp.context.editMetadata'),
        icon: <Tags size={13} />,
        onClick: () => onEditMetadata(server),
      },
      {
        key: 'copy-name',
        label: t('mcp.context.copyName'),
        icon: <Copy size={13} />,
        onClick: () => void copyText(server.name, 'common.copy'),
      },
      {
        key: 'copy-command',
        label: t('mcp.context.copyCommand'),
        icon: <Terminal size={13} />,
        disabled: !command,
        onClick: () => void copyText(command, 'common.copy'),
      },
      {
        key: 'delete',
        label: t('common.delete'),
        icon: <Trash2 size={13} />,
        danger: true,
        onClick: () => onDelete(server.id),
      },
    ];
  }, [copyText, onDelete, onEdit, onEditMetadata, server, t]);

  const iconNode = React.useMemo(() => (
    server.server_type === 'stdio' ? (
      <Code2 size={18} className={styles.icon} />
    ) : (
      <Globe2 size={18} className={styles.icon} />
    )
  ), [server.server_type]);

  // Config summary only depends on the current server definition.
  // Memoizing keeps repeated card renders from recalculating the same display string.
  const configSummary = React.useMemo(() => {
    if (server.server_type === 'stdio') {
      const config = server.server_config as { command?: string };
      return config.command || 'stdio';
    }
    const config = server.server_config as { url?: string };
    return config.url || 'http';
  }, [server.server_config, server.server_type]);

  const packageVersion = React.useMemo(
    () => (server.server_type === 'stdio' ? getMcpCommandPackageVersion(server.server_config) : null),
    [server.server_config, server.server_type],
  );

  const packageVersionDisplayText = React.useMemo(() => {
    if (!packageVersion) {
      return null;
    }
    if (packageVersion.versionLabel !== 'latest') {
      return packageVersion.displayText;
    }

    const resolvedVersion = resolvedPackageVersions?.[
      getMcpCommandPackageVersionKey(packageVersion.manager, packageVersion.packageName)
    ];
    if (!resolvedVersion) {
      return null;
    }

    return formatMcpCommandPackageVersionLabel(resolvedVersion);
  }, [packageVersion, resolvedPackageVersions]);

  const displayNote = React.useMemo(() => getMcpDisplayNote(server), [server]);

  const handleReadOnlyToolClick = React.useCallback(() => {
    message.info(t('mcp.groupTools.cardToolReadOnly'));
  }, [t]);

  // These tool collections are pure derived data from the server/tool definitions.
  // Memoizing them reduces repeated filtering/sorting work across large card lists.
  const enabledToolKeys = React.useMemo(
    () => new Set(server.enabled_tools),
    [server.enabled_tools],
  );

  const enabledTools = React.useMemo(
    () => tools.filter((tool) => enabledToolKeys.has(tool.key)),
    [enabledToolKeys, tools],
  );

  const actionItems = React.useMemo<ManagementMenuItem[]>(
    () => [
      {
        key: 'metadata',
        icon: <Tags size={14} />,
        label: t('mcp.metadata.edit'),
        onSelect: () => onEditMetadata(server),
      },
      {
        key: 'delete',
        danger: true,
        icon: <Trash2 size={14} />,
        label: t('mcp.delete'),
        onSelect: () => onDelete(server.id),
      },
    ],
    [onDelete, onEditMetadata, server, t],
  );

  return (
    <ManagementCard
      containerRef={containerRef}
      containerStyle={containerStyle}
      selected={selected}
      selectable={selectable}
      enterDelay={enterDelay}
      onContextMenu={openMenu}
    >
      {selectable && (
        <ManagementCardCheckboxArea>
          <ManagementCheckbox
            ariaLabel={`${t('common.select')} ${server.name}`}
            checked={!!selected}
            onChange={(checked) => onSelectChange?.(server.id, checked)}
          />
        </ManagementCardCheckboxArea>
      )}
      {dragHandle}
      <ManagementCardIcon icon={iconNode} />
      <ManagementCardMain>
        <ManagementCardHeader
          title={server.name}
          minWidth={92}
          meta={
            <span className={styles.headerMetaInline}>
              <span className={styles.typeTag}>{server.server_type}</span>
              <span className={styles.configSummary} title={configSummary}>{configSummary}</span>
              {packageVersion && packageVersionDisplayText && (
                <span
                  className={styles.packageVersionTag}
                  title={`${packageVersion.manager}: ${packageVersion.packageName}@${packageVersionDisplayText}`}
                >
                  {packageVersionDisplayText}
                </span>
              )}
            </span>
          }
        />
        {(server.user_group || displayNote) && (
          <ManagementCardMetaRow>
            {server.user_group && (
              <span className={styles.groupTag} title={server.user_group}>{server.user_group}</span>
            )}
            {displayNote && (
              <span className={styles.note} title={displayNote}>{displayNote}</span>
            )}
          </ManagementCardMetaRow>
        )}
        <ManagementCardToolMatrix>
          {enabledTools.map((tool) => {
            const syncDetail = server.sync_details.find((d) => d.tool === tool.key);
            const status = syncDetail?.status || 'pending';
            return (
              <button
                key={`${server.id}-${tool.key}`}
                title={`${tool.display_name} - ${status}`}
                type="button"
                className={`${styles.toolPill} ${styles.active} ${status === 'error' ? styles.error : ''}${toolsReadOnly ? ` ${styles.readOnlyTool}` : ''}`}
                onClick={toolsReadOnly ? handleReadOnlyToolClick : () => onToggleTool(server.id, tool.key)}
                disabled={loading}
                aria-disabled={toolsReadOnly || loading}
              >
                <span className={`${styles.statusBadge} ${styles[status]}`} />
                {tool.display_name}
              </button>
            );
          })}
        </ManagementCardToolMatrix>
      </ManagementCardMain>
      <ManagementCardActions>
        <ManagementMenu
          items={actionItems}
          disabled={loading}
          title={t('mcp.more')}
          controlSize="compact"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </ManagementMenu>
        <ManagementIconButton
          icon={<Pencil size={15} aria-hidden="true" />}
          onClick={() => onEdit(server)}
          disabled={loading}
          title={t('mcp.editServer')}
          controlSize="compact"
        />
      </ManagementCardActions>
      {position ? (
        <ContextMenu position={position} items={contextItems} onClose={closeMenu} />
      ) : null}
    </ManagementCard>
  );
});

const SortableMcpCard: React.FC<Omit<McpCardProps, 'dragDisabled'>> = (props) => {
  const {
    server,
  } = props;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: server.id });

  const sortableStyle: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <McpCardContent
      {...props}
      containerRef={setNodeRef}
      containerStyle={sortableStyle}
      dragHandle={(
        <ManagementCardDragHandle
          {...attributes}
          listeners={listeners}
        />
      )}
    />
  );
};

export const McpCard = React.memo(function McpCard({
  dragDisabled,
  ...props
}: McpCardProps) {
  if (dragDisabled) {
    return <McpCardContent {...props} />;
  }

  return <SortableMcpCard {...props} />;
});

export default McpCard;
