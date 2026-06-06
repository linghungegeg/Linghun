import { BashTool } from "./Bash/BashTool.js";
import { DiffTool } from "./Diff/DiffTool.js";
import { EditTool } from "./Edit/EditTool.js";
import { GlobTool } from "./Glob/GlobTool.js";
import { GrepTool } from "./Grep/GrepTool.js";
import { MultiEditTool } from "./MultiEdit/MultiEditTool.js";
import { ReadTool } from "./Read/ReadTool.js";
import { TodoTool } from "./Todo/TodoTool.js";
import { WriteTool } from "./Write/WriteTool.js";
import type { ToolName } from "../index.js";

export const toolUserFacingNames: Record<ToolName, string> = {
  Read: ReadTool.userFacingName,
  Write: WriteTool.userFacingName,
  Edit: EditTool.userFacingName,
  MultiEdit: MultiEditTool.userFacingName,
  Grep: GrepTool.userFacingName,
  Glob: GlobTool.userFacingName,
  Bash: BashTool.userFacingName,
  Todo: TodoTool.userFacingName,
  Diff: DiffTool.userFacingName,
};
