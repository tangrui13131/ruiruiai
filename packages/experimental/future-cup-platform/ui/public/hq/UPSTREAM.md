# Future Cup Agent HQ

The original Agent HQ scene is the `theme-10-hq` snapshot supplied in `agent-display-main`. The Future Cup platform copies it only to reuse the noncommercial 3D command-center presentation.

## 使用

Open `/hq/index.html?projectId=<project-id>` from a running Future Cup profile. The page loads the authoritative REST snapshot, then applies committed Socket.IO project events. It does not expose a standalone simulated-data mode.

Recommended display: 1920 x 1080 landscape.

## Future Cup changes

- Seven Future Cup role departments map to real Agent projections.
- REST snapshots rebuild project, task, Agent, verification, and repair state.
- Socket.IO events are validated, deduplicated, and resynchronized after sequence gaps.
- Task and personnel creation controls were removed; the display is read-only.
- Remote web fonts were removed and the page uses the local system font stack.
- The PolyForm license and Required Notice are preserved next to the page.

## License

The HQ asset remains under PolyForm Noncommercial License 1.0.0.

`Required Notice: Copyright (c) 2026 赛博老爸`

Every distribution must include [LICENSE](./LICENSE) and the Required Notice. Commercial use requires separate authorization from the licensor. This record is not legal advice.
