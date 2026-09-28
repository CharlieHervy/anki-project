import Database from "better-sqlite3";
import archiver from "archiver";
import { createWriteStream, createReadStream, unlinkSync } from "fs";
import { join } from "path";
import { randomInt } from "crypto";

interface Card {
  text: string;
  extra: string;
  tags?: string;
  deck?: string;
  logg?: string;
  bild?: string;
}

const MODEL_ID = 1607392319;

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500&display=swap');

/* ── CSS-variabler (ljusläge) ──────────────────────────────── */
:root {
  --ink:    #0d0d0d;
  --paper:  #f7f5f0;
  --cream:  #ede9e1;
  --rule:   #d8d3c8;
  --muted:  #8a8478;
  --gold:   #c9a84c;
}

/* ── Grundkort ─────────────────────────────────────────────── */
.card {
  font-family: 'DM Serif Display', Georgia, serif;
  font-size: 1.05rem;
  line-height: 1.65;
  text-align: center;
  color: var(--ink);
  background-color: var(--paper);
  max-width: 640px;
  margin: 0 auto;
  padding: 40px 28px;
  border: 1px solid var(--rule);
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}

/* ── Cloze-lucka (framsidan) och cloze-svar (baksidan) ─────── */
.cloze {
  font-weight: bold;
  color: var(--gold);
}

/* ── Extra-fält ────────────────────────────────────────────── */
.extra-divider {
  width: 50%;
  margin: 22px auto 16px auto;
  border: none;
  border-top: 1px solid var(--rule);
}

.extra-text {
  font-family: 'DM Sans', sans-serif;
  font-weight: 300;
  font-size: 0.82rem;
  color: var(--muted);
  line-height: 1.55;
}

/* ── Bild ──────────────────────────────────────────────────── */
.bild-container {
  margin-top: 20px;
}

.bild-container img {
  max-width: 100%;
  border-radius: 4px;
}

/* ── Nattläge ──────────────────────────────────────────────── */
.nightMode .card {
  --ink:   #e4e0d8;
  --paper: #1c1b18;
  --rule:  #3c3b38;
  --muted: #7a7870;
  background-color: var(--paper) !important;
  color: var(--ink) !important;
}

.nightMode .cloze {
  color: var(--gold);
}
`;

const QUESTION_TEMPLATE = "{{cloze:Text}}";
const ANSWER_TEMPLATE = `{{cloze:Text}}

