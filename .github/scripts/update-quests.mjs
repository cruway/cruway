#!/usr/bin/env node
// Regenerate the QUEST LOG and HUD sections of README.md from quests.yml
// plus live GitHub profile data.
//
// Reads:   quests.yml
// Writes:  README.md
//            - QUEST LOG  between <!-- QUEST_LOG:START --> / <!-- QUEST_LOG:END -->
//            - HUD bar    between <!-- HUD:START -->       / <!-- HUD:END -->
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
const HUD_START = "<!-- HUD:START -->";
const HUD_END = "<!-- HUD:END -->";

// Inner width of every ASCII box in README.md. Keep in sync with the boxes
// there -- the HUD bar has to line up with the header/hero panels.
const BOX_INNER = 64;

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

function boxLine(text) {
  const chars = [...text];
  const body = chars.length > BOX_INNER ? chars.slice(0, BOX_INNER).join("") : text;
  const width = [...body].length;
  const left = Math.floor((BOX_INNER - width) / 2);
  const right = BOX_INNER - width - left;
  return `\u2551${" ".repeat(left)}${body}${" ".repeat(right)}\u2551`;
}

async function fetchUserStats(questCount) {
  const headers = { Accept: "application/vnd.github+json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;

  let repos = null;
  let followers = null;
  let level = null;
  let contributions = null;

  try {
    const res = await fetch(`https://api.github.com/users/${OWNER}`, { headers });
    if (res.ok) {
      const user = await res.json();
      repos = user.public_repos ?? null;
      followers = user.followers ?? null;
      if (user.created_at) {
        const since = new Date(user.created_at).getFullYear();
        level = Math.max(1, new Date().getFullYear() - since);
      }
    }
  } catch {
    // leave the fields null; the HUD renders "--" for anything missing
  }

  // Contribution totals are GraphQL-only, so this needs a token.
  if (TOKEN) {
    try {
      const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          query:
            "query($login:String!){user(login:$login){contributionsCollection" +
            "{contributionCalendar{totalContributions}}}}",
          variables: { login: OWNER },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        contributions =
          json?.data?.user?.contributionsCollection?.contributionCalendar
            ?.totalContributions ?? null;
      }
    } catch {
      // same as above
    }
  }

  return { repos, followers, level, contributions, quests: questCount };
}

function renderHud(stats) {
  const num = (n) => (n === null || n === undefined ? "--" : n.toLocaleString("en-US"));
  const bar = [
    `LV.${stats.level ?? "--"}`,
    `EXP ${num(stats.contributions)}`,
    `REPOS ${num(stats.repos)}`,
    `ALLIES ${num(stats.followers)}`,
    `QUESTS ${num(stats.quests)}`,
  ].join("   ");

  return [
    HUD_START,
    "",
    "```",
    `\u2554${"\u2550".repeat(BOX_INNER)}\u2557`,
    boxLine(""),
    boxLine(bar),
    boxLine(""),
    `\u255a${"\u2550".repeat(BOX_INNER)}\u255d`,
    "```",
    "",
    HUD_END,
  ].join("\n");
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

function replaceBlock(readme, block, start, end) {
  const startIdx = readme.indexOf(start);
  const endIdx = readme.indexOf(end);
  if (startIdx === -1 || endIdx === -1) return null;
  const before = readme.slice(0, startIdx);
  const after = readme.slice(endIdx + end.length);
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

  const readme = await readFile(README_PATH, "utf8");

  let next = replaceBlock(readme, renderBlock(table, generatedAt), START, END);
  if (next === null) {
    throw new Error(
      `Markers not found in README.md. Add ${START} and ${END} around the QUEST LOG section.`
    );
  }

  const stats = await fetchUserStats(rows.length);
  const hudApplied = replaceBlock(next, renderHud(stats), HUD_START, HUD_END);
  if (hudApplied === null) {
    console.warn(`HUD markers not found (${HUD_START} / ${HUD_END}); skipping HUD.`);
  } else {
    next = hudApplied;
  }

  if (next === readme) {
    console.log("No README changes.");
    return;
  }
  await writeFile(README_PATH, next, "utf8");
  console.log(
    `README.md updated (${rows.length} quests, HUD ${hudApplied === null ? "skipped" : "on"}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
