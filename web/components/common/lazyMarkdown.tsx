import React from 'react';

import type { MarkdownPreviewProps } from './MarkdownPreview';

/**
 * Lazy-loaded markdown renderer.
 *
 * `MarkdownPreview` statically pulls in `react-markdown`, `remark-gfm` and
 * `react-syntax-highlighter` (with both Prism themes) — roughly 250 KB of
 * parsed JS. It is only ever rendered inside session details and prompt
 * previews, so it lives in its own chunk, loaded on first markdown mount.
 * Callers that want to avoid a first-scroll Suspense hitch can fire
 * `preloadMarkdownPreview()` when their page mounts.
 */

const MarkdownPreview = React.lazy(() => import('./MarkdownPreview'));

export const LazyMarkdownPreview: React.FC<MarkdownPreviewProps> = (props) => (
  <React.Suspense fallback={<div style={{ minHeight: 24 }} />}>
    <MarkdownPreview {...props} />
  </React.Suspense>
);

/** Warm the markdown chunk in the background (call from page entry points). */
export const preloadMarkdownPreview = (): void => {
  void import('./MarkdownPreview');
};
