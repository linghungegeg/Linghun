import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const GrepTool = { name: "Grep", prompt, userFacingName } as const;
