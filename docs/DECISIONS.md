# Decisions

Status is `proposed` until the owner agrees, then `accepted`. Superseded entries stay, marked `superseded by D-n`.

## D-1 Desktop app, not web — accepted (2026-10-02)

The app drives CLIs installed and logged in on the user's machine. A browser cannot spawn local processes or reach local credentials, so a desktop shell is required.

## D-2 Core is a standalone local process, the shell is a thin wrapper — accepted (2026-10-02)

The core (harness supervision, orchestration, persistence) runs as its own process and talks to the UI over a local socket. The desktop shell only opens a window and starts or stops the core.
Why: the core can be built and tested headless, the UI can run in a plain browser during development, and the shell choice (D-4) becomes reversible.

## D-3 TypeScript end to end — accepted (2026-10-02)

Why: the UI must be TypeScript anyway, so one language gives one shared event contract with no cross-language drift. Every harness ships a first-class TypeScript SDK; Python coverage is partial. Packaging a Python runtime into a desktop app adds size, slow startup and antivirus false positives.
Cost: the owner is a Python developer and must review TypeScript.

## D-4 Electron shell — accepted (2026-10-02)

Why: the core is Node, which Electron already ships, so no sidecar binary. One Chromium on every OS keeps the canvas consistent. Tauri's size advantage mostly disappears once a compiled Node/Bun sidecar is bundled, and it adds a Rust toolchain nobody on the project knows.
Cost: larger installer and higher idle memory than Tauri. Reversible because of D-2.

## D-5 One harness contract, one adapter per wire format — accepted (2026-10-02)

Every harness is the vendor's own native binary. Each binary reports its activity in a different machine-readable format. An adapter is our translator from one such format into the core's single event model.
- Claude Code: its `stream-json` format.
- OpenCode and any other binary that natively speaks the Agent Client Protocol (ACP): one shared ACP adapter.
- Codex, Antigravity: their own native formats, each its own adapter, added when needed.
Why: open/closed. Adding a harness adds an adapter and never edits the core. ACP is used only where the vendor binary speaks it itself; third-party ACP wrappers around Claude or Codex lose sub-agent detail and sit in a policy grey area (D-6).

## D-6 Never touch harness credentials — accepted (2026-10-02)

Spawn only the unmodified vendor binary; the user logs in through the vendor's own flow. No token extraction, storage or proxying.
Why: Anthropic and Google have both suspended subscription access for third-party tools that handled OAuth tokens (2026). Vendor billing rules for third-party usage are still moving, so an API-key path must stay possible.

## D-7 Open source, distributed, low-cost path is first class — accepted (2026-10-02)

Public repo, built for distribution. OpenCode with its free and Go models must work as well as premium subscriptions, so users without expensive plans can try the product.
Consequence: the event contract is validated against Claude Code and OpenCode early, so it does not end up Claude-shaped.

## D-8 The app orchestrates across harnesses — accepted (2026-10-02)

The app spawns separate sessions and routes delegation between them, so a lead on one harness can delegate to a worker on another. A harness's own built-in sub-agents are also surfaced, as nested activity under that agent.

## D-9 Command-center interface — accepted in direction, design pending (2026-10-02)

A holistic top-down view of departments, their agents and inter-department dependencies, with chat, task and status panels. Not a walk-up-to-an-avatar world. Details need a dedicated design session before the UI modules.

## D-10 Human in the loop: per-team autonomy plus a blocked queue — accepted (2026-10-02)

Each team has an autonomy setting. Anything needing the user lands in one queue showing department, task, agent and what it is blocked on.
Consequence: permission requests and blocked states are part of the event contract from module 1.

## D-11 Task agnostic, connectors as plugins — accepted in direction, design pending (2026-10-02)

Not coding only. Capabilities come from connectors, packaged as plugins; an agent lacking a tool should be able to provision one. Needs its own deep dive before the connectors module.
