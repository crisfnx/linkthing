import type { TrackingParam } from "@/lib/extract/types";
import { registrableDomain } from "./domain";
import { DEFAULT_TRACKING_PARAMS } from "./tracking-params";

// Bump when canonicalize() or toUrlKey() changes what they return: stored
// links are then re-keyed (PRD §4.4).
export const CANONICALIZER_VERSION = 1;

const valuePatterns = new Map<string, RegExp>();

function valuePattern(source: string): RegExp {
  let pattern = valuePatterns.get(source);
  if (!pattern) {
    pattern = new RegExp(source);
    valuePatterns.set(source, pattern);
  }
  return pattern;
}

function decode(text: string): string {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function isTracking(
  part: string,
  domain: string,
  rules: readonly TrackingParam[],
): boolean {
  const equals = part.indexOf("=");
  const name = decode(equals === -1 ? part : part.slice(0, equals));
  const value = equals === -1 ? "" : decode(part.slice(equals + 1));

  return rules.some(
    (rule) =>
      (rule.param.endsWith("*")
        ? name.startsWith(rule.param.slice(0, -1))
        : name === rule.param) &&
      (!rule.hosts || rule.hosts.includes(domain)) &&
      !rule.exceptHosts?.includes(domain) &&
      (!rule.value || valuePattern(rule.value).test(value)),
  );
}

// The cleaned URL shown and exported (PRD §4.4). URL already lowercases the
// scheme and host and drops default ports; this drops userinfo and tracking
// parameters. Parameters are filtered on the raw query string, never through
// URLSearchParams, which would re-encode every one that stays.
export function canonicalize(
  url: string,
  rules: readonly TrackingParam[] = DEFAULT_TRACKING_PARAMS,
): string {
  const parsed = new URL(url);
  parsed.username = "";
  parsed.password = "";

  const domain = registrableDomain(parsed.hostname);
  parsed.search = parsed.search
    .slice(1)
    .split("&")
    .filter((part) => part !== "" && !isTracking(part, domain, rules))
    .join("&");

  return parsed.href;
}
