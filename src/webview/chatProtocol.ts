import type {
  ConfigOption,
  SessionSummary,
  ToolCallPayload,
  PermissionOption,
} from '../host/acp/types.js';

export interface ChatAttachment {
  name: string;
  uri: string;
  kind: 'file' | 'image';
  mimeType?: string;
  content: string; // text or base64
}

export interface ChatMessageItem {
  id: string;
  role: 'user' | 'assistant';
  text?: string;
  thought?: string;
  thoughtDurationSec?: number;
  attachments?: Array<{ name: string; kind: 'file' | 'image' }>;
  toolCalls?: ToolCallPayload[];
  isStreaming?: boolean;
  timestamp: number;
}

/** Webview -> Host */
export type ChatHostMessage =
  | { type: 'ready' }
  | { type: 'newSession' }
  | { type: 'loadSession'; sessionId: string }
  | { type: 'listSessions' }
  | { type: 'setMode'; mode: string }
  | { type: 'setThinking'; thinking: string }
  | { type: 'setModel'; model: string }
  | { type: 'prompt'; text: string; attachments: ChatAttachment[] }
  | { type: 'cancel' }
  | { type: 'respondPermission'; toolCallId: string; optionId: string | null }
  | { type: 'pickAttachment'; kind: 'file' | 'image' };

/** Host -> Webview */
export type ChatWebviewMessage =
  | {
      type: 'sessionState';
      sessionId: string;
      configOptions: ConfigOption[];
      messages: ChatMessageItem[];
    }
  | { type: 'sessionsList'; sessions: SessionSummary[] }
  | { type: 'thoughtChunk'; text: string }
  | { type: 'messageChunk'; text: string }
  | { type: 'toolCall'; toolCall: ToolCallPayload }
  | { type: 'toolCallUpdate'; toolCallId: string; status: string; rawOutput?: unknown }
  | {
      type: 'permissionRequest';
      toolCallId: string;
      toolCall: ToolCallPayload;
      options: PermissionOption[];
    }
  | { type: 'promptDone'; stopReason?: string; usage?: { totalTokens?: number; cost?: number } }
  | { type: 'attachmentPicked'; attachment: ChatAttachment }
  | { type: 'error'; message: string };
