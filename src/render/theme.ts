export interface HighwayTheme {
  readonly background: string;
  readonly laneLine: string;
  readonly strikeline: string;
  readonly barLine: string;
  readonly barLabel: string;
  readonly noteText: string;
  /** Fill per string, index 0 is the highest-pitched string. */
  readonly stringColors: readonly string[];
}

export const DEFAULT_THEME: HighwayTheme = {
  background: '#14161c',
  laneLine: '#3a3f4c',
  strikeline: '#f2f2f2',
  barLine: '#2a2e38',
  barLabel: '#7d8496',
  noteText: '#10131a',
  stringColors: ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#b197fc'],
};

export function stringColor(theme: HighwayTheme, string: number): string {
  const colors = theme.stringColors;
  return colors[(string - 1) % colors.length] ?? '#ffffff';
}
