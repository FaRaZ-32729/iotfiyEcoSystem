const mongoose = require("mongoose");

const ragChunkSchema = new mongoose.Schema(
    {
        source: { type: String, required: true, trim: true, index: true },
        title: { type: String, required: true, trim: true },
        content: { type: String, required: true },
        embedding: { type: [Number], required: true },
        chunkIndex: { type: Number, default: 0 },
    },
    { timestamps: true, collection: "rag_chunks" }
);

ragChunkSchema.index({ source: 1, chunkIndex: 1 }, { unique: true });

module.exports = mongoose.model("RagChunk", ragChunkSchema);
