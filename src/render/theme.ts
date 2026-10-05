export interface HighwayTheme {
  readonly background: string;
  readonly laneLine: string;
  readonly strikeline: string;
  readonly barLine: string;
  readonly barLabel: string;
  readonly noteText: string;
  /** Brighter than `barLine`: the line at the start of each bar. */
  readonly measureLine: string;
  /** Faint line on each beat inside a bar. */
  readonly beatLine: string;
  /** Decorative dots between the middle strings. */
  readonly inlay: string;
  /** Rim of a note gem. */
  readonly gemBorder: string;
  /** Fill per string, index 0 is the highest-pitched string. */
  readonly stringColors: readonly string[];
}

export const DEFAULT_THEME: HighwayTheme = {
  background: '#0c0a1c',
  laneLine: '#3a3f4c',
  strikeline: '#f2f2f2',
  barLine: '#2a2e38',
  barLabel: '#9aa1b3',
  noteText: '#0b0a16',
  measureLine: '#8a82c4',
  beatLine: '#ffffff',
  inlay: '#3a3068',
  gemBorder: '#ffffff',
  // High e to low E: purple, orange, blue, yellow, red, green.
  stringColors: ['#c58bff', '#ff9a3c', '#4aa8ff', '#ffd23f', '#ff5d6c', '#4ade80'],
};

export function stringColor(theme: HighwayTheme, string: number): string {
  const colors = theme.stringColors;
  return colors[(string - 1) % colors.length] ?? '#ffffff';
}

/** The string colour mixed toward black, for the underside of a gem. */
export function stringShade(theme: HighwayTheme, string: number): string {
  const hex = stringColor(theme, string);
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const channel = (i: number) => Math.round(parseInt(m[i], 16) * 0.55);
  return `rgb(${channel(1)}, ${channel(2)}, ${channel(3)})`;
}
