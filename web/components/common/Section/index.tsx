import React from 'react';
import { RightOutlined } from '@ant-design/icons';
import styles from './styles.module.less';

export interface SectionProps {
  children: React.ReactNode;
  /** 分区标题 */
  title?: React.ReactNode;
  /** 标题左侧图标 */
  icon?: React.ReactNode;
  /** 标题右侧操作区 */
  extra?: React.ReactNode;
  /** 是否可折叠 */
  collapsible?: boolean;
  /** 默认是否展开（可折叠时有效） */
  defaultExpanded?: boolean;
  /** 展开状态变化回调 */
  onExpandChange?: (expanded: boolean) => void;
  /** 是否显示顶部分隔线 */
  showDivider?: boolean;
  /** 自定义类名 */
  className?: string;
  /** 内容区自定义类名 */
  contentClassName?: string;
  /** 滚动锚点 id */
  id?: string;
}

/**
 * 统一分区组件
 * 提供扁平的分区标题 + 内容布局，替代卡片式分区
 * 支持可折叠、右侧操作区、分隔线
 */
const Section: React.FC<SectionProps> = ({
  children,
  title,
  icon,
  extra,
  collapsible = false,
  defaultExpanded = true,
  onExpandChange,
  showDivider = false,
  className,
  contentClassName,
  id,
}) => {
  const [expanded, setExpanded] = React.useState(defaultExpanded);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [contentHeight, setContentHeight] = React.useState<number | undefined>(
    defaultExpanded ? undefined : 0,
  );

  React.useEffect(() => {
    if (collapsible && contentRef.current) {
      if (expanded) {
        const height = contentRef.current.scrollHeight;
        setContentHeight(height);
        // 动画结束后清除固定高度，让内容自然流动
        const timer = setTimeout(() => setContentHeight(undefined), 200);
        return () => clearTimeout(timer);
      } else {
        // 先设置当前高度，再过渡到 0
        const height = contentRef.current.scrollHeight;
        setContentHeight(height);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => setContentHeight(0));
        });
      }
    }
  }, [expanded, collapsible]);

  const handleToggle = () => {
    if (!collapsible) return;
    const next = !expanded;
    setExpanded(next);
    onExpandChange?.(next);
  };

  const sectionClass = [
    styles.section,
    collapsible && styles.sectionCollapsible,
    className,
  ].filter(Boolean).join(' ');

  const chevronClass = [
    styles.sectionChevron,
    expanded && styles.sectionChevronOpen,
  ].filter(Boolean).join(' ');

  return (
    <div className={sectionClass} id={id}>
      {showDivider && <div className={styles.sectionDivider} />}
      {(title || icon || extra) && (
        <div
          className={styles.sectionHeader}
          onClick={collapsible ? handleToggle : undefined}
          role={collapsible ? 'button' : undefined}
          tabIndex={collapsible ? 0 : undefined}
          onKeyDown={collapsible ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleToggle();
            }
          } : undefined}
          aria-expanded={collapsible ? expanded : undefined}
        >
          {icon && <span className={styles.sectionIcon}>{icon}</span>}
          {title && <h3 className={styles.sectionTitle}>{title}</h3>}
          {extra && <div className={styles.sectionTitleRight}>{extra}</div>}
          {collapsible && (
            <span className={chevronClass}>
              <RightOutlined />
            </span>
          )}
        </div>
      )}
      {collapsible ? (
        <div
          ref={contentRef}
          className={styles.sectionCollapseContent}
          style={{ height: contentHeight }}
        >
          <div className={`${styles.sectionContent} ${contentClassName || ''}`}>
            {children}
          </div>
        </div>
      ) : (
        <div className={`${styles.sectionContent} ${contentClassName || ''}`}>
          {children}
        </div>
      )}
    </div>
  );
};

export default Section;
