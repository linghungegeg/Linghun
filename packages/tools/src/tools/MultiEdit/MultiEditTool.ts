import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const MultiEditTool = { name: "MultiEdit", prompt, userFacingName } as const;
