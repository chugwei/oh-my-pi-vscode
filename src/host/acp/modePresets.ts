export interface ModePresetItem {
  model?: string;
  thinking?: string;
}

export type ModePresetConfig = Record<string, ModePresetItem>;

export class ModePresetResolver {
  constructor(private readonly getConfig: () => ModePresetConfig) {}

  getPresetForMode(mode: string): ModePresetItem | undefined {
    const cfg = this.getConfig() || {};
    return cfg[mode];
  }
}
