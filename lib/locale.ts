// The day/month order a language writes dates in: the default answer when a
// chat's dates fit both (§3), until Settings hold one (M4). Asked of Intl, not
// listed: month first is "en-US", and a few others like it.
export function dateOrderFor(locale: string): "DMY" | "MDY" {
  try {
    const order = new Intl.DateTimeFormat(locale, { dateStyle: "short" })
      .formatToParts(new Date(2024, 4, 25))
      .map((part) => part.type)
      .filter((type) => type === "year" || type === "month" || type === "day");
    return order[0] === "month" ? "MDY" : "DMY";
  } catch {
    return "DMY"; // not a language tag Intl knows
  }
}
