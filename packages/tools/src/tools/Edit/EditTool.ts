import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const EditTool = { name: "Edit", prompt, userFacingName } as const;