{{#Back Extra}}
<div class="extra-divider"></div>
<div class="extra-text">{{Back Extra}}</div>
{{/Back Extra}}

{{#Bild}}
<div class="bild-container">{{Bild}}</div>
{{/Bild}}`;

interface DeckInfo {
  id: number;
  name: string;
  notes: Note[];
}

interface Note {
  id: number;
  did: number;
  mid: number;
  mod: number;
  usn: number;
  tags: string;
  flds: string;
  sfld: string;
  csum: number;
  flags: number;
  data: string;
}

export async function exportToApkg(
  cards: Card[],
  outputPath: string
): Promise<string> {
  // Create temporary SQLite database
  const dbPath = join("/tmp", `anki_${Date.now()}.db`);
  const db = new Database(dbPath);

  try {
    initializeDatabase(db);

    // Create model
    const modelId = MODEL_ID;
    insertModel(db, modelId);

    // Group cards by deck
    const decksDict: { [key: string]: Card[] } = {};
    for (const card of cards) {
      const deckName = card.deck || "Huvudmeny";
      if (!decksDict[deckName]) {
        decksDict[deckName] = [];
      }
      decksDict[deckName].push(card);
    }

    // Create decks and notes
    let noteId = 1000;
    for (const [deckName, deckCards] of Object.entries(decksDict)) {
      const deckId = randomInt(1 << 30, 1 << 31);
      insertDeck(db, deckId, deckName);

      for (const card of deckCards) {
        const note = createNote(noteId, deckId, modelId, card);
        insertNote(db, note);
        insertCard(db, noteId, deckId, modelId);
        noteId++;
      }
    }

    // Close and zip
    db.close();

    await createApkgFile(dbPath, outputPath);
    unlinkSync(dbPath);

    return outputPath;
  } catch (error) {
    db.close();
    unlinkSync(dbPath);
    throw error;
  }
}

function initializeDatabase(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS col (
      id INTEGER PRIMARY KEY,
      crt INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      scm INTEGER NOT NULL,
      ver INTEGER NOT NULL,
      dty INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      ls INTEGER NOT NULL,
      lsmod INTEGER NOT NULL,
      conf TEXT NOT NULL,
      models TEXT NOT NULL,
      decks TEXT NOT NULL,
      dconf TEXT NOT NULL,
      tags TEXT NOT NULL,
      _schedVer INTEGER NOT NULL,
      _lastSave INTEGER NOT NULL,
      _debugLog TEXT
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY,
      guid TEXT NOT NULL UNIQUE,
      mid INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      tags TEXT NOT NULL,
      flds TEXT NOT NULL,
      sfld TEXT NOT NULL,
      csum INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY,
      nid INTEGER NOT NULL,
      did INTEGER NOT NULL,
      ord INTEGER NOT NULL,
      mod INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      type INTEGER NOT NULL,
      queue INTEGER NOT NULL,
      due INTEGER NOT NULL,
      ivl INTEGER NOT NULL,
      factor INTEGER NOT NULL,
      reps INTEGER NOT NULL,
      lapses INTEGER NOT NULL,
      left INTEGER NOT NULL,
      odue INTEGER NOT NULL,
      odid INTEGER NOT NULL,
      flags INTEGER NOT NULL,
      data TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revlog (
      id INTEGER PRIMARY KEY,
      cid INTEGER NOT NULL,
      usn INTEGER NOT NULL,
      ease INTEGER NOT NULL,
      ivl INTEGER NOT NULL,
      lastIvl INTEGER NOT NULL,
      factor INTEGER NOT NULL,
      time INTEGER NOT NULL,
      type INTEGER NOT NULL
    );
  `);

  // Insert collection metadata
  const now = Math.floor(Date.now() / 1000);
  const conf = JSON.stringify({
    nextPos: 1,
    sortType: "noteFld",
    sortBackwards: false,
    addTocSidebar: true,
    estTimes: true,
    activeDecks: [1],
    newSpread: 0,
    newBury: true,
    newPerDay: 20,
    revPerDay: 200,
    maxTaken: 60000,
    hardFactor: 1.2,
    wheelFactor: 1.35,
    hardMinutes: 1,
    leechFails: 8,
    leechAction: 0,
    lastLoadedDid: 1,
    lastTab: 0,
    lastTagFilter: "",
    saveNow: false,
    autosave: 10,
    lastSave: now,
  });

  db.prepare(
    `
    INSERT INTO col (
      id, crt, mod, scm, ver, dty, usn, ls, lsmod, conf, models, decks, dconf, tags,
      _schedVer, _lastSave, _debugLog
    ) VALUES (
      ?, ?, ?, ?, 11, 0, 0, ?, ?, ?, '{}', '{}', '{}', '{}', 2, ?, NULL
    )
  `
  ).run(1, now, now, now, now, conf, now);
}

function insertModel(db: Database.Database, modelId: number) {
  const now = Math.floor(Date.now() / 1000);
  const model = {
    id: modelId,
    name: "Cloze_Auto",
    type: 1,
    did: null,
    mod: now,
    usn: -1,
    sortf: 0,
    latexPost: "\\end{document}",
    latexPre:
      "\\documentclass[12pt]{article}\\special{papersize=8.5in,11in}\\usepackage[utf-8]{inputenc}\\usepackage{amssymb}\\pagestyle{empty}\\setlength{\\parindent}{0in}\\begin{document}",
    tmpls: [
      {
        name: "Cloze_Auto",
        ord: 0,
        qfmt: QUESTION_TEMPLATE,
        afmt: ANSWER_TEMPLATE,
        bqfmt: "",
        bafmt: "",
        didLastSorted: 0,
      },
    ],
    flds: [
      { name: "Text", ord: 0, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      { name: "Back Extra", ord: 1, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      { name: "Logg", ord: 2, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
      { name: "Bild", ord: 3, sticky: false, rtl: false, font: "Arial", size: 20, media: [] },
    ],
    css: CSS,
    crt: now,
    tags: [],
    req: [[0, "any", [0]]],
  };

  const modelsJson = JSON.stringify({ [modelId]: model });
  db.prepare("UPDATE col SET models = ?").run(modelsJson);
}

function insertDeck(db: Database.Database, deckId: number, deckName: string) {
  const now = Math.floor(Date.now() / 1000);
  const deckConf = {
    id: 1,
    lrnCutoff: 1,
    minInt: 1,
    maxIvl: 36500,
    maxTaken: 60000,
    bury: false,
    mod: now,
    name: "Default",
    usn: 0,
    delays: [1, 10],
    leechFails: 8,
    leechAction: 0,
    new: {
      delays: [1, 10],
      ints: [1, 4],
      initialFactor: 2500,
      separate: true,
      order: 1,
      perDay: 20,
      bury: true,
      usn: 0,
    },
    rev: {
      perDay: 200,
      ease4: 1.3,
      hardFactor: 1.2,
      ivlFct: 1,
      maxIvl: 36500,
      bury: true,
      usn: 0,
    },
    lapse: {
      delays: [10],
      leechFails: 8,
      minInt: 1,
      leechAction: 0,
      mult: 0,
      usn: 0,
    },
    dyn: false,
    desc: "",
    resched: true,
  };

  const deckConfsJson = JSON.stringify({ 1: deckConf });
  db.prepare("UPDATE col SET dconf = ?").run(deckConfsJson);

  const decksJson = JSON.stringify({
    1: { name: "Default", desc: "", did: 1, mod: now, usn: 0, lrnToday: [0, 0], revToday: [0, 0], newToday: [0, 0], timeToday: [0, 0], collapsed: false, browserCollapsed: true, extendNew: 10, extendRev: 50, reviewed: 0, dueCounts: null },
    [deckId]: {
      name: deckName,
      desc: "",
      did: deckId,
      mod: now,
      usn: 0,
      lrnToday: [0, 0],
      revToday: [0, 0],
      newToday: [0, 0],
      timeToday: [0, 0],
      collapsed: false,
      browserCollapsed: false,
      extendNew: 10,
      extendRev: 50,
      reviewed: 0,
      dueCounts: null,
    },
  });

  db.prepare("UPDATE col SET decks = ?").run(decksJson);
}

function createNote(
  noteId: number,
  deckId: number,
  modelId: number,
  card: Card
): Note {
  const now = Math.floor(Date.now() / 1000);
  const guid = `${noteId}${Math.random().toString(36).substr(2)}`;

  const fields = [
    card.text || "",
    card.extra || "",
    card.logg || "",
    card.bild || "",
  ];
  const flds = fields.join("\x1f");
  const sfld = card.text || "";

  // Calculate checksum (simple version)
  const csum = sfld.split("").reduce((a, b) => {
    a = (a << 5) - a + b.charCodeAt(0);
    return a & a;
  }, 0);

  return {
    id: noteId,
    did: deckId,
    mid: modelId,
    mod: now,
    usn: -1,
    tags: card.tags || "",
    flds,
    sfld,
    csum: Math.abs(csum % 99999),
    flags: 0,
    data: "",
  };
}

function insertNote(db: Database.Database, note: Note) {
  const guid = `${note.id}${Math.random().toString(36).substr(2)}`;
  db.prepare(
    `
    INSERT INTO notes (id, guid, mid, mod, usn, tags, flds, sfld, csum, flags, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
  ).run(
    note.id,
    guid,
    note.mid,
    note.mod,
    note.usn,
    note.tags,
    note.flds,
    note.sfld,
    note.csum,
    note.flags,
    note.data
  );
}

function insertCard(
  db: Database.Database,
  noteId: number,
  deckId: number,
  modelId: number
) {
  const now = Math.floor(Date.now() / 1000);
  const cardId = noteId * 1000 + 1;

  db.prepare(
    `
    INSERT INTO cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data)
    VALUES (?, ?, ?, 0, ?, -1, 0, 0, ?, 0, 2500, 0, 0, 0, 0, 0, '')
  `
  ).run(cardId, noteId, deckId, now, noteId);
}

async function createApkgFile(dbPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.file(dbPath, { name: "collection.anki2" });
    archive.finalize();
  });
}
