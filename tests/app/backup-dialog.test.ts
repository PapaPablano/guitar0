import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BackupDialog } from '../../src/app/BackupDialog';

const backUpButton = (html: string) => html.match(/<button[^>]*>Back up now<\/button>/)?.[0] ?? '';

describe('BackupDialog while pending removals commit (R7)', () => {
  it('keeps Back up now disabled until the removals have committed', () => {
    const html = renderToStaticMarkup(createElement(BackupDialog, { onClose: () => undefined, preparing: true }));
    expect(backUpButton(html)).toContain('disabled');
  });

  it('enables Back up now once they have', () => {
    const html = renderToStaticMarkup(createElement(BackupDialog, { onClose: () => undefined, preparing: false }));
    expect(backUpButton(html)).not.toBe('');
    expect(backUpButton(html)).not.toContain('disabled');
  });
});
