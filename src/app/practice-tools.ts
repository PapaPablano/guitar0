import type { AlignStatus } from './auto-align';

export type ToolId = 'loop' | 'sections' | 'backing' | 'alignment';

export const TOOL_NAMES: Record<ToolId, string> = {
  loop: 'Loop',
  sections: 'Sections',
  backing: 'Backing track',
  alignment: 'Alignment',
};

/** Which practice tools have something to show: the backing track is always there, sections and alignment need a recording or stems, and sections need some found. */
export function availableTools(flags: { hasAudioSource: boolean; hasSections: boolean }): ToolId[] {
  const tools: ToolId[] = ['loop'];
  if (flags.hasAudioSource && flags.hasSections) tools.push('sections');
  tools.push('backing');
  if (flags.hasAudioSource) tools.push('alignment');
  return tools;
}

/** The tool to show: the one asked for if it is still available, else the first. */
export function currentTool(wanted: ToolId, available: readonly ToolId[]): ToolId {
  return available.includes(wanted) ? wanted : available[0];
}

/** True when alignment has something the player should see: a result that is not a clean line-up, or a change from detecting again. */
export function alignmentNeedsLook(status: AlignStatus, change: string | null): boolean {
  if (change) return true;
  return status.phase === 'roughly' || status.phase === 'not-found' || status.phase === 'failed' || status.phase === 'kept-previous';
}
