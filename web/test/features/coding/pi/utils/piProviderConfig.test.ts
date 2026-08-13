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
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/v1.5'),
    'https://api.example.com/v1.5',
  );
});

test('normalizeProviderBaseUrl keeps a full /models base untouched', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/v1/models'),
    'https://api.example.com/v1/models',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/models'),
    'https://api.example.com/models',
  );
});

test('normalizeProviderBaseUrl applies to openai-responses', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com', 'openai-responses'),
    'https://api.example.com/v1',
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

test('normalizeProviderBaseUrl appends /v1 for anthropic-messages', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.anthropic.com', 'anthropic-messages'),
    'https://api.anthropic.com/v1',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.anthropic.com/v1', 'anthropic-messages'),
    'https://api.anthropic.com/v1',
  );
});

test('normalizeProviderBaseUrl appends /v1beta for google apis', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://generativelanguage.googleapis.com', 'google-generative-ai'),
    'https://generativelanguage.googleapis.com/v1beta',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://example.com', 'google-vertex'),
    'https://example.com/v1beta',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://generativelanguage.googleapis.com/v1beta', 'google-generative-ai'),
    'https://generativelanguage.googleapis.com/v1beta',
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
test('normalizeProviderBaseUrl keeps query strings outside the appended suffix', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/v1?token=x'),
    'https://api.example.com/v1?token=x',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com?token=x'),
    'https://api.example.com/v1?token=x',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/models?alt=json'),
    'https://api.example.com/models?alt=json',
  );
});

test('normalizeProviderBaseUrl keeps fragments after the appended suffix', () => {
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com#frag'),
    'https://api.example.com/v1#frag',
  );
  assert.equal(
    normalizeProviderBaseUrl('https://api.example.com/v1?token=x#frag'),
    'https://api.example.com/v1?token=x#frag',
  );
});
