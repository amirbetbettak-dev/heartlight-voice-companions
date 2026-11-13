// Browser-safe helpers for displaying the memory notes.
/** Split the AI-maintained memory notes into separate items for display. */
export function memoryItems(summary: string) {
  return summary
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-•*–]|\d+[.)]|[۰-۹]+[.)])\s*/, "").trim())
    .filter(Boolean);
}
