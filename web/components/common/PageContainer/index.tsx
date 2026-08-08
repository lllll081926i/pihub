import React from 'react';
import styles from './styles.module.less';

export interface PageContainerProps {
  children: React.ReactNode;
  /** 页面标题 */
  title?: React.ReactNode;
  /** 标题右侧的链接/操作（如文档链接） */
  titleExtra?: React.ReactNode;
  /** 标题下方的副标题/描述 */
  subtitle?: React.ReactNode;
  /** 标题区右侧的操作按钮 */
  headerActions?: React.ReactNode;
  /** 紧凑内边距（用于二级页面） */
  compact?: boolean;
  /** 无内边距（用于完全自定义布局） */
  noPadding?: boolean;
  /** 自定义类名 */
  className?: string;
}

/**
 * 统一页面容器组件
 * 提供一致的页面最大宽度、内边距、标题区样式
 */
const PageContainer: React.FC<PageContainerProps> = ({
  children,
  title,
  titleExtra,
  subtitle,
  headerActions,
  compact = false,
  noPadding = false,
  className,
}) => {
  const containerClass = [
    styles.container,
    compact && styles.containerCompact,
    noPadding && styles.containerNone,
    className,
  ].filter(Boolean).join(' ');

  const hasHeader = title || titleExtra || subtitle || headerActions;

  return (
    <div className={containerClass}>
      {hasHeader && (
        <div className={styles.header}>
          <div className={styles.headerMain}>
            {(title || titleExtra) && (
              <div className={styles.titleRow}>
                {title && <h1 className={styles.title}>{title}</h1>}
                {titleExtra}
              </div>
            )}
            {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          </div>
          {headerActions && (
            <div className={styles.headerActions}>{headerActions}</div>
          )}
        </div>
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
};

export default PageContainer;
