# ThatCampus current-system architecture atlas

Start with [`paper.md`](paper.md). It is a descriptive map of the current working
tree—not a replacement for the normative contracts in [`docs/blueprint`](../../blueprint/README.md).

The atlas covers system context, deployment, frontend and backend composition,
Campus Model Core LLD, command/coordination flows, Live and Simulation, principal
database relationships, responsibility/authority, evidence/realtime paths, security,
integrations and known gaps.

## Build

```bash
npx -y @hotdocx/arrowgram-agent@0.1.6 validate --root docs/architecture/current-system-atlas
npx -y @hotdocx/arrowgram-agent@0.1.6 build --root docs/architecture/current-system-atlas --out dist
```

`dist/` and `.vite/` are generated and ignored. Maintain `paper.md`, `paper.css` and
`arrowgram.workspace.json` with the owning architecture change. Keep implementation
status labels honest: **Implemented**, **Transitional** and **Open** are deliberately
different claims.
