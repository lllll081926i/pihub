import assert from 'node:assert/strict';
import test from 'node:test';

interface I18nAnalysis {
  expandedDynamicKeyUsages: Array<{ key: string }>;
  missingStaticKeys: unknown[];
  localeMismatches: unknown[];
}

interface TextSearchResult {
  locale: string;
  key: string;
  value: string;
}

const i18nKeysModuleUrl = new URL('../../../scripts/i18n-keys.mjs', import.meta.url);
const i18nKeys = await import(i18nKeysModuleUrl.href) as {
  analyzeProject: () => Promise<I18nAnalysis>;
  findKeysByText: (analysis: I18nAnalysis, query: string) => TextSearchResult[];
};

test('i18n locale files cover statically used translation keys', async () => {
  const analysis = await i18nKeys.analyzeProject();

  assert.deepEqual(analysis.missingStaticKeys, []);
  assert.deepEqual(analysis.localeMismatches, []);
});

test('i18n check expands known dynamic translation key helpers', async () => {
  const analysis = await i18nKeys.analyzeProject();
  const expandedKeys = new Set(analysis.expandedDynamicKeyUsages.map((usage) => usage.key));

  assert.ok(expandedKeys.has('pi.model.id'));
  assert.ok(expandedKeys.has('pi.provider.deleteProvider'));
  assert.ok(expandedKeys.has('pi.prompt.title'));
});

test('i18n text lookup can find translation keys without reading full locale files', async () => {
  const analysis = await i18nKeys.analyzeProject();
  const matches = i18nKeys.findKeysByText(analysis, '供应商列表');

  assert.ok(
    matches.some((match) => (
      match.locale === 'zh-CN'
      && match.key === 'pi.provider.title'
      && match.value === '供应商列表'
    )),
  );
});
