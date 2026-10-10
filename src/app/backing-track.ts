import { shouldStartSetup, type EngineView } from './engine-state';

export type BackingMethod = 'file' | 'youtube';

/** The ways to get a backing track: loading a file always; YouTube only in a desktop build that has the option on. */
export function methodsFor(flags: { desktop: boolean; youtube: boolean }): BackingMethod[] {
  return flags.desktop && flags.youtube ? ['file', 'youtube'] : ['file'];
}

/** What choosing a method does: it becomes the chosen method, and YouTube also starts first-time setup when it is needed. */
export function chooseMethod(method: BackingMethod, engine: EngineView): { method: BackingMethod; startSetup: boolean } {
  return { method, startSetup: method === 'youtube' && shouldStartSetup(engine) };
}
