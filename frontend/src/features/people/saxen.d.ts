declare module "saxen" {
  export class Parser {
    on(event: "openTag", handler: (name: string, attributes: () => Record<string, string>, decodeEntities: (value: string) => string, selfClosing: boolean) => void): void;
    on(event: "closeTag", handler: (name: string) => void): void;
    on(event: "error" | "warn", handler: (error: unknown) => void): void;
    on(event: "attention", handler: (value: string) => void): void;
    parse(xml: string): unknown;
  }
}
