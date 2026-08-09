import React from 'react';
import { Spin } from 'antd';

import type { JsonEditorProps } from './JsonEditor';
import type { JsoncEditorProps } from './JsoncEditor';
import type { MarkdownEditorProps } from './MarkdownEditor';

/**
 * Lazy-loaded Monaco editor components.
 *
 * The editors statically import `monaco-editor` (~4 MB parsed JS) plus
 * `react-markdown` for the markdown variant. They are only ever rendered inside
 * modals / collapsed sections, so loading them eagerly bloats the startup chunk
 * and slows first paint for no benefit. These wrappers split Monaco (and the
 * markdown renderer) into their own chunks, fetched only when an editor first
 * mounts.
 */

const JsonEditor = React.lazy(() => import('./JsonEditor'));
const JsoncEditor = React.lazy(() => import('./JsoncEditor'));
const MarkdownEditor = React.lazy(() => import('./MarkdownEditor'));

const MonacoFallback: React.FC<{ height?: number | string }> = ({ height }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: height ?? '100%',
      minHeight: 120,
    }}
  >
    <Spin size="small" />
  </div>
);

export const LazyJsonEditor: React.FC<JsonEditorProps> = (props) => (
  <React.Suspense fallback={<MonacoFallback height={props.height} />}>
    <JsonEditor {...props} />
  </React.Suspense>
);

export const LazyJsoncEditor: React.FC<JsoncEditorProps> = (props) => (
  <React.Suspense fallback={<MonacoFallback height={props.height} />}>
    <JsoncEditor {...props} />
  </React.Suspense>
);

export const LazyMarkdownEditor: React.FC<MarkdownEditorProps> = (props) => (
  <React.Suspense fallback={<MonacoFallback height={props.height} />}>
    <MarkdownEditor {...props} />
  </React.Suspense>
);
