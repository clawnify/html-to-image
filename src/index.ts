// Public surface: the OpenClaw plugin default (loader reads this via package.json
// `main`) plus the library API for direct programmatic use.
export { default } from "./plugin/index.js";
export { htmlToImage, defaultOutputPath } from "./render.js";
export type {
  HtmlToImageOptions,
  HtmlToImageResult,
  FontInput,
  FontWeight,
  OverflowReport,
  ClippedNode,
} from "./render.js";
