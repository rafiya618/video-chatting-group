import mongoose from "mongoose";

const communitySchema = new mongoose.Schema(
  {
    community_name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, required: true, trim: true },
    image: { type: String, default: "" },
    visible: { type: String, enum: ["public", "private"], default: "public" },
    user_id: { type: Number, required: true }, // admin id
    members: [{ type: Number }],
    no_of_followers: { type: Number, default: 0 },
    no_of_posts: { type: Number, default: 0 },
    no_of_views: { type: Number, default: 0 },
    upvotes: { type: Number, default: 0 },
    community_tags: [{ type: String, trim: true }],
    moderation: {
      type: String,
      enum: ["only admin", "allow moderators", "allow all"],
      default: "only admin",
    },
    moderators: [{ type: Number }],
  },
  { timestamps: true }
);

communitySchema.index({ community_name: "text", description: "text" });
communitySchema.index({ community_tags: 1 });
communitySchema.index({ visible: 1 });

export default mongoose.model("Community", communitySchema);
