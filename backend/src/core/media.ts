const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

export function normalizeImageInput(input: {
  base64: string;
  mimetype?: string;
  filename?: string;
}): { raw: string; dataUrl: string; mimetype: string; filename: string; bytes: number } {
  const source = input.base64.trim();
  const dataUrlMatch = source.match(/^data:([^;]+);base64,(.+)$/i);
  const mimetype = (dataUrlMatch?.[1] ?? input.mimetype ?? "image/jpeg").toLowerCase();
  const raw = (dataUrlMatch?.[2] ?? source).replace(/\s/g, "");
  if (!ALLOWED_IMAGE_TYPES.has(mimetype)) {
    throw Object.assign(new Error("Only JPEG, PNG, WebP, and GIF images are supported"), { status: 400 });
  }
  if (!raw) {
    throw Object.assign(new Error("Image data is required"), { status: 400 });
  }
  const bytes = Math.floor((raw.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("Image is too large (max 6 MB)"), { status: 400 });
  }
  return {
    raw,
    dataUrl: `data:${mimetype};base64,${raw}`,
    mimetype,
    filename: input.filename?.trim() || defaultFilename(mimetype),
    bytes,
  };
}

export function dataUrlFromBase64(value: string, mimetype = "image/jpeg"): string | null {
  const source = value.trim();
  if (!source) return null;
  if (source.startsWith("data:")) return source;
  return `data:${mimetype};base64,${source.replace(/\s/g, "")}`;
}

function defaultFilename(mimetype: string): string {
  if (mimetype === "image/png") return "image.png";
  if (mimetype === "image/webp") return "image.webp";
  if (mimetype === "image/gif") return "image.gif";
  return "image.jpg";
}
