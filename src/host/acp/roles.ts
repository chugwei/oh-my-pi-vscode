import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

export interface UserRoleItem {
  id: string;
  name: string;
  model: string;
  thinking: string;
  icon: string;
}

const ROLE_ICONS: Record<string, string> = {
  default: '',
  plan: '',
  designer: '',
  smol: '',
  tiny: '',
  slow: '',
  vision: '',
};

const ROLE_NAMES: Record<string, string> = {
  default: 'Default',
  plan: 'Plan',
  designer: 'Designer',
  smol: 'Smol',
  tiny: 'Tiny',
  slow: 'Slow',
  vision: 'Vision',
};

export class OmpConfigLoader {
  static loadUserRoles(): UserRoleItem[] {
    const homedir = os.homedir();
    const configPath = path.join(homedir, '.omp', 'agent', 'config.yml');
    const roles: UserRoleItem[] = [];

    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf8');
        const lines = content.split(/\r?\n/);
        let inModelRoles = false;

        for (const line of lines) {
          if (/^modelRoles:\s*$/.test(line)) {
            inModelRoles = true;
            continue;
          }
          if (inModelRoles) {
            if (/^[a-zA-Z0-9_-]+:/.test(line) && !line.startsWith('  ')) {
              break; // exit modelRoles block
            }
            const match = /^\s+([a-zA-Z0-9_-]+):\s*([^\s]+)/.exec(line);
            if (match) {
              const roleId = match[1];
              const spec = match[2]; // e.g. "zai/glm-5.3:max" or "google-antigravity/gemini-3.7-flash:high"
              const parts = spec.split(':');
              const model = parts[0];
              const thinking = parts[1] || 'high';

              roles.push({
                id: roleId,
                name: ROLE_NAMES[roleId] || roleId,
                model,
                thinking,
                icon: ROLE_ICONS[roleId] || '',
              });
            }
          }
        }
      } catch {}
    }

    if (roles.length === 0) {
      // Fallback defaults if config.yml is absent
      roles.push(
        { id: 'default', name: 'Default', model: 'zai/glm-5.3', thinking: 'max', icon: '' },
        { id: 'plan', name: 'Plan', model: 'zai/glm-5.3', thinking: 'max', icon: '' },
        { id: 'designer', name: 'Designer', model: 'google-antigravity/gemini-3.7-flash', thinking: 'high', icon: '' },
        { id: 'smol', name: 'Smol', model: 'google-antigravity/gemini-3.7-flash', thinking: 'high', icon: '' },
      );
    }

    return roles;
  }
}
