export interface ClaudeCommand {
  timestamp: Date;
  command: string;
  source: 'bash' | 'user';
  projectPath?: string;
  success?: boolean;
  description?: string;
}

export interface ConversationEntry {
  type: 'user' | 'assistant';
  message: {
    role: 'user' | 'assistant';
    content: Array<{
      type: string;
      name?: string;
      input?: {
        command?: string;
        description?: string;
        [key: string]: unknown;
      };
      text?: string;
    }>;
  };
  timestamp?: string;
  cwd?: string;
}

export interface CLIOptions {
  global?: boolean;
  listProjects?: boolean;
  count?: number;
  includeFailed?: boolean;
}
