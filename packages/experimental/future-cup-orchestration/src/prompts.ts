/** Role instructions for the real M2 Agent team. */

/** Planner instructions that constrain the generated DAG to the M2 team shape. */
export const PLANNER_INSTRUCTIONS = [
  'Analyze the user requirement and produce the project page list and executable DAG.',
  'Create exactly one ui-designer task.',
  'Create exactly two frontend tasks with distinct pageId values.',
  'Create exactly one integration task.',
  'Every frontend task must depend on the ui-designer task and require capability frontend >= 0.6.',
  'The integration task must depend on every frontend task and require capability integration >= 0.6.',
  'The ui-designer task must require capability design >= 0.6.',
  'Every page path must be under src/pages/. Frontend writeScopes must be ["src/pages/"].',
  'Integration writeScopes must be ["src/"].',
  'Use task ids and page ids matching ^[a-z][a-z0-9-]*$.',
  'Do not introduce dependencies that could form a cycle.',
].join('\n')

/** UI Designer instructions shared across both frontend page tasks. */
export const UI_DESIGNER_INSTRUCTIONS = [
  'Create a concise visual system for the requested Ant Design dashboard.',
  'Return a written designSpec and compact design tokens for both pages.',
  'The platform will render CSS from your tokens; do not return CSS.',
  'Do not inspect the workspace for this design task; the page requirements are in the input.',
  'Keep designSpec under 6,000 characters.',
  'Use only local or system fonts and no remote assets.',
  'Keep the layout responsive at desktop and mobile widths.',
].join('\n')

/** Frontend instructions for one independently assigned page. */
export const FRONTEND_INSTRUCTIONS = [
  'Implement exactly one assigned page as React and TypeScript using Ant Design.',
  'Return one or more files under src/pages/.',
  'Export a named React component that can be imported by src/App.tsx.',
  'Use the supplied design specification and do not edit routing or shared application files.',
  'Return at most three files and keep each file under 60,000 characters.',
  'Do not embed large CSS blocks; the shared design stylesheet is already provided.',
  'The component must render without requiring backend data.',
].join('\n')

/** Integration instructions for shared routing and application composition. */
export const INTEGRATION_INSTRUCTIONS = [
  'Integrate every frontend page into a runnable React application.',
  'Return files under src/.',
  'src/App.tsx must import the page components and provide visible navigation and routes.',
  'Use react-router-dom with HashRouter and Routes so the built application works without server routing.',
  'Keep the supplied design stylesheet imported by src/App.tsx.',
  'Return at most eight files and keep each file under 60,000 characters.',
].join('\n')
