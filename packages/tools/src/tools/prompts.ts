import { BashTool } from "./Bash/BashTool.js";
import { DiffTool } from "./Diff/DiffTool.js";
import { EditTool } from "./Edit/EditTool.js";
import { GlobTool } from "./Glob/GlobTool.js";
import { GrepTool } from "./Grep/GrepTool.js";
import { MultiEditTool } from "./MultiEdit/MultiEditTool.js";
import { ReadTool } from "./Read/ReadTool.js";
import { ReadSnippetsTool } from "./ReadSnippets/ReadSnippetsTool.js";
import { SourcePackTool } from "./SourcePack/SourcePackTool.js";
import { TodoTool } from "./Todo/TodoTool.js";
import { WebFetchTool } from "./WebFetch/WebFetchTool.js";
import { WebSearchTool } from "./WebSearch/WebSearchTool.js";
import { WriteTool } from "./Write/WriteTool.js";
import type { ToolName } from "../index.js";

export const toolPrompts: Record<ToolName, string> = {
  Read: ReadTool.prompt,
  ReadSnippets: ReadSnippetsTool.prompt,
  SourcePack: SourcePackTool.prompt,
  Write: WriteTool.prompt,
  Edit: EditTool.prompt,
  MultiEdit: MultiEditTool.prompt,
  Grep: GrepTool.prompt,
  Glob: GlobTool.prompt,
  Bash: BashTool.prompt,
  Todo: TodoTool.prompt,
  Diff: DiffTool.prompt,
  WebSearch: WebSearchTool.prompt,
  WebFetch: WebFetchTool.prompt,
};
