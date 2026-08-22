# Abuse-protection policy

Use this policy when a public-product audit encounters rate limiting or finds an
expensive public endpoint. It is guidance for evidence and repair handoff, not
authorization to change production rules.

## Baseline

Cloudflare automatic DDoS protection is the volumetric baseline for proxied
Fleet origins. Do not use that baseline as proof that application-level cost
abuse is covered.

Do not recommend blanket application or WAF limits for:

- public HTML and static assets;
- ordinary navigation and cached public reads;
- an entire hostname when only one endpoint is expensive.

Broad IP-only controls can group unrelated users behind NAT or shared networks
and make a healthy product feel unreliable.

## Candidate endpoints

Review endpoint-specific protection when evidence identifies a resource-heavy
or abuse-prone operation such as:

- AI inference or generation;
- uploads, imports, scraping, or remote fetches;
- email, messages, feedback, or other outbound delivery;
- account creation and repeated failed authentication;
- expensive uncached search or batch jobs;
- mutations that create durable state.

Source evidence can establish a missing protection finding. The audit must not
send repeated requests to prove exploitability or estimate a threshold.

## Identity and scope

Prefer the narrowest endpoint plus the most stable available identity:

1. authenticated user;
2. service/API key or project;
3. session;
4. IP address for genuinely anonymous traffic.

For authenticated service APIs, do not default to IP when a key or project
identity is already available. If IP fallback is necessary, allow reasonable
bursts and account for shared networks.

## Rollout and recovery

- Observe and log endpoint traffic before choosing a threshold.
- Set a generous initial endpoint-specific boundary from real traffic rather
  than intuition.
- Return a recoverable `429` with `Retry-After` and clear UI guidance.
- Monitor false positives, challenges, and limit decisions before tightening.
- Use managed challenges only for human browser actions where a challenge can
  succeed; do not put them in normal API or navigation paths.

Cloudflare Workers rate-limit bindings and WAF counters are intentionally
distributed and should not be treated as precise accounting or quota systems.

## Audit classification

- `healthy-targeted`: exact costly endpoint, appropriate identity, ordinary use
  unaffected, graceful recovery.
- `customer-blocking`: ordinary selected journey reaches `429`, error `1015`,
  or an unrecoverable challenge.
- `missing-cost-protection`: exact expensive public mutation has repository or
  configuration evidence of no bounded protection.
- `expected-auth-rejection`: a protected service route rejects missing or
  invalid identity without exposing work.
- `unknown`: neither live evidence nor repository/configuration evidence is
  sufficient.

Do not choose a numeric threshold in the audit report. Hand off the endpoint,
evidence, identity options, and measurement required to set one.

## References

- [Cloudflare DDoS protection](https://developers.cloudflare.com/ddos-protection/about/)
- [Rate limiting best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/)
- [Finding an appropriate rate limit](https://developers.cloudflare.com/waf/rate-limiting-rules/find-rate-limit/)
- [Workers Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
