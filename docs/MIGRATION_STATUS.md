# Migration Status

## Completed
- Frontend quote reads use `src/api/dataClient.js`.
- Mock, local, Base44, and Salesforce source modes are defined.
- Electron loads local development or packaged Vite output.
- Electron-builder targets Windows NSIS and macOS DMG/ZIP packages.
- `desktop:dev` starts the local Vite server and Electron together with local data forced on.
- Windows NSIS packaging has been successfully executed; the configured artifact directory is `release/`.
- Local quote JSON repository and narrow preload API are implemented.
- Synthetic local seed quotes include statuses and quote versions.

## Local Functionality
- Quote list, lookup, create, update, delete, bulk update, reset, import, and export repository methods.
- Core quote create, edit, copy, version, delete, Boneyard, follow-up, and bulk status workflows use the platform-neutral client.
- Local reviews, coaching feedback, activities, follow-up history, flags, cancellation records, material orders, PV RMAs, PDF templates, deletion requests, and user reads are wired through local collections.
- Local catalog JSON/CSV import preview and apply are available; hosted Excel validation remains Base44-backed.
- Synthetic demonstration authentication for mock and local builds.

## Remaining Base44 Dependencies
- Product CRUD and quote product selection use the platform-neutral client.
- Product price reviews, invitations/password resets, advanced catalog validation, file upload, email delivery, AI integrations, and some hosted-only automation still call Base44 directly.

## Known Limitations
- Local role selection and demo authentication are not production authorization.
- Import/export IPC handlers currently exchange validated JSON; a user-facing save/open dialog remains.
- Windows installer and macOS packaging require platform-specific build validation; macOS signing/notarization remain deferred.
- The full installed-app acceptance workflow has not yet been run on a clean Windows or macOS machine.

## Next Delivery Plan
1. Complete full offline acceptance testing, including create/edit/version/approval/rejection and restart persistence.
2. Replace remaining hosted-only email, AI, invitations, password reset, and advanced catalog review behavior with local demo behavior or explicit disabled states.
3. Build and test the Windows installer, then validate macOS DMG/ZIP on Intel and Apple Silicon.
4. Prepare the Salesforce handoff; implementation begins only after sandbox, security, authentication, mapping, and permissions approvals.

## Commands
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm run desktop`

## Reset
Use the local repository reset channel from the future demo settings UI, or remove `enquote-demo-data-v1.json` from Electron `app.getPath("userData")` before relaunching.
