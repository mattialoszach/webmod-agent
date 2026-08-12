import { z } from "zod";
import type { WebModOperation } from "../shared/types";

export const ALLOWED_STYLE_PROPERTIES = [
  "align-items",
  "background",
  "background-color",
  "border",
  "border-color",
  "border-radius",
  "border-style",
  "border-width",
  "box-shadow",
  "color",
  "display",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "gap",
  "height",
  "justify-content",
  "letter-spacing",
  "line-height",
  "margin",
  "margin-bottom",
  "margin-left",
  "margin-right",
  "margin-top",
  "max-height",
  "max-width",
  "min-height",
  "min-width",
  "opacity",
  "padding",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "text-align",
  "text-decoration",
  "text-transform",
  "transform",
  "width"
] as const;

const forbiddenCss = /(?:url\s*\(|expression\s*\(|javascript:|@import|-moz-binding|behavior\s*:)/i;
const safeStyleValueSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !forbiddenCss.test(value), "Unsafe CSS value");

const styleRecordSchema = z
  .record(z.string(), safeStyleValueSchema)
  .superRefine((styles, context) => {
    const allowed = new Set<string>(ALLOWED_STYLE_PROPERTIES);
    for (const property of Object.keys(styles)) {
      if (!allowed.has(property)) {
        context.addIssue({
          code: "custom",
          message: `Unsupported style property: ${property}`,
          path: [property]
        });
      }
    }
  });

const safeUrlSchema = z.string().max(2048).refine((value) => {
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    const protocol = new URL(value).protocol;
    return ["https:", "http:", "mailto:", "tel:"].includes(protocol);
  } catch {
    return false;
  }
}, "Unsupported or unsafe URL");

const elementIdSchema = z.string().regex(/^wm_\d+$/);

export const webModOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replaceText"),
    elementId: elementIdSchema,
    value: z.string().max(10_000)
  }).strict(),
  z.object({
    type: z.literal("setStyles"),
    elementId: elementIdSchema,
    styles: styleRecordSchema
  }).strict(),
  z.object({
    type: z.literal("hide"),
    elementId: elementIdSchema
  }).strict(),
  z.object({
    type: z.literal("replaceImage"),
    elementId: elementIdSchema,
    src: safeUrlSchema
  }).strict(),
  z.object({
    type: z.literal("setAttribute"),
    elementId: elementIdSchema,
    attribute: z.enum(["alt", "title", "aria-label", "placeholder", "href", "target"]),
    value: z.string().max(2048)
  }).strict().superRefine((operation, context) => {
    if (operation.attribute === "href") {
      const parsed = safeUrlSchema.safeParse(operation.value);
      if (!parsed.success) {
        context.addIssue({ code: "custom", message: "Unsafe href", path: ["value"] });
      }
    }
    if (operation.attribute === "target" && !["_self", "_blank"].includes(operation.value)) {
      context.addIssue({ code: "custom", message: "Unsupported target", path: ["value"] });
    }
  })
]);

export const operationEnvelopeSchema = z.object({
  operations: z.array(webModOperationSchema).max(30)
}).strict();

export function validateOperations(value: unknown): WebModOperation[] {
  return operationEnvelopeSchema.parse(value).operations;
}

export const operationJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["operations"],
  properties: {
    operations: {
      type: "array",
      maxItems: 30,
      items: {
        oneOf: [
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "elementId", "value"],
            properties: {
              type: { const: "replaceText" },
              elementId: { type: "string", pattern: "^wm_[0-9]+$" },
              value: { type: "string", maxLength: 10000 }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "elementId", "styles"],
            properties: {
              type: { const: "setStyles" },
              elementId: { type: "string", pattern: "^wm_[0-9]+$" },
              styles: {
                type: "object",
                additionalProperties: { type: "string", maxLength: 200 }
              }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "elementId"],
            properties: {
              type: { const: "hide" },
              elementId: { type: "string", pattern: "^wm_[0-9]+$" }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "elementId", "src"],
            properties: {
              type: { const: "replaceImage" },
              elementId: { type: "string", pattern: "^wm_[0-9]+$" },
              src: { type: "string", maxLength: 2048 }
            }
          },
          {
            type: "object",
            additionalProperties: false,
            required: ["type", "elementId", "attribute", "value"],
            properties: {
              type: { const: "setAttribute" },
              elementId: { type: "string", pattern: "^wm_[0-9]+$" },
              attribute: {
                enum: ["alt", "title", "aria-label", "placeholder", "href", "target"]
              },
              value: { type: "string", maxLength: 2048 }
            }
          }
        ]
      }
    }
  }
} as const;
