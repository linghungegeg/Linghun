import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const WriteTool = { name: "Write", prompt, userFacingName } as const;
