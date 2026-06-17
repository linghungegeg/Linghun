import { prompt } from "./prompt.js";

const userFacingName = "定位代码片段";

export const SourcePackTool = { name: "SourcePack", prompt, userFacingName } as const;
