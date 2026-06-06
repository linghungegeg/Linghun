import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const BashTool = { name: "Bash", prompt, userFacingName } as const;
