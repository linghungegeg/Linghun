import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const WebSearchTool = { name: "WebSearch", prompt, userFacingName } as const;
