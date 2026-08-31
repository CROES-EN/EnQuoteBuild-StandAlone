# Local Demo Guide

1. Set `VITE_DATA_SOURCE=mock` for in-memory data or `VITE_DATA_SOURCE=local` for Electron persistence.
2. Run `npm run desktop:dev` to start Vite and Electron in local persistence mode.
3. Run `npm run dev` separately when only the renderer is needed.
4. Create, edit, submit, approve, reject, and generate PDFs using synthetic records only.
5. Verify persistence by closing and reopening Electron.
6. Reset data through the repository reset operation or by deleting the versioned demo data file.
7. Run `npm run build` before packaging an installer.

## Platform Packaging

- Windows: `npm run desktop:package:win`
- Windows helper script: `powershell -ExecutionPolicy Bypass -File scripts/create-windows-installer.ps1`
- macOS: `npm run desktop:package:mac` on a macOS build machine

Windows installers are written to `release/EnQuote Demo Setup-<version>.exe`.

macOS distribution requires Apple Developer signing and notarization before production use.
