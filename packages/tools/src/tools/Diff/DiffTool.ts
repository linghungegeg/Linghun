import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const DiffTool = { name: "Diff", prompt, userFacingName } as const;
