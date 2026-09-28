import type { Parser, Plugin } from "prettier";
import { formatNative } from "./bridge.js";
export { options } from "./options.js";
export type { BicepOptions } from "./options.js";
export { BicepFormattingError } from "./bridge.js";
import opinionated from "./presets/opinionated.js";
import minimal from "./presets/minimal.js";
export const presets = { opinionated, minimal };
import { options } from "./options.js";

interface BicepDocument {
  type: "BicepDocument";
  start: number;
  end: number;
  formatted: string;
}

const parser: Parser<BicepDocument> = {
  astFormat: "bicep-document",
  async parse(text, settings) {
    if (settings.rangeStart !== 0 || settings.rangeEnd < text.length) {
      throw new Error(
        "Bicep supports whole-document formatting only; use Format Document instead of Format Selection.",
      );
    }
    return {
      type: "BicepDocument",
      start: 0,
      end: text.length,
      formatted: await formatNative(text, settings),
    };
  },
  locStart: (node) => node.start,
  locEnd: (node) => node.end,
};

export const languages = [
  {
    name: "Bicep",
    parsers: ["bicep"],
    extensions: [".bicep"],
    vscodeLanguageIds: ["bicep"],
  },
  {
    name: "Bicep Parameters",
    parsers: ["bicepparam"],
    extensions: [".bicepparam"],
    vscodeLanguageIds: ["bicep-params"],
  },
];
export const parsers = { bicep: parser, bicepparam: parser };
export const printers: Plugin<BicepDocument>["printers"] = {
  "bicep-document": {
    // Bicep's own layout engine handles grammar-constrained wrapping. Returning its
    // text intact also preserves significant whitespace inside multiline strings.
    print: (path) => path.node.formatted,
    getVisitorKeys: () => [],
    massageAstNode: (_original, cloned) => {
      cloned.start = 0;
      cloned.end = 0;
    },
  },
};
export const defaultOptions = {
  tabWidth: 2,
  useTabs: false,
  printWidth: 180,
  endOfLine: "auto" as const,
};
const plugin: Plugin<BicepDocument> = {
  languages,
  parsers,
  printers,
  options,
  defaultOptions,
};
export default plugin;
