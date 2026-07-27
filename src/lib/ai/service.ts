import { createHash } from "node:crypto";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

export class AiUnavailableError extends Error {}

export async function generateStructured<T extends z.ZodType>(
  userId: string,
  schema: T,
  schemaName: string,
  instructions: string,
  input: unknown,
): Promise<z.infer<T>> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new AiUnavailableError(
      "未配置 OpenAI Key；其他管理功能仍可完整使用",
    );
  }
  const client = new OpenAI({ apiKey });
  const response = await client.responses.parse({
    model: process.env.OPENAI_MODEL || "gpt-5.6-sol",
    store: false,
    reasoning: { effort: "low" },
    safety_identifier: createHash("sha256")
      .update(`shouzhong:${userId}`)
      .digest("hex"),
    instructions,
    input: JSON.stringify(input),
    text: {
      format: zodTextFormat(schema, schemaName),
      verbosity: "low",
    },
  });
  if (!response.output_parsed) {
    throw new Error("模型未返回可用的结构化草稿");
  }
  return response.output_parsed as z.infer<T>;
}
