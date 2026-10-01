import type { PetCommand, PetSnapshot, Settings } from './types';

/**
 * The bridge contract, shared by preload and renderer so `tsc --noEmit` catches
 * any mismatch between what preload exposes and what the renderer expects.
 */
export interface LittlePetApi {
  /** Ask main for the 60 Hz snapshot channel. */
  connect(): void;
  /** Renderer -> main. */
  send(command: PetCommand): void;
  /** One-time bootstrap. */
  init(): Promise<{ settings: Settings; snapshot: PetSnapshot }>;
  /** Internal delivery hook. Not called by the page directly. */
  __deliver(snapshot: PetSnapshot): void;
}

declare global {
  interface Window {
    littlepet: LittlePetApi;
  }
}
