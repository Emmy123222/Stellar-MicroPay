/**
 * i18n regression tests
 * Ensures the standardized translation hook API and provider guard work.
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { I18nProvider, useI18n } from '@/contexts/I18nContext';
import { useTranslation, getTranslations } from '@/lib/i18n';

describe('i18n API', () => {
  it('exposes useTranslation from lib/i18n as a hook', () => {
    expect(typeof useTranslation).toBe('function');
    expect(useTranslation).toBe(useI18n);
  });

  it('keeps translation lookups working', () => {
    expect(getTranslations('en').dashboard.title).toBe('Dashboard');
    expect(getTranslations('es').dashboard.title).toBe('Panel');
  });

  it('types useTranslation as a hook (compile-time check)', () => {
    // @ts-expect-error - useTranslation is a function, not a string.
    const invalidType: string = useTranslation;
    // intentionally unused; the @ts-expect-error above is the check
    void invalidType;
  });

  it('prevents nested translation providers', () => {
    const NestedProvider = () =>
      React.createElement(I18nProvider, null, React.createElement('div'));

    const tree = React.createElement(
      I18nProvider,
      null,
      React.createElement(NestedProvider)
    );

    expect(() => renderToString(tree)).toThrow(/I18nProvider/i);
  });
});
