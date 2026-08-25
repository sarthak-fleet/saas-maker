import { PROVIDER_LOGOS } from '../providerLogos';

export function GrokIcon({ className }: { className?: string }) {
  return <img className={className} src={PROVIDER_LOGOS.grok} alt="" aria-hidden="true" />;
}
