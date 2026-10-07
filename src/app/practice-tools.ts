export type ToolId = 'loop' | 'sections' | 'recording' | 'stems' | 'alignment';

export const TOOL_NAMES: Record<ToolId, string> = {
  loop: 'Loop',
  sections: 'Sections',
  recording: 'Recording',
  stems: 'Stems',
  alignment: 'Alignment',
};

/** Which practice tools have something to show: stems need the desktop app, sections and alignment need a recording or stems, and sections need some found. */
export function availableTools(flags: { hasAudioSource: boolean; hasSections: boolean; desktop: boolean }): ToolId[] {
  const tools: ToolId[] = ['loop'];
  if (flags.hasAudioSource && flags.hasSections) tools.push('sections');
  tools.push('recording');
  if (flags.desktop) tools.push('stems');
  if (flags.hasAudioSource) tools.push('alignment');
  return tools;
}

/** The tool to show: the one asked for if it is still available, else the first. */
export function currentTool(wanted: ToolId, available: readonly ToolId[]): ToolId {
  return available.includes(wanted) ? wanted : available[0];
}
