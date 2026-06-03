# Web Search Policy

Use this reference only for `krw-ontology-news-research`.

## Role

News mode is news-led and ontology-augmented.

```text
web search = current event discovery and post-filing update layer
KRW ontology = company-specific baseline, financial channel, accounting context, risk channel, and investment meaning
AI analyst = fused Korean investor interpretation
```

The final answer should not mechanically separate "news evidence" and "filing evidence" unless that is the clearest structure. Internally preserve source provenance, but write the user-facing answer as one coherent investment interpretation.

## When To Search

In news mode, attempt current web search before the final answer.

Use web search to find:

```text
latest news or reporting
company announcement
earnings-related update
post-filing event
acquisition, partnership, litigation, regulation, product, guidance, or capital-allocation update
management comment after the latest indexed filing
market event that may change the filing baseline
```

## Event Extraction

After web search, extract the current event internally:

```text
company or companies
event date and source date
source type
event type
affected product, segment, geography, customer, supplier, or business line
claimed revenue, margin, cash-flow, cost, risk, or capital-allocation impact
open questions and unsupported claims
```

Then convert the event into an ontology-aware investment brief.

## Source Priority

Prefer sources in this order:

```text
1. SEC / EDGAR / official regulatory filing
2. company investor relations, earnings release, presentation, transcript, shareholder letter
3. official company or counterparty press release
4. regulator, court, exchange, or government source
5. reputable financial news outlet
6. trade press or industry publication
7. analyst commentary, blog, social, forum
```

Analyst commentary is interpretation, not primary evidence.

## Ontology Augmentation

After the current event is identified, search KRW ontology for the event's investment meaning.

Map news events to ontology concepts such as:

```text
business combinations / acquisitions
cash flow / FCF / capex
share repurchases / dilution management
SBC / R&D / talent investment
cost of revenue / gross margin / operating margin
revenue recognition / RPO / backlog
product platform / customer demand
segment commentary
risk factors and direct exposure
management discussion and notes
```

Do not run ontology search as a generic company overview unless the news event is too vague to map. Search the specific channel implied by the news.

## Filing vs Web

Direct filing evidence remains the baseline for historical reported numbers, accounting treatment, segment definitions, and cash-flow classification.

Web evidence may update the baseline only when it is newer, reliable, and explicitly updates the same fact, metric, event, guidance, or transaction.

Do not let web snippets override direct filing evidence for historical reported numbers or accounting classification.

## Conflict Handling

If web evidence conflicts with ontology or filing evidence:

```text
check date and period
check source type and reliability
check metric definition
check GAAP vs non-GAAP
check reported result vs guidance, estimate, or commentary
prefer primary source over secondary reporting
state the conflict only when it changes the investment interpretation
```

If a news claim is plausible but not explicitly supported by filings, frame it as an inference.

## Final Answer

Write Korean investor prose.

```text
current event -> company-specific baseline -> financial channel -> investor interpretation
```

Use source timing naturally when material, but do not expose tool names, MCP names, retrieval mechanics, IDs, diagnostics, or internal briefs.

If web search fails or adds no useful evidence, answer from filing evidence and briefly state that no additional current update was confirmed.
