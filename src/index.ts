export {
  buildPresentationHtml,
  composeSlidesHtml,
  listSlides,
  writePresentation,
} from "./presentation.js";
export type { BuildOptions, ThemeName } from "./presentation.js";
export { formatSlideList, listDeckSlides } from "./slides.js";
export type { DeckSlide } from "./slides.js";
export { servePresentation } from "./server.js";
export { checkPresentation } from "./check/checker.js";
export type { CheckOptions } from "./check/checker.js";
export { formatReport, reportHasFailures } from "./check/report.js";
export type { CheckReport, CheckTheme, Finding, Severity } from "./check/types.js";
