import assert from 'node:assert/strict';
import test from 'node:test';
import type { ComponentType } from 'react';

import {
  getRouteChrome,
  getRouteScrollKey,
  matchRouteEntry,
  normalizeRouteChrome,
} from '../../app/routeMatching.ts';
import type { RouteEntry } from '../../app/routeConfig.ts';

const TestComponent = (() => null) as ComponentType;

test('matchRouteEntry returns the longest route match', () => {
  const routes: RouteEntry[] = [
    { path: '/coding/pi', component: TestComponent },
    {
      path: '/coding/pi/sessions/detail',
      component: TestComponent,
      chrome: { mode: 'secondary', contentPadding: 'compact' },
    },
  ];

  const matched = matchRouteEntry(routes, '/coding/pi/sessions/detail/extra');

  assert.equal(matched?.path, '/coding/pi/sessions/detail');
});

test('matchRouteEntry does not match partial sibling prefixes', () => {
  const routes: RouteEntry[] = [
    { path: '/settings', component: TestComponent },
  ];

  assert.equal(matchRouteEntry(routes, '/settings-panel'), undefined);
});

test('route chrome defaults to the standard app chrome', () => {
  assert.deepEqual(getRouteChrome(undefined), {
    mode: 'default',
    contentPadding: 'default',
  });
});

test('route chrome preserves secondary page metadata', () => {
  const matched = normalizeRouteChrome({
    mode: 'secondary',
    contentPadding: 'compact',
  });

  assert.deepEqual(matched, {
    mode: 'secondary',
    contentPadding: 'compact',
  });
});

test('route scroll key keeps tab pages stable and isolates secondary page queries', () => {
  const parentRoute: RouteEntry = {
    path: '/coding/pi',
    component: TestComponent,
  };
  const secondaryRoute: RouteEntry = {
    path: '/coding/pi/sessions/detail',
    component: TestComponent,
    chrome: { mode: 'secondary' },
  };

  assert.equal(
    getRouteScrollKey(parentRoute, '/coding/pi', '?panel=sessions'),
    '/coding/pi',
  );
  assert.equal(
    getRouteScrollKey(secondaryRoute, '/coding/pi/sessions/detail', '?sourcePath=a'),
    '/coding/pi/sessions/detail?sourcePath=a',
  );
  assert.equal(
    getRouteScrollKey(undefined, '/missing', '?q=1'),
    '/missing?q=1',
  );
});
