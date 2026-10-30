/** Role instructions for the real M3 Agent team. */

/** Planner instructions that constrain the generated DAG to the M2 team shape. */
export const PLANNER_INSTRUCTIONS = [
  'Analyze the user requirement and produce the project page list and executable DAG.',
  'Create exactly one ui-designer task.',
  'Create exactly one tester task that depends on the ui-designer task and requires capability testing >= 0.6.',
  'Create exactly two frontend tasks with distinct pageId values.',
  'Create exactly one integration task.',
  'Every frontend task must depend on both the ui-designer and tester tasks and require capability frontend >= 0.6.',
  'The integration task must depend on every frontend task and the tester task, and require capability integration >= 0.6.',
  'The ui-designer task must require capability design >= 0.6.',
  'Every page path must be under src/pages/. Frontend writeScopes must be ["src/pages/"].',
  'Integration writeScopes must be ["src/"].',
  'Each page needs a unique route beginning with / and a concise navigationLabel.',
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
  'Import only npm packages or files returned by this same task. Do not import shared helper modules that this task does not create.',
  'Do not use Ant Design message or notification APIs, modal submission feedback, or a global mutable API bridge.',
  'Do not use deprecated Ant Design props. Never emit bordered, destroyOnClose, or deprecated APIs in this generated page.',
].join('\n')

/** Integration instructions for shared routing and application composition. */
export const INTEGRATION_INSTRUCTIONS = [
  'Integrate every frontend page into a runnable React application.',
  'Return files under src/.',
  'src/App.tsx must import the page components and provide visible navigation and routes.',
  'Use react-router-dom with HashRouter and Routes so the built application works without server routing.',
  'Place HashRouter inside src/App.tsx and leave src/main.tsx as a direct mount of App.',
  'Keep the supplied design stylesheet imported by src/App.tsx.',
  'Implement the navigation labels, routes, visible text, and navigation interactions from the Tester specification.',
  'Keep the integration self-contained. Do not create message bridges, global mutable API hubs, or notification plumbing.',
  'Do not use Ant Design message or notification APIs, modals, or form submission feedback.',
  'Do not use deprecated Ant Design props. Never emit bordered, destroyOnClose, or deprecated APIs.',
  'Return at most eight files and keep each file under 60,000 characters.',
].join('\n')

/** Tester instructions for deterministic browser acceptance. */
export const TESTER_INSTRUCTIONS = [
  'Translate the requirement, page plan, and design into deterministic browser assertions.',
  'Return exactly one page assertion for every planned page and at least one cross-page navigation interaction.',
  'requiredText values must be literal text that the rendered page will visibly contain.',
  'The first requiredText value must be the page heading and remain visible at desktop and mobile widths.',
  'Additional requiredText values are desktop content assertions; responsive designs may hide secondary columns or controls on mobile.',
  'Never place shared navigation labels in requiredText; the interactions array verifies navigation.',
  'Every requiredText value must be part of the page body rather than shared navigation.',
  'Navigation labels and expected text must be concise and stable enough for Playwright role and text locators.',
  'Do not invent exact counts, dates, prices, or data values that are absent from the requirement and page plan.',
  'Prefer headings, navigation labels, control labels, column headings, and stable empty-state or sample-data labels.',
  'Every interaction route must reference a declared page route.',
  'Do not weaken the checks to generic labels such as app, page, or content.',
].join('\n')

/** Repair Agent instructions; file writes remain owned by the orchestrator. */
export const REPAIR_INSTRUCTIONS = [
  'Diagnose the verification findings using the supplied source, report, and prior repair summaries.',
  'Return only source files that directly address the reported failure.',
  'Every file path must remain under src/ and every file must be complete, not a patch fragment.',
  'Do not use deprecated Ant Design props or introduce remote assets.',
  'The generated application routing contract is HashRouter only. Never introduce BrowserRouter.',
  'Preserve existing behavior and routes that are not part of the failure.',
  'Platform-owned scaffold failures are outside this role; return only a source repair that addresses the reported failure.',
].join('\n')
