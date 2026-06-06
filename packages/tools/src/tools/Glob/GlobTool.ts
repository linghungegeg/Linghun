import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const GlobTool = { name: "Glob", prompt, userFacingName } as const;
