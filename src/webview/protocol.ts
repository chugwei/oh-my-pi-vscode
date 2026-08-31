export interface SessionInfo {
  id: string;
  title: string;
  exited: boolean;
  exitCode: number | null;
  createdAt: number;
}

export interface SnapshotPayload {
  sessions: SessionInfo[];
  activeId: string | null;
  replay: { sessionId: string; data: string }[];
}

export interface ConfigPayload {
  fontFamily: string;
  scrollback: number;
}

/** webview -> extension host */
export type HostMessage =
  | { type: 'ready' }
  | { type: 'new'; args?: string[] }
  | { type: 'input'; sessionId: string; data: string }
  | { type: 'resize'; sessionId: string; cols: number; rows: number }
  | { type: 'close'; sessionId: string }
  | { type: 'switch'; sessionId: string }
  | { type: 'restart'; sessionId: string }
  | { type: 'focus'; value: boolean }
  | { type: 'openSettings' }
  | { type: 'key'; chord: string };

/** extension host -> webview */
export type WebviewMessage =
  | { type: 'snapshot' } & SnapshotPayload
  | { type: 'created'; session: SessionInfo; activeId: string }
  | { type: 'output'; sessionId: string; data: string }
  | { type: 'exit'; sessionId: string; code: number | null }
  | { type: 'closed'; sessionId: string }
  | { type: 'config' } & ConfigPayload
  | { type: 'error'; message: string };
