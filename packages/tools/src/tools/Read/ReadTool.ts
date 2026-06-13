import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const ReadTool = { name: "Read", prompt, userFacingName } as const;
