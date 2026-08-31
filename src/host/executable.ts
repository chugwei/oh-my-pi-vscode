import * as path from 'node:path';

export interface ExecutableDeps {
  existsSync(p: string): boolean;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

/**
 * Resolution order: settings override (must exist) -> %LOCALAPPDATA%\omp\omp.exe (win32)
 * -> bare "omp" (delegated to PATH at spawn time; a PATH miss surfaces as spawn error).
 */
export function resolveOmpExecutable(configured: string | undefined, deps: ExecutableDeps): string {
  const configuredPath = configured?.trim();
  if (configuredPath && configuredPath !== 'omp') {
    if (deps.existsSync(configuredPath)) {
      return configuredPath;
    }
    throw new Error(
      `omp.executablePath points to a file that does not exist: ${configuredPath}`,
    );
  }
  if (deps.platform === 'win32' && deps.env.LOCALAPPDATA) {
    const candidate = path.join(deps.env.LOCALAPPDATA, 'omp', 'omp.exe');
    if (deps.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'omp';
}
