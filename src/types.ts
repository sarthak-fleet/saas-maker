import type { ReactNode } from 'react';

export type AIChatProvider = 'claude' | 'chatgpt' | 'gemini' | 'perplexity' | 'grok';

export type Theme = 'light' | 'dark' | 'auto';

export interface PromptContext {
  companyName: string;
  companyUrl: string;
}

export type Prompt = string | ((ctx: PromptContext, provider: AIChatProvider) => string);

export interface AIChatFooterProps {
  /** Company or product name shown in the label and used in the prompt. */
  companyName: string;
  /** Company or product URL included in the prompt. */
  companyUrl: string;
  /** Prompt template or builder. Use `{companyName}` and `{companyUrl}` placeholders in strings. */
  prompt?: Prompt;
  /** Providers to show, in order. Defaults to all five. */
  providers?: AIChatProvider[];
  /** Heading text above the icons. */
  label?: ReactNode;
  /** Color scheme. */
  theme?: Theme;
  /** Extra class applied to the root element. */
  className?: string;
}

export interface ProviderConfig {
  id: AIChatProvider;
  name: string;
  buildUrl: (prompt: string) => string;
  Icon: React.ComponentType<{ className?: string }>;
}
