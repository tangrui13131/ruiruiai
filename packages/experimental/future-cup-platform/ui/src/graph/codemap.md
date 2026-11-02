# packages/experimental/future-cup-platform/ui/src/graph/

## Responsibility
Interactive DAG visualization canvas and graph layout calculation.

## Design
Built on @xyflow/react with custom node/edge renderers and topological layout algorithms.

## Flow
Task dependencies -> Compute node coordinates (dagre/elk) -> Render reactive DAG nodes and animated edge lines.

## Integration
Primary canvas inside DagPage.
