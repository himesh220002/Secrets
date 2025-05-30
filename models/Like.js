const mongoose = require("mongoose");

const likeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: "User" },
  secretId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ["like", "dislike"], required: true }
}, { timestamps: true });

module.exports = mongoose.model("Like", likeSchema);
