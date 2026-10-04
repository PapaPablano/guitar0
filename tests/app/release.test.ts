import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { openTabBytes } from '../../src/app/open-file';
import { assessSupport, type SupportEnvironment } from '../../src/app/support';
import { MUSICXML_WITH_TAB } from '../fixtures/fixtures';

const desktop: SupportEnvironment = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130',
  hasAudioContext: true,
  hasAudioWorklet: true,
  hasCanvas: true,
  isPhoneSized: false,
};

describe('openTabBytes', () => {
  it('opens a real MusicXML tab', () => {
    const opened = openTabBytes(new TextEncoder().encode(MUSICXML_WITH_TAB));
    expect(opened.timeline.notesForTrack(0)).toHaveLength(2);
  });

  it('reports a clear error for a file that is not a tab', () => {
    expect(() => openTabBytes(new TextEncoder().encode('just some text, not a tab'))).toThrow(/Could not open that file/);
    expect(() => openTabBytes(new Uint8Array([0, 1, 2, 3]))).toThrow(/Could not open that file/);
  });

  it('reports a clear error for a tab without playable notes', () => {
    const empty = `<?xml version="1.0"?><score-partwise version="3.1"><part-list><score-part id="P1"><part-name>G</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>4</duration><type>whole</type></note></measure></part></score-partwise>`;
    expect(() => openTabBytes(new TextEncoder().encode(empty))).toThrow(/no playable guitar notes/);
  });
});

describe('assessSupport', () => {
  it('accepts a desktop browser silently', () => {
    expect(assessSupport(desktop)).toEqual({ canPractice: true, notice: null });
  });

  it('refuses a browser without audio worklets and says why', () => {
    const result = assessSupport({ ...desktop, hasAudioWorklet: false });
    expect(result.canPractice).toBe(false);
    expect(result.notice).toMatch(/sound/);
  });

  it('warns, but still allows practice, on a phone', () => {
    const result = assessSupport({ ...desktop, isPhoneSized: true });
    expect(result.canPractice).toBe(true);
    expect(result.notice).toMatch(/desktop/);
    expect(assessSupport({ ...desktop, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' }).notice).toMatch(/desktop/);
  });
});

describe('third-party notices', () => {
  it('lists every shipped package and bundled asset', () => {
    const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    for (const name of Object.keys(pkg.dependencies)) expect(notices, name).toContain(name);
    for (const asset of ['scheduler', 'Sonivox', 'Bravura', 'Sample riff']) expect(notices, asset).toContain(asset);
  });

  it('names licences for the entries that need attribution', () => {
    const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
    for (const licence of ['MPL-2.0', 'MIT', 'Apache License 2.0', 'SIL Open Font License']) expect(notices).toContain(licence);
  });
});
