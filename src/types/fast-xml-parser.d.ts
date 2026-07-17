declare module "fast-xml-parser" {
  export class XMLParser {
    constructor(options?: Record<string, unknown>);
    parse(input: string): unknown;
  }
}
