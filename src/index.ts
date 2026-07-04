export { buildPresentationHtml, listSlides, writePresentation } from "./presentation.js";
export type { BuildOptions, ThemeName } from "./presentation.js";
export { servePresentation } from "./server.js";
export { checkPresentation } from "./check/checker.js";
export type { CheckOptions } from "./check/checker.js";
export { formatReport, reportHasFailures } from "./check/report.js";
export type { CheckReport, CheckTheme, Finding, Severity } from "./check/types.js";
