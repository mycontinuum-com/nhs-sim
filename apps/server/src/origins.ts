import { z } from "zod";

const originSchema = z.url().refine(value => {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password &&
    url.pathname === "/" && !url.search && !url.hash;
}, "Public origins must be HTTP(S) origins without paths or credentials").transform(value => new URL(value).origin);

export class PublicOrigins {
  readonly primary: string;
  readonly values: readonly string[];

  constructor(primary: string, additional = "") {
    this.primary = originSchema.parse(primary);
    this.values = [...new Set([this.primary, ...additional.split(",").map(value => value.trim()).filter(Boolean).map(value => originSchema.parse(value))])];
  }

  forHost(host: string | undefined): string {
    return this.values.find(origin => new URL(origin).host === host?.toLowerCase()) ?? this.primary;
  }

  allows(origin: string | undefined): boolean {
    return origin === undefined || this.values.includes(origin);
  }
}
