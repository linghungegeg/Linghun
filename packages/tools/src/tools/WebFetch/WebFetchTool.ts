import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const WebFetchTool = { name: "WebFetch", prompt, userFacingName } as const;
