import type { TrackingParam } from "@/lib/extract/types";

// The built-in rules (PRD Appendix B). Hosts are registrable domains, so
// "twitter.com" also covers mobile.twitter.com.
const TWITTER = ["twitter.com", "x.com"];
const YOUTUBE = ["youtube.com", "youtu.be"];

const EVERYWHERE = [
  "utm_*",
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "igshid",
  "igsh",
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "rdt_cid",
  "twclid",
  "ttclid",
  "ref_src",
  "ref_url",
  "_ga",
  "_gl",
  "yclid",
  "vero_id",
  "oly_anon_id",
  "oly_enc_id",
];

export const DEFAULT_TRACKING_PARAMS: readonly TrackingParam[] = [
  ...EVERYWHERE.map((param) => ({ param })),
  // On code hosts `ref` names a branch or tag.
  { param: "ref", exceptHosts: ["github.com", "gitlab.com", "bitbucket.org"] },
  // On YouTube `t` is a timestamp, so it is only stripped on X.
  { param: "t", hosts: TWITTER },
  { param: "s", hosts: TWITTER },
  // X's share code travels with links shared from X; a WordPress search
  // (`?s=oak+shelf`) keeps its words.
  { param: "s", value: "^\\d{2}$" },
  { param: "feature", hosts: YOUTUBE },
  { param: "si", hosts: [...YOUTUBE, "spotify.com"] },
];
