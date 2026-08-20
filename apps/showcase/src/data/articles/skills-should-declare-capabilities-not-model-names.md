# Skills should declare capabilities, not model names

Agents choose models. Skills should say what they need.

A working method applied across 28 Fleet-owned skills.

- Published: 2026-07-28
- Author: Sarthak Agrawal
- Reading time: 7 min read
- Canonical HTML: https://sassmaker.com/learnings/skills-should-declare-capabilities-not-model-names

~~~json
{
  "recommended": {
    "intelligence": "frontier",
    "reasoning": "high"
  },
  "minimum": {
    "intelligence": "balanced",
    "reasoning": "high"
  },
  "degradation": "deny"
}
~~~

Once a skill library grows past a handful of prompts, model selection becomes part of skill design whether you acknowledge it or not. Some skills mostly retrieve facts and format results. Others make product decisions, validate claims, or act in public.

I ran into this while building two marketing skills. One audits search coverage and publishes missing pages. The other plans a launch, writes the campaign, and can carry an approved plan into public channels. Giving every step the strongest model would waste money. Letting an underpowered model handle claims or submissions would be careless.

The obvious answer is to put a model name in each skill. It is also the wrong abstraction for a portable skill. The better method is small, practical, and not especially revolutionary: let the skill declare the capability it needs, then let the host decide how to provide it.

## Is a skill an agent?

No. This distinction matters more than it first appears.

An agent is the active runtime. It has a model, tools, permissions, context, and an execution loop. A skill is a package of instructions and resources that the runtime loads when a job calls for it.

The agent decides and acts. The skill changes how it approaches one class of work. If a skill hard-codes a model, it starts taking over a decision that usually belongs to the host.

## Has anyone already done this?

Yes, at least part of it.

Claude Code supports `model` and `effort` directly in skill frontmatter. That is the clearest version of the idea I found, and it is useful. The [Claude Code documentation](https://code.claude.com/docs/en/slash-commands#frontmatter-reference) says the model override lasts for the current turn.

Agent frameworks make the same choice one layer higher. The [OpenAI Agents SDK](https://openai.github.io/openai-agents-python/models/) supports model selection per agent or run. LangChain's [skills pattern](https://docs.langchain.com/oss/python/langchain/multi-agent/skills) loads specialized prompts into an agent whose model is configured separately.

So model-aware execution is not new. The portable part is still awkward.

## What is missing?

The open [Agent Skills specification](https://agentskills.io/specification) defines the portable package. Its standard fields cover identity, description, compatibility, metadata, and allowed tools. It does not define model or reasoning requirements.

A literal model field would not fully solve that problem. A model name can be absent on another host, blocked by company policy, too expensive for the current run, or replaced next month. Even reasoning controls use different names across providers.

The skill knows the quality of work it needs. The host knows which runtimes are available. The contract should connect those two facts without pretending they are the same fact.

> Declare the need, set a floor, choose what degradation means, and leave model mapping to the host.

## What is the methodology?

A useful skill execution profile answers four questions:

1. **Need:** What quality would I choose when the work matters?
2. **Floor:** What is the lowest capability that can do the job responsibly?
3. **Degrade:** May the runtime degrade quietly, must it ask, or should it refuse?
4. **Map:** Why does this skill need that level?

The profile should not name the current favorite model. It should describe stable capabilities in a vocabulary the host can map to its own providers.

In Fleet, intelligence is `economy`, `balanced`, or `frontier`. Reasoning runs from `low` to `very_high`. Degradation is `allow`, `ask`, or `deny`. The vocabulary is intentionally plain.

I applied the method to every Fleet-owned skill. There are 28 today. Each has an `execution-profile.json` beside its instructions. The metadata catalog can read that profile before it loads the skill body.

~~~text
fleet-capabilities execution \
  skill:launch-campaign \
  --runtime balanced:high

# compatible
# action: continue
~~~

The compatibility check returns recommended, compatible, degraded, approval required, or re-dispatch required. It never picks a provider or invokes a model. A host maps `frontier:high` to whatever meets its cost, availability, and policy rules.

## Where does it fall short?

The tiers are subjective. Hosts still need a mapping table, and two models labelled "frontier" may be good at very different things. A whole-skill profile also ignores mixed workloads. The research stage of a campaign and the final browser submission do not necessarily need the same runtime.

I considered stage-specific profiles and a larger capability vocabulary. I left both out. There is no evidence yet that the extra machinery would improve our work.

This is a working method in one skill library, not a proposed standard. The schema is small enough to change or delete when usage proves part of it wrong.

## What is the useful idea?

It is not the model switch. Claude Code already has one.

The useful idea is execution hygiene. A portable skill should be honest about the quality it requires without taking routing away from the host. A deployment guard and a directory listing should not silently receive the same treatment.

I do not know whether this belongs in the Agent Skills standard. I do think mature skill libraries need some version of the methodology. Our own skills are clearer now because they can say what they need, what they will tolerate, and when they should refuse to run.

The operating rule is simple: skills state their needs; hosts choose the machinery.

## Sources and implementation

- [Agent Skills specification](https://agentskills.io/specification)
- [Claude Code skill frontmatter](https://code.claude.com/docs/en/slash-commands#frontmatter-reference)
- [OpenAI Agents SDK model configuration](https://openai.github.io/openai-agents-python/models/)
- [LangChain skills pattern](https://docs.langchain.com/oss/python/langchain/multi-agent/skills)
