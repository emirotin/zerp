import type { CheckReport, CheckTheme, Finding } from "./types.js";

const ICONS: Record<Finding["severity"], string> = {
  error: "✗",
  warning: "⚠",
  unverifiable: "?",
};

function countBy(report: CheckReport, theme: CheckTheme): string {
  const count = (severity: Finding["severity"]): number =>
    report.findings.filter((f) => f.theme === theme && f.severity === severity).length;
  return `${theme}: ${count("error")} errors, ${count("warning")} warnings, ${count("unverifiable")} unverifiable`;
}

export function reportHasFailures(report: CheckReport, strict: boolean): boolean {
  return report.findings.some(
    (f) => f.severity === "error" || (strict && f.severity === "warning"),
  );
}

export function formatReport(report: CheckReport, options: { summaryOnly?: boolean } = {}): string {
  const lines: string[] = [];
  const themeSummary = report.themes.map((theme) => countBy(report, theme)).join(" · ");
  const summary = `zerp check — ${report.slideCount} slides · ${themeSummary}`;
  if (options.summaryOnly) {
    lines.push(summary);
    if (report.findings.length > 0) {
      lines.push("run `zerp check` for details");
    }
    return `${lines.join("\n")}\n`;
  }
  lines.push(summary, "");
  const groups = new Map<string, Finding[]>();
  for (const finding of report.findings) {
    const key = `${finding.slideIndex}|${finding.theme}`;
    const group = groups.get(key) ?? [];
    group.push(finding);
    groups.set(key, group);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const [aIndex = "0", aTheme = ""] = a.split("|");
    const [bIndex = "0", bTheme = ""] = b.split("|");
    return Number(aIndex) - Number(bIndex) || aTheme.localeCompare(bTheme);
  });
  for (const key of keys) {
    const group = groups.get(key) ?? [];
    const first = group[0];
    if (!first) {
      continue;
    }
    const [ordinal = "1", ofFile = "1"] = (first.slideSrcSlide ?? "").split("/");
    const inFile = Number(ofFile) > 1 ? ` · ${ordinal}/${ofFile} in file` : "";
    const src = first.slideSrc ? ` (${first.slideSrc}${inFile})` : "";
    lines.push(`slide ${first.slideIndex}${src} [${first.theme}]`);
    for (const finding of group) {
      lines.push(`  ${ICONS[finding.severity]} "${finding.snippet}" — ${finding.message}`);
      if (finding.suggestion) {
        lines.push(`    fix: ${finding.suggestion}`);
      }
    }
    lines.push("");
  }
  if (report.skippedSelectors.length > 0) {
    lines.push(`skipped selectors (not checked): ${report.skippedSelectors.join(", ")}`);
  }
  if (report.findings.length === 0) {
    lines.push("all clear ✓");
  }
  return `${lines.join("\n")}\n`;
}
