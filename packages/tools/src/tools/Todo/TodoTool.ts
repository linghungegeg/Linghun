import { prompt } from "./prompt.js";
import { userFacingName } from "./UI.js";

export const TodoTool = { name: "Todo", prompt, userFacingName } as const;
