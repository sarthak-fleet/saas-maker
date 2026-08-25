import { PROVIDER_LOGOS } from '../providerLogos';

export function GeminiIcon({ className }: { className?: string }) {
  return <img className={className} src={PROVIDER_LOGOS.gemini} alt="" aria-hidden="true" />;
}
