import React from 'react';
import { Empty } from 'antd';
import type { TFunction } from 'i18next';

import type { SessionMessage } from '../types';
import type { SessionContentFilter } from './domain/messageFilters';
import type { SessionDisplayRow } from './domain/messageFlatten';
import SessionMessageCard from './SessionMessageCard';
import styles from './SessionDetailWorkbench.module.less';

interface SessionMessageViewerProps {
  rows: SessionDisplayRow[];
  activeMessageIndex: number | null;
  query: string;
  contentFilter: SessionContentFilter;
  assistantLabel: string;
  t: TFunction;
  viewerRef: React.RefObject<HTMLDivElement | null>;
  onCopyText: (text: string, successText: string) => void | Promise<void>;
  onContentLayoutChange: () => void;
  onReachEnd?: () => void;
  setMessageRef: (index: number, node: HTMLElement | null) => void;
  setTargetRef: (targetId: string, node: HTMLElement | null) => void;
}

/** Rows below this distance (px) from the viewport bottom trigger a render batch. */
const REACH_END_THRESHOLD = 600;

const SessionMessageViewer: React.FC<SessionMessageViewerProps> = ({
  rows,
  activeMessageIndex,
  query,
  contentFilter,
  assistantLabel,
  t,
  viewerRef,
  onCopyText,
  onContentLayoutChange,
  onReachEnd,
  setMessageRef,
  setTargetRef,
}) => {
  const reachEndFrameRef = React.useRef<number | null>(null);

  React.useEffect(() => () => {
    if (reachEndFrameRef.current !== null) {
      window.cancelAnimationFrame(reachEndFrameRef.current);
    }
  }, []);

  const handleScroll = React.useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget;
    const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    if (distanceToBottom <= REACH_END_THRESHOLD) {
      if (reachEndFrameRef.current === null) {
        reachEndFrameRef.current = window.requestAnimationFrame(() => {
          reachEndFrameRef.current = null;
          onReachEnd?.();
        });
      }
    }
  }, [onReachEnd]);

  if (rows.length === 0) {
    return (
      <div className={styles.viewerEmpty}>
        <Empty description={t('sessionManager.noMessagesMatched')} />
      </div>
    );
  }

  return (
    <div
      ref={viewerRef}
      className={styles.messageViewer}
      onClickCapture={onContentLayoutChange}
      onKeyUpCapture={onContentLayoutChange}
      onScroll={handleScroll}
    >
      {rows.map((row) => {
        if (row.type === 'date') {
          return (
            <div key={row.id} className={styles.dateDivider}>
              <span>{row.label}</span>
            </div>
          );
        }

        return (
          <SessionMessageCard
            key={row.id}
            message={row.message as SessionMessage}
            index={row.index}
            active={activeMessageIndex === row.index}
            query={query}
            contentFilter={contentFilter}
            assistantLabel={assistantLabel}
            t={t}
            onCopyText={onCopyText}
            onContentLayoutChange={onContentLayoutChange}
            setMessageRef={setMessageRef}
            setTargetRef={setTargetRef}
          />
        );
      })}
    </div>
  );
};

export default React.memo(SessionMessageViewer);
