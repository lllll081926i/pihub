import React from 'react';
import { Drawer } from 'antd';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { TFunction } from 'i18next';

import type { SessionDetail, SessionSubagentMeta } from '../types';
import {
  DEFAULT_SESSION_CONTENT_FILTER,
  DEFAULT_SESSION_ROLE_FILTER,
  filterSessionMessages,
  type SessionContentFilter,
  type SessionContentFilterKey,
  type SessionRoleFilter,
  type SessionRoleFilterKey,
} from './domain/messageFilters';
import { flattenMessagesWithDateDividers } from './domain/messageFlatten';
import {
  buildNavigatorEntriesFromItems,
  type SessionNavigatorEntry,
} from './domain/messageNavigator';
import {
  getActiveMatchPosition,
  getNextMatchOffset,
  getPreviousMatchOffset,
  getVisibleMatchedMessageIndexes,
  NO_ACTIVE_MATCH_OFFSET,
} from './domain/messageSearchNavigation';
import { getMessageTargetId } from './domain/messageTargets';
import { preloadMarkdownPreview } from '@/components/common/lazyMarkdown';
import type { SessionSearchScope } from './domain/messageSearch';
import { enrichSessionMessagesWithToolExecutions } from './domain/toolPairing';
import SessionDetailCommandBar from './SessionDetailCommandBar';
import SessionDetailStatusBar from './SessionDetailStatusBar';
import SessionMessageNavigator from './SessionMessageNavigator';
import SessionMessageViewer from './SessionMessageViewer';
import SessionSubagentPanel from './SessionSubagentPanel';
import styles from './SessionDetailWorkbench.module.less';

interface SessionDetailWorkbenchProps {
  detail: SessionDetail;
  subagents: SessionSubagentMeta[];
  isSubagentDetail: boolean;
  exporting: boolean;
  canRename: boolean;
  canExport: boolean;
  canDelete: boolean;
  t: TFunction;
  onRename: () => void;
  onExport: () => void;
  onDelete: () => void;
  onOpenSubagent: (subagent: SessionSubagentMeta) => void;
  onBackToParent: () => void;
  onCopyText: (text: string, successText: string) => void | Promise<void>;
}

// Process-lifetime memory shared across all tools' session detail pages.
// Survives workbench remount when switching sessions; resets only on app restart.
let rememberedSessionRoleFilter: SessionRoleFilter = { ...DEFAULT_SESSION_ROLE_FILTER };
let rememberedSessionContentFilter: SessionContentFilter = { ...DEFAULT_SESSION_CONTENT_FILTER };

// Progressive rendering: long sessions render in batches as the user scrolls
// instead of mounting every message block up front.
const INITIAL_RENDER_LIMIT = 60;
const RENDER_STEP = 40;
const RENDER_LOOKAHEAD = 40;

