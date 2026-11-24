import { invoke, isTauri } from '@tauri-apps/api/core';

/** The invite lives only in the Windows Credential Manager, never in localStorage. */
export const invite = {
  load: async () => (isTauri() ? invoke<string | null>('invite_load').catch(() => null) : null),
  save: async (value: string) => {
    if (isTauri()) await invoke('invite_save', { value }).catch(() => undefined);
  },
  clear: async () => {
    if (isTauri()) await invoke('invite_clear').catch(() => undefined);
  },
};
