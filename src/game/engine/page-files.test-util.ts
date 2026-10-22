import { readFile } from "node:fs/promises";

/** The page's files: every URL the loads ask for is root-relative (`BASE_URL` is "/" in node). */
const PUBLIC = new URL("../../../public/", import.meta.url);

/**
 * The page's file loads in node, answered from `public/`: `fetch` (an image loader passes a URL, three's `FileLoader` a `Request`, which node
 * builds only from an absolute URL, so a stand-in keeps the root-relative one) and the `ProgressEvent` its progress reports make.
 */
export function servePublic(): void {
  Object.assign(globalThis, {
    Request: class {
      readonly url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
    ProgressEvent: class extends Event {
      constructor(type: string, init: object) {
        super(type);
        Object.assign(this, init);
      }
    },
    fetch: async (input: string | { url: string }) => new Response(await readFile(new URL((typeof input === "string" ? input : input.url).slice(1), PUBLIC))),
  });
}
