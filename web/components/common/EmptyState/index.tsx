import React from 'react';
import styles from './styles.module.less';

export interface EmptyStateProps {
  /** 图标 */
  icon?: React.ReactNode;
  /** 标题 */
  title: string;
  /** 描述文字 */
  description?: string;
  /** 操作按钮 */
  actions?: React.ReactNode;
  /** 紧凑模式 */
  compact?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 空状态组件
 * 提供更好的视觉反馈和引导性
 */
const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actions,
  compact = false,
  className,
}) => {
  const containerClass = [
    styles.emptyState,
    compact && styles.emptyStateCompact,
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={containerClass}>
      {icon && <div className={styles.emptyStateIcon}>{icon}</div>}
      <h3 className={styles.emptyStateTitle}>{title}</h3>
      {description && (
        <p className={styles.emptyStateDescription}>{description}</p>
      )}
      {actions && (
        <div className={styles.emptyStateActions}>{actions}</div>
      )}
    </div>
  );
};

export default EmptyState;
