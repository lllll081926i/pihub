import assert from 'node:assert/strict';
import test from 'node:test';

import { buildFetchModelsUrl } from '../../../../components/common/FetchModelsModal/url.ts';

test('buildFetchModelsUrl appends /models for openai compatible', () => {
  assert.equal(
    buildFetchModelsUrl('https://api.example.com/v1', 'openai_compat'),
    'https://api.example.com/v1/models',
  );
  assert.equal(
    buildFetchModelsUrl('https://api.example.com', 'openai_compat'),
    'https://api.example.com/models',
  );
});

test('buildFetchModelsUrl is idempotent when base already ends with /models', () => {
  assert.equal(
    buildFetchModelsUrl('https://api.example.com/v1/models', 'openai_compat'),
    'https://api.example.com/v1/models',
  );
  assert.equal(
    buildFetchModelsUrl('https://api.example.com/models', 'openai_compat'),
    'https://api.example.com/models',
  );
});

test('buildFetchModelsUrl appends /v1/models for anthropic native', () => {
  assert.equal(
    buildFetchModelsUrl('https://api.anthropic.com', 'native', '@ai-sdk/anthropic'),
    'https://api.anthropic.com/v1/models',
  );
  // Base already carrying /v1 must not produce /v1/v1/models
  assert.equal(
    buildFetchModelsUrl('https://api.anthropic.com/v1', 'native', '@ai-sdk/anthropic'),
    'https://api.anthropic.com/v1/models',
  );
  // Base already carrying the full /v1/models path stays as-is
  assert.equal(
    buildFetchModelsUrl('https://api.anthropic.com/v1/models', 'native', '@ai-sdk/anthropic'),
    'https://api.anthropic.com/v1/models',
  );
});

test('buildFetchModelsUrl appends /v1beta/models?key= for google native', () => {
  assert.equal(
    buildFetchModelsUrl(
      'https://generativelanguage.googleapis.com',
      'native',
      '@ai-sdk/google',
      'abc',
    ),
    'https://generativelanguage.googleapis.com/v1beta/models?key=abc',
  );
  assert.equal(
    buildFetchModelsUrl('https://generativelanguage.googleapis.com', 'native', '@ai-sdk/google'),
    'https://generativelanguage.googleapis.com/v1beta/models',
  );
});

test('buildFetchModelsUrl google native does not duplicate a version segment', () => {
  // Base already carrying /v1beta must get /models only, not /v1beta/v1beta/models
  assert.equal(
    buildFetchModelsUrl('https://generativelanguage.googleapis.com/v1beta', 'native', '@ai-sdk/google'),
    'https://generativelanguage.googleapis.com/v1beta/models',
  );
  assert.equal(
    buildFetchModelsUrl('https://generativelanguage.googleapis.com/v1', 'native', '@ai-sdk/google'),
    'https://generativelanguage.googleapis.com/v1/models',
  );
  // Base already carrying the full /models path stays as-is
  assert.equal(
    buildFetchModelsUrl('https://generativelanguage.googleapis.com/v1beta/models', 'native', '@ai-sdk/google', 'abc'),
    'https://generativelanguage.googleapis.com/v1beta/models?key=abc',
  );
});

test('buildFetchModelsUrl keeps query strings after the path suffix', () => {
  assert.equal(
    buildFetchModelsUrl('https://api.example.com/v1?alt=json', 'openai_compat'),
    'https://api.example.com/v1/models?alt=json',
  );
  assert.equal(
    buildFetchModelsUrl(
      'https://generativelanguage.googleapis.com/v1beta?alt=json',
      'native',
      '@ai-sdk/google',
      'abc',
    ),
    'https://generativelanguage.googleapis.com/v1beta/models?alt=json&key=abc',
  );
  // As-is base with query must not re-append a suffix after the query
  assert.equal(
    buildFetchModelsUrl('https://api.example.com/v1/models?alt=json', 'openai_compat'),
    'https://api.example.com/v1/models?alt=json',
  );
});

test('buildFetchModelsUrl trims trailing slashes and empty bases', () => {
  assert.equal(
    buildFetchModelsUrl('https://api.example.com/v1/', 'openai_compat'),
    'https://api.example.com/v1/models',
  );
  assert.equal(buildFetchModelsUrl('', 'openai_compat'), '');
  assert.equal(buildFetchModelsUrl('   ', 'openai_compat'), '');
});
