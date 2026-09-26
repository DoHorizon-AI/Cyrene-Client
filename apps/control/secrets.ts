import { readFile } from "node:fs/promises";

type Environment = Readonly<Record<string, string | undefined>>;
type SecretReader = (path: string, encoding: BufferEncoding) => Promise<string>;

/** Read one server-side secret without silently choosing between two sources. */
export async function readConfiguredSecret(
  name: string,
  environment: Environment = process.env,
  reader: SecretReader = readFile,
): Promise<string | undefined> {
  const inline = environment[name]?.trim();
  const file = environment[`${name}_FILE`]?.trim();
  if (inline && file) throw new Error(`${name} and ${name}_FILE are mutually exclusive`);
  if (!file) return inline || undefined;
  const value = (await reader(file, "utf8")).trim();
  if (!value) throw new Error(`${name}_FILE points to an empty secret`);
  return value;
}
