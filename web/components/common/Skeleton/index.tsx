import React from 'react';
import styles from './styles.module.less';

export interface SkeletonProps {
  /** 骨架屏类型 */
  type?: 'card' | 'list' | 'kpi' | 'chart' | 'custom';
  /** 卡片数量（type=card 时有效） */
  cardCount?: number;
  /** 列表项数量（type=list 时有效） */
  listCount?: number;
  /** KPI 数量（type=kpi 时有效） */
  kpiCount?: number;
  /** 网格列数（type=kpi 时有效） */
  gridColumns?: 2 | 3 | 4;
  /** 自定义内容 */
  children?: React.ReactNode;
  /** 自定义类名 */
  className?: string;
}

/**
 * 骨架屏组件
 * 用于替代 Spin 加载状态，提供更好的视觉反馈
 */
const Skeleton: React.FC<SkeletonProps> = ({
  type = 'card',
  cardCount = 3,
  listCount = 5,
  kpiCount = 4,
  gridColumns = 4,
  children,
  className,
}) => {
  const renderCardSkeleton = () => (
    <div className={`${styles.skeleton} ${className || ''}`}>
      {Array.from({ length: cardCount }).map((_, i) => (
        <div key={i} className={styles.skeletonCard}>
          <div className={styles.skeletonAvatar} />
          <div className={styles.skeletonContent}>
            <div className={`${styles.skeletonLine} ${styles.long}`} />
            <div className={`${styles.skeletonLine} ${styles.medium}`} />
            <div className={`${styles.skeletonLine} ${styles.short}`} />
          </div>
        </div>
      ))}
    </div>
  );

  const renderListSkeleton = () => (
    <div className={`${styles.skeleton} ${className || ''}`}>
      {Array.from({ length: listCount }).map((_, i) => (
        <div key={i} className={styles.skeletonListItem}>
          <div className={styles.skeletonListIcon} />
          <div className={styles.skeletonListContent}>
            <div className={`${styles.skeletonLine} ${styles.long}`} />
            <div className={`${styles.skeletonLine} ${styles.short}`} />
          </div>
        </div>
      ))}
    </div>
  );

  const renderKpiSkeleton = () => {
    const gridClass = gridColumns === 2 ? styles.skeletonGrid2
      : gridColumns === 3 ? styles.skeletonGrid3
      : styles.skeletonGrid4;
    return (
      <div className={`${styles.skeletonGrid} ${gridClass} ${className || ''}`}>
        {Array.from({ length: kpiCount }).map((_, i) => (
          <div key={i} className={styles.skeletonKpi}>
            <div className={styles.skeletonKpiLabel} />
            <div className={styles.skeletonKpiValue} />
          </div>
        ))}
      </div>
    );
  };

  const renderChartSkeleton = () => (
    <div className={`${styles.skeleton} ${className || ''}`}>
      <div className={styles.skeletonChart} />
    </div>
  );

  switch (type) {
    case 'card':
      return renderCardSkeleton();
    case 'list':
      return renderListSkeleton();
    case 'kpi':
      return renderKpiSkeleton();
    case 'chart':
      return renderChartSkeleton();
    case 'custom':
    default:
      return <div className={className}>{children}</div>;
  }
};

export default Skeleton;
