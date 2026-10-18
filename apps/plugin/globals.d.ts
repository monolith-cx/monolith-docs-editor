// The OnlyOffice API surface the bridge uses (DocumentServer 10.0.0.1), declared by hand: the API
// publishes no types for this version. Only what the plugin calls is listed.

interface ApiRange {
  GetText(): string;
  Delete(): void;
  AddText(text: string, where: 'before' | 'after'): void;
  AddComment(text: string, author: string): void;
}

interface ApiElement {
  GetClassType(): string;
  GetText?(): string;
  GetRange(): ApiRange;
  GetTag(): string;
}

interface ApiRun {
  AddText(text: string): void;
  AddLineBreak(): void;
}

interface ApiContentControl {
  AddElement(element: ApiRun | ApiParagraph, position: number): void;
  SetTag(tag: string): void;
  SetAlias(alias: string): void;
  SetLock(lock: 'contentLocked' | 'sdtContentLocked'): void;
}

interface ApiParagraph {
  GetClassType(): string;
  GetElementsCount(): number;
  GetElement(index: number): ApiElement;
  Search(text: string, matchCase: boolean): ApiRange[] | null;
  AddText(text: string): void;
  AddElement(element: ApiRun, position: number): void;
  AddInlineLvlSdt(control: ApiContentControl): void;
}

interface ApiDocumentContent {
  GetElementsCount(): number;
  GetElement(index: number): ApiParagraph;
}

interface ApiSection {
  GetHeader(type: string, create: boolean): ApiDocumentContent | null;
  GetFooter(type: string, create: boolean): ApiDocumentContent | null;
}

interface ApiDocument {
  GetAllParagraphs(): ApiParagraph[];
  GetSections(): ApiSection[];
  GetAllContentControls(): ApiElement[];
  IsTrackRevisions(): boolean;
  SetTrackRevisions(on: boolean): void;
  InsertContent(content: Array<ApiParagraph | ApiContentControl>, inline?: boolean): void;
}

/** What a command reads from `Asc.scope` (built by the bridge from the operation's keys only). */
interface CommandScope {
  paragraphIndex: number;
  occurrence: number;
  find: string;
  context: string;
  replace: string;
  comment?: { text: string; author: string };
  text: string;
  author: string;
  rowId: string;
  label: string;
  value: string;
  kind: 'inline' | 'block';
  token: string;
}

interface AscPlugin {
  init: (data?: unknown) => void;
  button: (id: number) => void;
  info?: { options?: unknown };
  callCommand(fn: () => unknown, isClose: boolean, isCalc: boolean, callback: (result: unknown) => void): void;
  executeMethod(name: string, args: unknown[], callback: (result: unknown) => void): void;
  executeCommand(name: string, data: string): void;
}

declare const Api: {
  GetDocument(): ApiDocument;
  CreateRun(): ApiRun;
  CreateParagraph(): ApiParagraph;
  CreateInlineLvlSdt(): ApiContentControl;
  CreateBlockLvlSdt(): ApiContentControl;
};

declare const Asc: { scope: CommandScope; plugin: AscPlugin };

interface Window {
  Asc?: { scope: unknown; plugin: AscPlugin };
  udocBridgeStats?: { ignored: number; answered: number; timedOut: number };
}
