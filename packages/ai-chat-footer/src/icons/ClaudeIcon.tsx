import { PROVIDER_LOGOS } from '../providerLogos';

export function ClaudeIcon({ className }: { className?: string }) {
  return <img className={className} src={PROVIDER_LOGOS.claude} alt="" aria-hidden="true" />;
}
