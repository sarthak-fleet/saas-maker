import chatgptLogo from './assets/provider-logos/chatgpt.jpg';
import claudeLogo from './assets/provider-logos/claude.jpg';
import geminiLogo from './assets/provider-logos/gemini.jpg';
import grokLogo from './assets/provider-logos/grok.jpg';
import perplexityLogo from './assets/provider-logos/perplexity.jpg';
import type { AIChatProvider } from './types';

export const PROVIDER_LOGOS: Record<AIChatProvider, string> = {
  claude: claudeLogo,
  chatgpt: chatgptLogo,
  gemini: geminiLogo,
  perplexity: perplexityLogo,
  grok: grokLogo,
};