const SessionDetailWorkbench: React.FC<SessionDetailWorkbenchProps> = ({
  detail,
  subagents,
  isSubagentDetail,
  exporting,
  canRename,
  canExport,
  canDelete,
  t,
  onRename,
  onExport,
  onDelete,
  onOpenSubagent,
  onBackToParent,
  onCopyText,
}) => {
  const [query, setQuery] = React.useState('');
  const deferredQuery = React.useDeferredValue(query);
  const [roleFilter, setRoleFilter] = React.useState<SessionRoleFilter>(
    () => ({ ...rememberedSessionRoleFilter }),
  );
  const [contentFilter, setContentFilter] = React.useState<SessionContentFilter>(
    () => ({ ...rememberedSessionContentFilter }),
  );
  const [searchScope, setSearchScope] = React.useState<SessionSearchScope>('content');
  const [activeMessageIndex, setActiveMessageIndex] = React.useState<number | null>(null);
  const [activeMatchOffset, setActiveMatchOffset] = React.useState(NO_ACTIVE_MATCH_OFFSET);
  const [navigatorDrawerOpen, setNavigatorDrawerOpen] = React.useState(false);
  const [navigatorCollapsed, setNavigatorCollapsed] = React.useState(false);
  const [scrollControls, setScrollControls] = React.useState({
    canScrollUp: false,
    canScrollDown: false,
  });
  const [renderLimit, setRenderLimit] = React.useState(INITIAL_RENDER_LIMIT);
  const messageRefs = React.useRef<Map<number, HTMLElement>>(new Map());
  const targetRefs = React.useRef<Map<string, HTMLElement>>(new Map());
  const searchInputRef = React.useRef<import('antd').InputRef | null>(null);
  const scrollRetryTimeoutRef = React.useRef<number | null>(null);
  const viewerRef = React.useRef<HTMLDivElement | null>(null);
  const scrollControlsFrameRef = React.useRef<number | null>(null);
  const assistantLabel = getAssistantLabel(detail.meta.providerId);

  // Warm the markdown chunk while the workbench mounts so the first markdown
  // message renders without a Suspense hitch.
  React.useEffect(() => {
    preloadMarkdownPreview();
  }, []);

  React.useEffect(() => {
    // Keep role/content filter chips across sessions; only reset session-local UI state.
    setQuery('');
    setSearchScope('content');
    setActiveMessageIndex(null);
    setActiveMatchOffset(NO_ACTIVE_MATCH_OFFSET);
    setNavigatorDrawerOpen(false);
    setNavigatorCollapsed(false);
    viewerRef.current?.scrollTo({ top: 0 });
  }, [detail.meta.sourcePath]);

  React.useEffect(() => () => {
    messageRefs.current.clear();
    targetRefs.current.clear();
    if (scrollRetryTimeoutRef.current !== null) {
      window.clearTimeout(scrollRetryTimeoutRef.current);
      scrollRetryTimeoutRef.current = null;
    }
  }, []);

  const visibleMessages = React.useMemo(() => {
    if (isSubagentDetail) {
      return detail.messages;
    }
    return detail.messages.filter((message) => !message.isSidechain);
  }, [detail.messages, isSubagentDetail]);

  const displayMessages = React.useMemo(
    () => enrichSessionMessagesWithToolExecutions(visibleMessages),
    [visibleMessages],
  );

  const filteredItems = React.useMemo(() => filterSessionMessages(displayMessages, {
    query: deferredQuery,
    roleFilter,
    contentFilter,
    searchScope,
  }), [contentFilter, deferredQuery, displayMessages, roleFilter, searchScope]);

  const rows = React.useMemo(() => flattenMessagesWithDateDividers(filteredItems), [filteredItems]);
  const renderRows = React.useMemo(() => rows.slice(0, renderLimit), [renderLimit, rows]);
  const navigatorEntries = React.useMemo(
    () => buildNavigatorEntriesFromItems(filteredItems, deferredQuery, searchScope),
    [deferredQuery, filteredItems, searchScope],
  );
  const matchedMessageIndexes = React.useMemo(
    () => getVisibleMatchedMessageIndexes(filteredItems, deferredQuery, searchScope),
    [deferredQuery, filteredItems, searchScope],
  );
  const visibleMessageByIndex = React.useMemo(() => {
    return new Map(filteredItems.map(({ message, index }) => [index, message]));
  }, [filteredItems]);

  React.useEffect(() => {
    setActiveMatchOffset(NO_ACTIVE_MATCH_OFFSET);
    setActiveMessageIndex(null);
  }, [query, roleFilter, contentFilter, searchScope]);

  // Reset progressive rendering whenever the visible set changes (session switch,
  // search/filter changes). After a filter is active the row count is usually
  // small, so render everything immediately.
  React.useEffect(() => {
    setRenderLimit(rows.length <= INITIAL_RENDER_LIMIT ? rows.length : INITIAL_RENDER_LIMIT);
  }, [contentFilter, detail.meta.sourcePath, query, roleFilter, rows.length, searchScope]);

  const handleReachEnd = React.useCallback(() => {
    setRenderLimit((current) => Math.min(rows.length, Math.max(current, INITIAL_RENDER_LIMIT) + RENDER_STEP));
  }, [rows.length]);

  const toggleRoleFilter = React.useCallback((key: SessionRoleFilterKey) => {
    setRoleFilter((current) => {
      const next = {
        ...current,
        [key]: !current[key],
      };
      rememberedSessionRoleFilter = next;
      return next;
    });
  }, []);

  const toggleContentFilter = React.useCallback((key: SessionContentFilterKey) => {
    setContentFilter((current) => {
      const next = {
        ...current,
        [key]: !current[key],
      };
      rememberedSessionContentFilter = next;
      return next;
    });
  }, []);

  const updateScrollControls = React.useCallback(() => {
    const node = viewerRef.current;
    if (!node) {
      setScrollControls((current) => (
        current.canScrollUp || current.canScrollDown
          ? { canScrollUp: false, canScrollDown: false }
          : current
      ));
      return;
    }

    const scrollThreshold = 8;
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    const nextControls = {
      canScrollUp: node.scrollTop > scrollThreshold,
      canScrollDown: node.scrollTop < maxScrollTop - scrollThreshold,
    };

    setScrollControls((current) => (
      current.canScrollUp === nextControls.canScrollUp && current.canScrollDown === nextControls.canScrollDown
        ? current
        : nextControls
    ));
  }, []);

  const scheduleScrollControlsUpdate = React.useCallback(() => {
    if (scrollControlsFrameRef.current !== null) {
      window.cancelAnimationFrame(scrollControlsFrameRef.current);
    }

    scrollControlsFrameRef.current = window.requestAnimationFrame(() => {
      scrollControlsFrameRef.current = null;
      updateScrollControls();
    });
  }, [updateScrollControls]);

  React.useEffect(() => {
    const node = viewerRef.current;
    if (!node) {
      updateScrollControls();
      return undefined;
    }

    updateScrollControls();
    const handleScroll = () => scheduleScrollControlsUpdate();
    node.addEventListener('scroll', handleScroll, { passive: true });

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleScrollControlsUpdate);
    resizeObserver?.observe(node);

    const animationFrame = window.requestAnimationFrame(scheduleScrollControlsUpdate);
    return () => {
      node.removeEventListener('scroll', handleScroll);
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(animationFrame);
      if (scrollControlsFrameRef.current !== null) {
        window.cancelAnimationFrame(scrollControlsFrameRef.current);
        scrollControlsFrameRef.current = null;
      }
    };
  }, [navigatorCollapsed, renderRows.length, scheduleScrollControlsUpdate, updateScrollControls]);

  const scrollToTarget = React.useCallback((targetId: string, index: number) => {
    const node = targetRefs.current.get(targetId) ?? messageRefs.current.get(index);
    const viewer = viewerRef.current;
    setActiveMessageIndex(index);
    setNavigatorDrawerOpen(false);

    if (!node) {
      // The target row is outside the progressive-render window. Render far
      // enough to include it, then retry once so search navigation works
      // regardless of how deep the match sits in a long session. Cancel any
      // pending retry so rapid F3 navigation cannot stack stale timeouts.
      if (scrollRetryTimeoutRef.current !== null) {
        window.clearTimeout(scrollRetryTimeoutRef.current);
      }
      setRenderLimit((current) => Math.max(current, index + RENDER_LOOKAHEAD + 1));
      scrollRetryTimeoutRef.current = window.setTimeout(() => {
        scrollRetryTimeoutRef.current = null;
        const retryNode = targetRefs.current.get(targetId) ?? messageRefs.current.get(index);
        if (retryNode && viewerRef.current) {
          alignTargetInViewer(retryNode, viewerRef.current, scheduleScrollControlsUpdate);
        }
      }, 120);
      return;
    }

    if (!viewer) {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    alignTargetInViewer(node, viewer, scheduleScrollControlsUpdate);
  }, [scheduleScrollControlsUpdate]);

  const scrollToMessage = React.useCallback((index: number) => {
    const message = visibleMessageByIndex.get(index) ?? displayMessages[index];
    if (!message) {
      return;
    }
    scrollToTarget(getMessageTargetId(message, index), index);
  }, [displayMessages, scrollToTarget, visibleMessageByIndex]);

  const scrollToNavigatorEntry = React.useCallback((entry: SessionNavigatorEntry) => {
    scrollToTarget(entry.targetId, entry.messageIndex);
  }, [scrollToTarget]);

  const handleNextMatch = () => {
    if (matchedMessageIndexes.length === 0) {
      return;
    }
    const nextOffset = getNextMatchOffset(activeMatchOffset, matchedMessageIndexes.length);
    setActiveMatchOffset(nextOffset);
    scrollToMessage(matchedMessageIndexes[nextOffset]);
  };

  const handlePreviousMatch = () => {
    if (matchedMessageIndexes.length === 0) {
      return;
    }
    const nextOffset = getPreviousMatchOffset(activeMatchOffset, matchedMessageIndexes.length);
    setActiveMatchOffset(nextOffset);
    scrollToMessage(matchedMessageIndexes[nextOffset]);
  };

  const setMessageRef = React.useCallback((index: number, node: HTMLElement | null) => {
    if (node) {
      messageRefs.current.set(index, node);
      return;
    }
    messageRefs.current.delete(index);
  }, []);

  const setTargetRef = React.useCallback((targetId: string, node: HTMLElement | null) => {
    if (node) {
      targetRefs.current.set(targetId, node);
      return;
    }
    targetRefs.current.delete(targetId);
  }, []);

  const scrollViewerTo = (position: 'top' | 'bottom') => {
    const node = viewerRef.current;
    if (!node) {
      return;
    }
    node.scrollTo({
      top: position === 'top' ? 0 : node.scrollHeight,
      behavior: 'smooth',
    });
  };
  const showScrollControls = scrollControls.canScrollUp || scrollControls.canScrollDown;

  // Keyboard shortcuts: Cmd/Ctrl+F focuses the search box; F3 / Shift+F3 step
  // through matches (Enter inside the search box does the same).
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const withModifier = event.metaKey || event.ctrlKey;
      if (withModifier && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === 'F3') {
        event.preventDefault();
        if (event.shiftKey) {
          handlePreviousMatch();
        } else {
          handleNextMatch();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleNextMatch, handlePreviousMatch]);

  return (
    <div className={`${styles.workbench}${navigatorCollapsed ? ` ${styles.workbenchNavigatorCollapsed}` : ''}`}>
      <SessionDetailCommandBar
        query={query}
        roleFilter={roleFilter}
        contentFilter={contentFilter}
        searchScope={searchScope}
        totalCount={displayMessages.length}
        visibleCount={filteredItems.length}
        matchCount={matchedMessageIndexes.length}
        activeMatchPosition={getActiveMatchPosition(activeMatchOffset, matchedMessageIndexes.length)}
        canRename={canRename}
        canExport={canExport}
        canDelete={canDelete}
        exporting={exporting}
        hasResumeCommand={Boolean(detail.meta.resumeCommand)}
        isSubagentDetail={isSubagentDetail}
        subagentTitle={detail.meta.title || detail.meta.summary || detail.meta.sessionId}
        t={t}
        onQueryChange={setQuery}
        onRoleFilterToggle={toggleRoleFilter}
        onContentFilterToggle={toggleContentFilter}
        onSearchScopeChange={setSearchScope}
        onPreviousMatch={handlePreviousMatch}
        searchInputRef={searchInputRef}
        onNextMatch={handleNextMatch}
        onRename={onRename}
        onExport={onExport}
        onCopyResume={() => {
          if (detail.meta.resumeCommand) {
            void onCopyText(detail.meta.resumeCommand, t('sessionManager.copyResumeSuccess'));
          }
        }}
        onDelete={onDelete}
        onBackToParent={onBackToParent}
        onShowNavigator={() => setNavigatorDrawerOpen(true)}
      />

      {!isSubagentDetail ? (
        <SessionSubagentPanel
          subagents={subagents}
          t={t}
          onSelect={onOpenSubagent}
        />
      ) : null}

      <main className={styles.workbenchMain}>
        <div className={styles.messageViewerShell}>
          <SessionMessageViewer
            rows={renderRows}
            activeMessageIndex={activeMessageIndex}
            query={deferredQuery}
            contentFilter={contentFilter}
            assistantLabel={assistantLabel}
            t={t}
            viewerRef={viewerRef}
            onCopyText={onCopyText}
            onContentLayoutChange={scheduleScrollControlsUpdate}
            onReachEnd={handleReachEnd}
            setMessageRef={setMessageRef}
            setTargetRef={setTargetRef}
          />
          {showScrollControls ? (
            <div className={styles.scrollControls}>
              {scrollControls.canScrollUp ? (
                <button
                  type="button"
                  className={styles.scrollControlButton}
                  onClick={() => scrollViewerTo('top')}
                  title={t('sessionManager.scrollToTop')}
                  aria-label={t('sessionManager.scrollToTop')}
                >
                  <ChevronUp size={13} aria-hidden="true" />
                </button>
              ) : null}
              {scrollControls.canScrollDown ? (
                <button
                  type="button"
                  className={styles.scrollControlButton}
                  onClick={() => scrollViewerTo('bottom')}
                  title={t('sessionManager.scrollToBottom')}
                  aria-label={t('sessionManager.scrollToBottom')}
                >
                  <ChevronDown size={13} aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <SessionMessageNavigator
          entries={navigatorEntries}
          activeMessageIndex={activeMessageIndex}
          collapsed={navigatorCollapsed}
          t={t}
          onSelect={scrollToNavigatorEntry}
          onToggleCollapse={() => setNavigatorCollapsed((current) => !current)}
        />
      </main>

      <SessionDetailStatusBar
        detail={detail}
        visibleCount={filteredItems.length}
        totalCount={displayMessages.length}
        t={t}
      />

      <Drawer
        open={navigatorDrawerOpen}
        onClose={() => setNavigatorDrawerOpen(false)}
        title={null}
        placement="right"
        width={320}
        closable={false}
        className={styles.navigatorDrawer}
      >
        <SessionMessageNavigator
          entries={navigatorEntries}
          activeMessageIndex={activeMessageIndex}
          t={t}
          onSelect={scrollToNavigatorEntry}
          onToggleCollapse={() => setNavigatorDrawerOpen(false)}
        />
      </Drawer>
    </div>
  );
};

function getAssistantLabel(providerId: SessionDetail['meta']['providerId']): string {
  return providerId === 'pi' ? 'Pi' : 'Assistant';
}

/** Center `node` inside the scrollable `viewer` (smooth, then snapped). */
function alignTargetInViewer(
  node: HTMLElement,
  viewer: HTMLElement,
  scheduleScrollControlsUpdate: () => void,
) {
  const alignMessageInViewer = (behavior: ScrollBehavior) => {
    const viewerRect = viewer.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const nodeTopInViewer = nodeRect.top - viewerRect.top + viewer.scrollTop;
    const centeredTop = nodeTopInViewer - Math.max(0, (viewer.clientHeight - nodeRect.height) / 2);
    const maxScrollTop = Math.max(0, viewer.scrollHeight - viewer.clientHeight);
    viewer.scrollTo({
      top: Math.min(maxScrollTop, Math.max(0, centeredTop)),
      behavior,
    });
  };

  alignMessageInViewer('smooth');
  window.requestAnimationFrame(() => {
    alignMessageInViewer('auto');
    scheduleScrollControlsUpdate();
  });
}

export default SessionDetailWorkbench;
