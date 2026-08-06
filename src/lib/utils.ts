/**
 * Joins CSS class names, dropping anything falsy.
 *
 * Lets a component write `cn("base", isActive && "active")` without producing
 * "base false" in the class attribute. Deliberately dependency-free — the
 * popular `clsx`/`classnames` packages do the same job, and this is small
 * enough not to be worth a download on a metered connection.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

/**
 * Formats an amount held in kobo as naira, e.g. 4_500_000_00 → "₦4,500,000".
 *
 * All money in this app is stored as an integer number of kobo (see the schema
 * migration). Conversion to a display string happens here and nowhere else, so
 * prices are formatted identically on every screen.
 */
export function formatNaira(
  amountKobo: number,
  options: { showKobo?: boolean } = {}
): string {
  const naira = amountKobo / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    // Property prices are whole naira; kobo would just be noise in a list view.
    minimumFractionDigits: options.showKobo ? 2 : 0,
    maximumFractionDigits: options.showKobo ? 2 : 0,
  }).format(naira);
}
