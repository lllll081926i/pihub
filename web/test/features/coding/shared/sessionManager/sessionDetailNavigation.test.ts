import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSessionDetailPath,
  getSessionDetailRoutePath,
  parseSessionDetailSearchParams,
} from '../../../../../features/coding/shared/sessionManager/sessionDetailNavigation.ts';

test('buildSessionDetailPath encodes Windows source paths in query string', () => {
  const sourcePath = 'D:\\Users\\测试 项目\\session file.jsonl';
  const path = buildSessionDetailPath('pi', sourcePath);
  const url = new URL(path, 'http://localhost');

  assert.equal(url.pathname, '/coding/pi/sessions/detail');
  assert.equal(url.searchParams.get('sourcePath'), sourcePath);
});

test('buildSessionDetailPath keeps source path round-trippable', () => {
  const sourcePath = 'D:\\GitHub\\project\\sessions\\session.jsonl';
  const path = buildSessionDetailPath('pi', sourcePath);
  const parsed = parseSessionDetailSearchParams(new URL(path, 'http://localhost').searchParams);

  assert.deepEqual(parsed, { sourcePath });
});

test('buildSessionDetailPath supports parent and subagent source paths', () => {
  const parentSourcePath = 'D:\\GitHub\\project\\sessions\\parent.jsonl';
  const subagentSourcePath = 'D:\\GitHub\\project\\sessions\\subagents\\child.jsonl';
  const path = buildSessionDetailPath('pi', parentSourcePath, subagentSourcePath);
  const parsed = parseSessionDetailSearchParams(new URL(path, 'http://localhost').searchParams);

  assert.deepEqual(parsed, {
    sourcePath: parentSourcePath,
    subagentSourcePath,
  });
});

test('parseSessionDetailSearchParams rejects missing sourcePath', () => {
  assert.equal(parseSessionDetailSearchParams(new URLSearchParams()), null);
});

test('getSessionDetailRoutePath returns the pi route path', () => {
  assert.equal(getSessionDetailRoutePath('pi'), '/coding/pi/sessions/detail');
});
