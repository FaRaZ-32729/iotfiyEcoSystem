/**
 * Ingest markdown knowledge files → chunk → Gemini embed → Mongo rag_chunks.
 *
 * Usage (from ecoSystem-backend):
 *   node src/rag/ingestRagKnowledge.js
 *
 * Requires: GEMINI_API_KEY in .env, Mongo connected via MONGO_URI / same as server.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");
const RagChunk = require("../models/ragChunkModel");
const { embedDocument } = require("./ragService");

const KNOWLEDGE_DIR = path.join(__dirname, "knowledge");
const CHUNK_SIZE = 900;
const CHUNK_OVERLAP = 120;

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function splitMarkdown(text) {
    const cleaned = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!cleaned) return [];

    // Prefer splitting on ## headings, then size-limit
    const sections = cleaned.split(/\n(?=##\s)/);
    const chunks = [];

    for (const section of sections) {
        if (section.length <= CHUNK_SIZE) {
            chunks.push(section.trim());
            continue;
        }
        let start = 0;
        while (start < section.length) {
            const end = Math.min(start + CHUNK_SIZE, section.length);
            chunks.push(section.slice(start, end).trim());
            if (end >= section.length) break;
            start = Math.max(0, end - CHUNK_OVERLAP);
        }
    }

    return chunks.filter(Boolean);
}

function titleFromContent(source, content, index) {
    const heading = content.match(/^#+\s+(.+)$/m);
    if (heading) return heading[1].trim().slice(0, 120);
    return `${path.basename(source, ".md")} #${index + 1}`;
}

async function main() {
    const uri = process.env.MONGODB_URL || process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error("Missing MONGODB_URL");
        process.exit(1);
    }
    if (!process.env.GEMINI_API_KEY) {
        console.error("Missing GEMINI_API_KEY");
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("Mongo connected");

    const files = fs
        .readdirSync(KNOWLEDGE_DIR)
        .filter((f) => f.endsWith(".md"))
        .sort();

    if (!files.length) {
        console.error("No .md files in", KNOWLEDGE_DIR);
        process.exit(1);
    }

    let total = 0;
    for (const file of files) {
        const source = file;
        const full = path.join(KNOWLEDGE_DIR, file);
        const raw = fs.readFileSync(full, "utf8");
        const parts = splitMarkdown(raw);

        await RagChunk.deleteMany({ source });
        console.log(`\n${source}: ${parts.length} chunk(s)`);

        for (let i = 0; i < parts.length; i++) {
            const content = parts[i];
            const title = titleFromContent(source, content, i);
            process.stdout.write(`  embed ${i + 1}/${parts.length}...`);
            const embedding = await embedDocument(content);
            await RagChunk.create({
                source,
                title,
                content,
                embedding,
                chunkIndex: i,
            });
            total += 1;
            console.log(" ok");
            // gentle rate-limit for free tier
            await sleep(400);
        }
    }

    console.log(`\nDone. Upserted ${total} chunks.`);
    await mongoose.disconnect();
}

main().catch(async (err) => {
    console.error(err);
    try {
        await mongoose.disconnect();
    } catch (_) {
        /* ignore */
    }
    process.exit(1);
});
