#!/usr/bin/env node
// Regenerate the QUEST LOG section of README.md from quests.yml.
//
// Reads:   quests.yml
// Writes:  README.md (between <!-- QUEST_LOG:START --> and <!-- QUEST_LOG:END -->)
//
// Optional: GITHUB_TOKEN / PAT_TOKEN for fetching pushed_at on private repos
// to render the 🆕 freshness badge. Without a token, public repos still work;
// private repos render without the badge.

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const QUESTS_PATH = resolve(ROOT, "quests.yml");
const README_PATH = resolve(ROOT, "README.md");

const OWNER = process.env.GITHUB_OWNER || "cruway";
const TOKEN = process.env.GITHUB_TOKEN || process.env.PAT_TOKEN || "";

const STATUS_ICONS = {
  fire: "🔥",
  bolt: "⚡",
  wrench: "🛠️",
  game: "🎮",
};

const START = "<!-- QUEST_LOG:START -->";
const END = "<!-- QUEST_LOG:END -->";

function statusIcon(status) {
  return STATUS_ICONS[status] || "•";
}

function fmtTech(tech) {
  if (!Array.isArray(tech) || tech.length === 0) return "";
  return tech.map((t) => `\`${t}\``).join(" ");
}

function fmtRelative(pushedAt) {
  if (!pushedAt) return "";
  const diffMs = Date.now() - new Date(pushedAt).getTime();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(days / 365);
  return `${years}y ago`;
}

async function fetchPushedAt(name) {
  if (!name) return null;
  const headers = { Accept: "application/vnd.github+json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  try {
    const res = await fetch(`https://api.github.com/repos/${OWNER}/${name}`, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return data.pushed_at || null;
  } catch {
    return null;
  }
}

function questLink(quest) {
  const display = `**${quest.name}**`;
  if (quest.private) return display;
  return `[${display}](https://github.com/${OWNER}/${quest.name})`;
}

async function buildRows(quests, defaults) {
  const freshDaysDefault = defaults.fresh_days ?? 7;
  const rows = await Promise.all(
    quests.map(async (q) => {
      if (q.hide) return null;
      const pushedAt = await fetchPushedAt(q.name);
      const freshDays = q.fresh_days ?? freshDaysDefault;
      const ageMs = pushedAt ? Date.now() - new Date(pushedAt).getTime() : null;
      const isFresh = ageMs !== null && ageMs <= freshDays * 24 * 60 * 60 * 1000;

      const questCell = isFresh ? `${questLink(q)} 🆕` : questLink(q);
      const updated = fmtRelative(pushedAt) || "—";
      return `| ${statusIcon(q.status)} | ${questCell} | ${q.description ?? ""} | ${fmtTech(q.tech)} | ${updated} |`;
    })
  );
  return rows.filter(Boolean);
}

function renderTable(rows) {
  const header = [
    "| Status | Quest | Description | Tech | Updated |",
    "|:------:|-------|-------------|------|:-------:|",
  ];
  return [...header, ...rows].join("\n");
}

function renderBlock(table, generatedAt) {
  return [
    START,
    "",
    '<div align="center">',
    "",
    table,
    "",
    "</div>",
    "",
    "> 🗝️ *Some quests are hidden in private dungeons...*",
    `<sub>⏱ Auto-generated from \`quests.yml\` · last update: ${generatedAt}</sub>`,
    "",
    END,
  ].join("\n");
}

function replaceBlock(readme, block) {
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Markers not found in README.md. Add ${START} and ${END} around the QUEST LOG section.`
    );
  }
  const before = readme.slice(0, startIdx);
  const after = readme.slice(endIdx + END.length);
  return `${before}${block}${after}`;
}

async function main() {
  const raw = await readFile(QUESTS_PATH, "utf8");
  const data = yaml.load(raw) || {};
  const quests = Array.isArray(data.quests) ? data.quests : [];
  const defaults = data.defaults || {};

  const rows = await buildRows(quests, defaults);
  const table = renderTable(rows);
  const generatedAt = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  const block = renderBlock(table, generatedAt);

  const readme = await readFile(README_PATH, "utf8");
  const next = replaceBlock(readme, block);

  if (next === readme) {
    console.log("No README changes.");
    return;
  }
  await writeFile(README_PATH, next, "utf8");
  console.log(`README.md updated (${rows.length} quests).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
