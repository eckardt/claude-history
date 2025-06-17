export interface ClaudeCommand {
  timestamp: Date;
  command: string;
  source: 'bash' | 'user';
  projectPath?: string;
  success?: boolean;
  description?: string;
}

export interface UserConversationEntry {
  type: 'user';
  message: {
    role: 'user';
    content:
      | string
      | Array<{
          type: string;
          tool_use_id?: string;
          is_error?: boolean;
          content?: string;
        }>;
  };
  timestamp?: string;
  cwd?: string;
}

export interface AssistantConversationEntry {
  type: 'assistant';
  message: {
    role: 'assistant';
    content: Array<{
      type: string;
      name?: string;
      id?: string;
      input?: {
        command?: string;
        description?: string;
        [key: string]: unknown;
      };
      text?: string;
      tool_use_id?: string;
      is_error?: boolean;
    }>;
  };
  timestamp?: string;
  cwd?: string;
}

export type ConversationEntry =
  | UserConversationEntry
  | AssistantConversationEntry;

export interface CLIOptions {
  global?: boolean;
  listProjects?: boolean;
  includeFailed?: boolean;
}
