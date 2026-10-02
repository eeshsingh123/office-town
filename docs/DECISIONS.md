# Decisions

Status is `proposed` until the owner agrees, then `accepted`. Superseded entries stay, marked `superseded by D-n`.

## D-1 Desktop app, not web — proposed (2026-10-02)

The app drives CLIs installed and logged in on the user's machine. A browser cannot spawn local processes or reach local credentials, so a desktop shell is required.

## D-2 Core is a standalone local process, the shell is a thin wrapper — proposed (2026-10-02)

The core (harness supervision, orchestration, persistence) runs as its own process and talks to the UI over a local socket. The desktop shell only opens a window and starts or stops the core.
Why: the core can be built and tested headless, the UI can run in a plain browser during development, and the shell choice (D-4) becomes reversible.

## D-3 TypeScript end to end — proposed (2026-10-02)

Why: the UI must be TypeScript anyway, so one language gives one shared event contract with no cross-language drift. Every harness ships a first-class TypeScript SDK (Claude Agent SDK, Codex SDK, OpenCode SDK, ACP 1.0); Python coverage is partial. Packaging a Python runtime into a desktop app adds size, slow startup and antivirus false positives.
Cost: the owner is a Python developer and must review TypeScript.

## D-4 Electron shell — proposed (2026-10-02)

Why: the core is Node, which Electron already ships, so no sidecar binary. One Chromium on every OS keeps the 2D canvas consistent. Tauri's size advantage mostly disappears once a compiled Node/Bun sidecar is bundled, and it adds a Rust toolchain nobody on the project knows.
Cost: larger installer and higher idle memory than Tauri. Reversible because of D-2.

## D-5 Harness port with adapters — proposed (2026-10-02)

The core defines one `Harness` contract and one normalized event model. Each CLI is an adapter. First adapter: the stock `claude` binary in stream-json mode. Second: a generic ACP adapter (covers OpenCode, Codex, others).
Why: open/closed. Adding a harness never edits the core. ACP alone is not enough: sub-agent visibility and usage are not standardized in it yet.

## D-6 Never touch harness credentials — proposed (2026-10-02)

Spawn only the unmodified vendor binary; the user logs in through the vendor's own flow. No token extraction, storage or proxying.
Why: Anthropic and Google have both suspended subscription access for third-party tools that handled OAuth tokens (2026). Vendor billing rules for third-party usage are still moving, so an API-key path must stay possible.
