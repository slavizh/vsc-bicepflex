import type { Options } from "prettier";
import type { BicepOptions } from "../options.js";
import opinionated from "./opinionated.js";

export default {
  ...opinionated,
  bicepSortDeclarations: false,
  bicepSortProperties: false,
  bicepSortDecorators: false,
  bicepNestedResources: "preserve",
  bicepImportMemberOrder: "preserve",
  bicepTypeMemberOrder: "preserve",
} satisfies Options & BicepOptions;
