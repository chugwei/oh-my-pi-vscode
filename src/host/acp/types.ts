/**
 * Agent Client Protocol (ACP v1) Type Definitions
 */

export interface JsonRpcRequest<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: T;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface JsonRpcNotification<T = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: T;
}

// Initialize
export interface InitializeParams {
  protocolVersion: number;
  clientCapabilities?: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean };
    session?: { configOptions?: { boolean?: Record<string, never> } };
  };
}

export interface InitializeResult {
  protocolVersion: number;
  agentInfo?: {
    name: string;
    title?: string;
    version?: string;
  };
  agentCapabilities?: {
    loadSession?: boolean;
    sessionCapabilities?: {
      list?: Record<string, never>;
      fork?: Record<string, never>;
      resume?: Record<string, never>;
      close?: Record<string, never>;
    };
    promptCapabilities?: {
      embeddedContext?: boolean;
      image?: boolean;
    };
  };
}

// Config Options
export interface ConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

export interface ConfigOption {
  id: string;
  name: string;
  description?: string;
  category?: 'mode' | 'model' | 'model_config' | 'thought_level' | string;
  type: 'select' | 'boolean';
  currentValue: string | boolean;
  options?: ConfigOptionValue[];
}

// Sessions
export interface SessionNewParams {
  cwd: string;
  mcpServers?: unknown[];
}

export interface SessionNewResult {
  sessionId: string;
  configOptions?: ConfigOption[];
}

export interface SessionListParams {
  cwd?: string;
}

export interface SessionSummary {
  sessionId: string;
  cwd: string;
  updatedAt: string;
  _meta?: {
    messageCount?: number;
    size?: number;
  };
}

export interface SessionListResult {
  sessions: SessionSummary[];
}

export interface SessionLoadParams {
  sessionId: string;
  cwd?: string;
}

export interface SessionLoadResult {
  sessionId: string;
  configOptions?: ConfigOption[];
}

export interface SetConfigOptionParams {
  sessionId: string;
  configId: string;
  value: string | boolean;
}

export interface SetConfigOptionResult {
  configOptions: ConfigOption[];
}

// Content Blocks
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string; uri?: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; text: string } };

export interface SessionPromptParams {
  sessionId: string;
  prompt: ContentBlock[];
}

export interface SessionPromptResult {
  stopReason?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    cachedReadTokens?: number;
  };
}

// Session Updates
export interface ToolCallPayload {
  toolCallId: string;
  title?: string;
  kind?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  rawInput?: Record<string, unknown>;
  rawOutput?: unknown;
  content?: Array<{ type: string; content?: { type: string; text?: string } }>;
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' | string;
}

export interface RequestPermissionParams {
  sessionId: string;
  toolCall: ToolCallPayload;
  options: PermissionOption[];
}

export interface RequestPermissionResult {
  outcome:
    | { outcome: 'selected'; optionId: string }
    | { outcome: 'cancelled' };
}

export type SessionUpdateNotification =
  | { sessionUpdate: 'agent_message_chunk'; content: { type: 'text'; text: string } }
  | { sessionUpdate: 'agent_thought_chunk'; content: { type: 'text'; text: string }; messageId?: string }
  | { sessionUpdate: 'tool_call'; toolCallId: string; title?: string; kind?: string; status: 'pending'; rawInput?: Record<string, unknown>; content?: Array<{ type: string; content?: { type: string; text?: string } }> }
  | { sessionUpdate: 'tool_call_update'; toolCallId: string; status: 'in_progress' | 'completed' | 'failed'; rawOutput?: unknown; content?: Array<{ type: string; content?: { type: string; text?: string } }> }
  | { sessionUpdate: 'usage_update'; size?: number; used?: number; cost?: { amount: number; currency: string } }
  | { sessionUpdate: 'session_info_update'; updatedAt: string }
  | { sessionUpdate: 'available_commands_update'; availableCommands: Array<{ name: string; description: string; input?: { hint?: string } }> };
