import { prompt } from "./prompt.js";

const userFacingName = "读取代码片段";

export const ReadSnippetsTool = { name: "ReadSnippets", prompt, userFacingName } as const;
