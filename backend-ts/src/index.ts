import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import prisma from "./db";
import { generateCardsStream, parseTsv } from "./generator";
import { extractText } from "./upload";
import { exportToApkg } from "./exporter";
import { randomUUID } from "crypto";
import { createReadStream, unlinkSync } from "fs";

const app = new Hono();

const ALLOWED_ORIGINS = [
  "http://localhost:3000",
  "https://anki-project-three.vercel.app",
  "https://www.dimindo.com",
  "https://dimindo.com",
];

// CORS middleware
app.use(
  "*",
  cors({
    origin: (origin) => (ALLOWED_ORIGINS.includes(origin) ? origin : ""),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "x-user-id", "Accept", "Origin"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  })
);

// Manual preflight handler for stricter control if needed
app.options("*", (c) => {
  const origin = c.req.header("origin") || "";
  if (ALLOWED_ORIGINS.includes(origin)) {
    c.header("Access-Control-Allow-Origin", origin);
  }
  c.header("Access-Control-Allow-Credentials", "true");
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-user-id, Accept, Origin");
  return c.text("");
});

// Helper functions
function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

function getUserId(c: Hono["req"]): string {
  const userId = c.req.header("x-user-id");
  return userId || "anonymous_user";
}

interface SSEMessage {
  type: string;
  [key: string]: unknown;
}

function sseMessage(data: SSEMessage): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

// ── /api/health
app.get("/api/health", (c) => {
  return c.json({ status: "ok" });
});

// ── /api/generate (SSE streaming)
app.post("/api/generate", async (c) => {
  const userId = getUserId(c.req);

  // Parse form data
  const formData = await c.req.formData();
  const sourceMaterial = formData.get("source_material") as string;
  const language = (formData.get("language") as string) || "English";
  const timezone = (formData.get("timezone") as string) || "UTC";

  if (!sourceMaterial) {
    return c.text(sseMessage({ type: "error", message: "source_material is required" }), 400);
  }

  const wordCount = countWords(sourceMaterial);

  // For now, skip quota checks (can be added later with Supabase integration)
  // Create DB session
  const session = await prisma.session.create({
    data: {
      userId,
      title: null,
    },
  });

  const sessionId = session.id;

  // Return SSE stream
  return c.streaming(async (write) => {
    try {
      await write(sseMessage({ type: "session_id", session_id: sessionId }));

      let fullTsv = "";
      let titleSaved = false;

      for await (const chunk of generateCardsStream(sourceMaterial, language)) {
        fullTsv += chunk;

        // Process complete lines
        while (fullTsv.includes("\n")) {
          const lineEnd = fullTsv.indexOf("\n");
          const line = fullTsv.substring(0, lineEnd).trim();
          fullTsv = fullTsv.substring(lineEnd + 1);

          if (!line || line.startsWith("#") || line === "```") {
            continue;
          }

          if (!titleSaved && line.startsWith("TITLE:")) {
            titleSaved = true;
            const extractedTitle = line.substring("TITLE:".length).trim();
            await prisma.session.update({
              where: { id: sessionId },
              data: { title: extractedTitle },
            });
            continue;
          }

          // Parse and emit cards
          const cards = parseTsv(line);
          for (const card of cards) {
            await write(
              sseMessage({
                type: "card",
                data: {
                  text: card.text,
                  extra: card.extra,
                  logg: card.logg,
                },
              })
            );
          }
        }
      }

      // Process remaining TSV
      if (fullTsv.trim()) {
        const cards = parseTsv(fullTsv);
        for (const card of cards) {
          await write(
            sseMessage({
              type: "card",
              data: {
                text: card.text,
                extra: card.extra,
                logg: card.logg,
              },
            })
          );
        }
      }

      // Parse all cards and save to DB
      const allCards = parseTsv(fullTsv);
      if (allCards.length > 0) {
        await prisma.card.createMany({
          data: allCards.map((card, idx) => ({
            sessionId,
            userId,
            position: idx,
            text: card.text,
            extra: card.extra,
            tags: card.tags,
            deck: card.deck,
            logg: card.logg,
            approved: card.approved,
          })),
        });

        await write(sseMessage({ type: "done", card_count: allCards.length }));
      } else {
        await write(sseMessage({ type: "error", message: "Inga kort kunde parsas." }));
      }
    } catch (error) {
      await write(
        sseMessage({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        })
      );
    }
  });
});

