import { invoke } from '@tauri-apps/api/core';

export type CaptureSource = {
  id: string;
  title: string;
  process_name: string | null;
  pid: number | null;
  width: number | null;
  height: number | null;
  minimized: boolean;
  thumbnail: string | null;
};

export type Trial = {
  encoder: string;
  resolution: string;
  target_fps: number;
  ok: boolean;
  fps?: number;
  encoder_load_percent?: number;
};

export type StreamEvent = {
  id: string;
  event: 'started' | 'stats' | 'stopped' | 'error';
  reason?: string;
};

export const listSources = () => invoke<CaptureSource[]>('listar_fontes');
export const testMachine = (force = false) => invoke<{ trials: Trial[] }>('testar_maquina', { force });
export const stopTransmission = (id: string) => invoke('parar_transmissao', { id });
