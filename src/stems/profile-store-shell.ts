import { invokeShell } from '../app/desktop';
import { FileProfileStore, type ProfileFileBackend } from '../audio/recording-profile';

/**
 * The desktop shell keeps profiles in recording-profiles.json in its data folder, a separate file from
 * stem-index.json, so a profile problem can never lose saved stems.
 */
export const shellProfileBackend: ProfileFileBackend = {
  read: () => invokeShell<unknown>('profiles_read'),
  write: (profiles) => invokeShell<void>('profiles_write', { profiles }),
};

export const shellProfileStore = new FileProfileStore(shellProfileBackend);
