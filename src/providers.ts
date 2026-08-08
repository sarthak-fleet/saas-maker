import type { AIChatProvider, ProviderConfig } from './types';

function encode(prompt: string): string {
  return encodeURIComponent(prompt);
}

const buildUrl: Record<AIChatProvider, (prompt: string) => string> = {
  claude: (prompt) => `https://claude.ai/new?q=${encode(prompt)}`,
  chatgpt: (prompt) => `https://chatgpt.com/?q=${encode(prompt)}`,
  gemini: (prompt) => `https://gemini.google.com/app?is_sa=1&is_sa_p=${encode(prompt)}`,
  perplexity: (prompt) => `https://www.perplexity.ai/?q=${encode(prompt)}`,
  grok: (prompt) => `https://grok.com/?q=${encode(prompt)}`,
};

export const DEFAULT_PROMPT_TEMPLATE =
  'What does {companyName} ({companyUrl}) do, and who is it best for? Keep it concise.';

export const DEFAULT_PROVIDERS: AIChatProvider[] = [
  'claude',
  'chatgpt',
  'gemini',
  'perplexity',
  'grok',
];

export function getProviderUrl(provider: AIChatProvider, prompt: string): string {
  return buildUrl[provider](prompt);
}

export function createProviderRegistry(
  icons: Record<AIChatProvider, ProviderConfig['Icon']>
): Record<AIChatProvider, ProviderConfig> {
  const configs: ProviderConfig[] = [
    { id: 'claude', name: 'Claude', buildUrl: buildUrl.claude, Icon: icons.claude },
    { id: 'chatgpt', name: 'ChatGPT', buildUrl: buildUrl.chatgpt, Icon: icons.chatgpt },
    { id: 'gemini', name: 'Gemini', buildUrl: buildUrl.gemini, Icon: icons.gemini },
    { id: 'perplexity', name: 'Perplexity', buildUrl: buildUrl.perplexity, Icon: icons.perplexity },
    { id: 'grok', name: 'Grok', buildUrl: buildUrl.grok, Icon: icons.grok },
  ];
  return Object.fromEntries(configs.map((c) => [c.id, c])) as Record<
    AIChatProvider,
    ProviderConfig
  >;
}