// ── /api/upload
app.post("/api/upload", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File;

  if (!file) {
    return c.json({ error: "No file provided" }, 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await extractText(buffer, file.name);
    return c.json({ text });
  } catch (error) {
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to extract text from file",
      },
      400
    );
  }
});

// ── /api/cards/{session_id}
app.get("/api/cards/:sessionId", async (c) => {
  const userId = getUserId(c.req);
  const sessionId = c.req.param("sessionId");

  const cards = await prisma.card.findMany({
    where: {
      sessionId,
      userId,
    },
    orderBy: { position: "asc" },
  });

  return c.json({
    cards: cards.map((card) => ({
      id: card.id,
      text: card.text,
      extra: card.extra,
      tags: card.tags,
      deck: card.deck,
      logg: card.logg,
      approved: card.approved,
    })),
  });
});

// ── /api/cards/{session_id}/{card_id}/content
app.patch("/api/cards/:sessionId/:cardId/content", async (c) => {
  const userId = getUserId(c.req);
  const sessionId = c.req.param("sessionId");
  const cardId = c.req.param("cardId");

  const body = (await c.req.json()) as Record<string, string>;

  const card = await prisma.card.findFirst({
    where: {
      id: cardId,
      userId,
    },
  });

  if (!card) {
    return c.json({ error: "Kort hittades inte" }, 404);
  }

  const updateData: Record<string, string> = {};
  if (body.text) updateData.text = body.text;
  if (body.extra) updateData.extra = body.extra;
  if (body.deck) updateData.deck = body.deck;

  await prisma.card.update({
    where: { id: cardId },
    data: updateData,
  });

  return c.json({ ok: true });
});

// ── /api/export/{session_id}
app.post("/api/export/:sessionId", async (c) => {
  const userId = getUserId(c.req);
  const sessionId = c.req.param("sessionId");

  const cards = await prisma.card.findMany({
    where: {
      sessionId,
      userId,
      approved: true,
    },
    orderBy: { position: "asc" },
  });

  if (cards.length === 0) {
    return c.json({ error: "Inga godkända kort att exportera" }, 400);
  }

  const cardsData = cards.map((c) => ({
    text: c.text,
    extra: c.extra || "",
    tags: c.tags || "",
    deck: c.deck || "Huvudmeny",
    logg: c.logg || "",
    bild: "",
  }));

  const outputPath = `/tmp/dimindo_${sessionId}.apkg`;

  try {
    await exportToApkg(cardsData, outputPath);

    // Return file
    const stream = createReadStream(outputPath);
    c.header("Content-Type", "application/octet-stream");
    c.header("Content-Disposition", 'attachment; filename="dimindo_export.apkg"');
    return c.streaming(() => stream);
  } catch (error) {
    return c.json(
      {
        error: error instanceof Error ? error.message : "Export failed",
      },
      500
    );
  }
});

// ── /api/sessions
app.get("/api/sessions", async (c) => {
  const userId = getUserId(c.req);

  const sessions = await prisma.session.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: {
      cards: true,
    },
  });

  return c.json(
    sessions.map((s) => ({
      session_id: s.id,
      title: s.title || "Untitled session",
      created_at: s.createdAt.toISOString(),
      card_count: s.cards.length,
    }))
  );
});

// Start server
const port = parseInt(process.env.PORT || "3001");
console.log(`Starting Hono server on port ${port}`);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
