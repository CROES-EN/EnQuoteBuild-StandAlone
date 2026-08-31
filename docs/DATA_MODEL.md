# Logical Data Model

Proposed platform-neutral objects:

- EnQuote: quote identity, status, version, totals, scope, and dates.
- EnQuote Line Item: product or service, quantity, price, labor, travel, and taxability.
- EnQuote Review: reviewer, decision, reason, coaching notes, and completion state.
- EnQuote Activity: quote event, actor, timestamp, and detail.
- EnQuote Follow-Up: due date, owner, status, and outcome.
- Product: SKU, description, category, price, cost, markup, and active state.
- User: synthetic demo identity and role; production authorization remains external.
- File metadata: quote association, document type, name, and storage reference.
