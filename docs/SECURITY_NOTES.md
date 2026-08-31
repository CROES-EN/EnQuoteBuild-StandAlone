# Security Notes

- No secrets or credentials belong in the renderer or Git.
- Local demo data contains no production customer information.
- Demo roles are labeled by configuration and are not production authorization.
- Electron uses context isolation, disabled Node integration, sandboxing, and a narrow preload API.
- Main-process repository input is validated with Zod.
- Electron builds require code signing before distribution.
- Salesforce server-side permissions remain authoritative.
