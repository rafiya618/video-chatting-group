import { LISTEN_IP, ANNOUNCED_IP } from "../config.js";

const communities = new Map();

const mediaCodecs = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
  },
  {
    kind: "video",
    mimeType: "video/VP8",
    clockRate: 90000,
    parameters: { "x-google-start-bitrate": 1000 },
  },
  {
    kind: "video",
    mimeType: "video/VP9",
    clockRate: 90000,
    parameters: { "profile-id": 2, "x-google-start-bitrate": 1000 },
  },
  {
    kind: "video",
    mimeType: "video/h264",
    clockRate: 90000,
    parameters: {
      "packetization-mode": 1,
      "profile-level-id": "4d0032",
      "level-asymmetry-allowed": 1,
      "x-google-start-bitrate": 1000,
    },
  },
];

export async function ensureCommunity(worker, communityId) {
  if (!communities.has(communityId)) {
    const router = await worker.createRouter({ mediaCodecs });
    communities.set(communityId, {
      router,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map(),
      members: new Map(),
    });
  }
  return communities.get(communityId);
}

export function getCommunities() {
  return communities;
}

export function cleanupCommunity(communityId) {
  const community = communities.get(communityId);
  if (community && community.router) {
    community.router.close();
    communities.delete(communityId);
  }
}