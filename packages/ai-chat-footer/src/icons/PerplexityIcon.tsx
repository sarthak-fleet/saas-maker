import { PROVIDER_LOGOS } from '../providerLogos';

export function PerplexityIcon({ className }: { className?: string }) {
  return <img className={className} src={PROVIDER_LOGOS.perplexity} alt="" aria-hidden="true" />;
}
