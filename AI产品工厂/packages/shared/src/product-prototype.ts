export const PRODUCT_PROTOTYPE_START = "<!-- PRODUCT_PROTOTYPE_START -->";
export const PRODUCT_PROTOTYPE_END = "<!-- PRODUCT_PROTOTYPE_END -->";

type PrototypeEvent = {
  type: string;
  payload: Record<string, unknown>;
};

export type ProductPrototype = {
  title: string;
  href: string;
};

export const extractProductPrototypeHtml = (output: string) => {
  const start = output.indexOf(PRODUCT_PROTOTYPE_START);
  const end = output.indexOf(PRODUCT_PROTOTYPE_END);
  if (start < 0 || end <= start) return null;
  const html = output.slice(start + PRODUCT_PROTOTYPE_START.length, end).trim();
  if (!/^<!doctype html>/i.test(html) || !/<html[\s>]/i.test(html)) return null;
  return html;
};

export const stripProductPrototype = (output: string) => {
  const start = output.indexOf(PRODUCT_PROTOTYPE_START);
  const end = output.indexOf(PRODUCT_PROTOTYPE_END);
  if (start < 0 || end <= start) return output.trim();
  return `${output.slice(0, start)}${output.slice(end + PRODUCT_PROTOTYPE_END.length)}`.trim();
};

export const getProductPrototype = (events: PrototypeEvent[]): ProductPrototype | null => {
  const artifact = [...events]
    .reverse()
    .find(
      (event) =>
        event.type === "artifact.created" && event.payload.kind === "product-prototype-html"
    );
  if (!artifact) return null;
  const href = artifact.payload.href;
  if (typeof href !== "string" || !href.startsWith("/")) return null;
  const title = artifact.payload.title;
  return {
    title: typeof title === "string" && title.trim() ? title.trim() : "产品基础 HTML",
    href
  };
};
