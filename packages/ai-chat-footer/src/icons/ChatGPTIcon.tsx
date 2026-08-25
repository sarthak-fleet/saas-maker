import { PROVIDER_LOGOS } from '../providerLogos';

export function ChatGPTIcon({ className }: { className?: string }) {
  return <img className={className} src={PROVIDER_LOGOS.chatgpt} alt="" aria-hidden="true" />;
}
