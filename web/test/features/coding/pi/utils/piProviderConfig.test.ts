import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProviderBaseUrl } from '../../../../../features/coding/pi/utils/piProviderConfig.ts';

test('normalizeProviderBaseUrl appends /v1 to OpenAI-compatible base urls', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com'),
    'https://api.example.com/v1',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/'),
    'https://api.example.com/v1',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://openrouter.ai/api'),
    'https://openrouter.ai/api/v1',
  );
});

test('normalizeProviderBaseUrl keeps existing version segments', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/v1'),
    'https://api.example.com/v1',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/v1/'),
    'https://api.example.com/v1',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/v1beta'),
    'https://api.example.com/v1beta',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/api/v1'),
    'https://api.example.com/api/v1',
  );
});

test('normalizeProviderBaseUrl does not rewrite non-OpenAI-compatible apis', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.anthropic.com', 'anthropic'),
    'https://api.anthropic.com',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://generativelanguage.googleapis.com', 'gemini'),
    'https://generativelanguage.googleapis.com',
  );
});

test('normalizeProviderBaseUrl leaves empty and non-http urls unchanged', () => {
  assert.equal(normalizeProviderBaseUrl(''), '');
  assert.equal(normalizeProviderBaseUrl('   '), '');
  assert.equal(
    normalizeProviderBaseUrl('localhost:8080'),
    'localhost:8080',
  );
});
