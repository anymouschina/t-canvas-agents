export type SkillFrontMatter = {
  name?: string;
  description?: string;
};

export function parseFrontMatter(text: string): SkillFrontMatter {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---")) {
    return {};
  }

  const start = trimmed.indexOf("\n");
  if (start === -1) {
    return {};
  }
  const end = trimmed.indexOf("\n---", start);
  if (end === -1) {
    return {};
  }

  const yaml = trimmed.slice(start + 1, end);
  const out: SkillFrontMatter = {};

  for (const line of yaml.split("\n")) {
    const t = line.trim();
    if (t === "" || t.startsWith("#")) {
      continue;
    }
    const colon = t.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = t.slice(0, colon).trim();
    const value = t.slice(colon + 1).trim();
    if (key === "name") {
      out.name = stripQuotes(value);
    } else if (key === "description") {
      out.description = stripQuotes(value);
    }
  }

  return out;
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    return v.slice(1, -1);
  }
  return v;
}

