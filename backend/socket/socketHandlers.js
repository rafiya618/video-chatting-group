import { ensureCommunity, getCommunities, cleanupCommunity as baseCleanup } from "../mediasoup/communityManager.js";
import { LISTEN_IP, ANNOUNCED_IP } from "../config.js";

export default function registerSocketHandlers(io, worker) {
  // 🟢 store chat messages in-memory, per community
  const inCallChats = new Map(); // communityId -> array of { socketId, message, ts }

  // Wrap cleanup so it also clears chat
  function cleanupCommunity(communityId) {
    baseCleanup(communityId);
    inCallChats.delete(communityId); // clear chat log when room ends
  }

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // --- In-Call Chat: send + history ---
    socket.on("call:chat-message", ({ communityId, message }) => {
      if (!inCallChats.has(communityId)) inCallChats.set(communityId, []);
      const chatLog = inCallChats.get(communityId);

      const msg = { socketId: socket.id, message, ts: Date.now() };
      chatLog.push(msg);

      io.to(communityId).emit("call:chat-message", msg);
    });

    // 1. Join Room
    socket.on("join-room", async ({ communityId }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        if (!community.members.has(socket.id)) {
          community.members.set(socket.id, { transports: [], producers: [] });
        }
        socket.join(communityId);
        socket.to(communityId).emit("peer-joined", { socketId: socket.id });

        const existingProducers = [...community.producers.values()]
          .filter(p => p.ownerSocketId !== socket.id)
          .map(p => ({ id: p.producer.id, kind: p.kind, ownerSocketId: p.ownerSocketId }));

        const communities = getCommunities();
        const allProducersByRoom = {};
        for (const [cid, comm] of communities.entries()) {
          allProducersByRoom[cid] = [...comm.producers.values()].map((p) => ({
            producerId: p.producer.id,
            kind: p.kind,
            ownerSocketId: p.ownerSocketId,
          }));
        }

        const chatHistory = inCallChats.get(communityId) || []; // 🟢 send chat history on join

        callback({ 
          routerRtpCapabilities: community.router.rtpCapabilities, 
          existingProducers,
          allProducersByRoom,
          chatHistory // 👈 include history so reload/rejoin works like Zoom/Meet
        });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 2. Create Transport
    socket.on("create-transport", async ({ communityId }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        const member = community.members.get(socket.id);
        if (!member) return callback({ error: "join-room first" });

        const transport = await community.router.createWebRtcTransport({
          listenIps: [{ ip: LISTEN_IP, announcedIp: ANNOUNCED_IP }],
          enableUdp: true,
          enableTcp: true,
          preferUdp: true,
        });
        community.transports.set(transport.id, { transport, ownerSocketId: socket.id });
        member.transports.push(transport.id);

        callback({
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 3. Connect Transport
    socket.on("connect-transport", async ({ communityId, transportId, dtlsParameters }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        const tEntry = community.transports.get(transportId);
        if (!tEntry) throw new Error("transport not found");
        await tEntry.transport.connect({ dtlsParameters });
        callback({ ok: true });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 4. Produce
    socket.on("produce", async ({ communityId, transportId, kind, rtpParameters }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        const tEntry = community.transports.get(transportId);
        if (!tEntry) throw new Error("transport not found");

        const producer = await tEntry.transport.produce({ kind, rtpParameters });
        community.producers.set(producer.id, { producer, ownerSocketId: socket.id, kind });
        const member = community.members.get(socket.id);
        if (member) member.producers.push(producer.id);

        socket.to(communityId).emit("new-producer", { 
          producerId: producer.id, kind, ownerSocketId: socket.id 
        });

        const closeProducer = () => {
          community.producers.delete(producer.id);
          io.to(communityId).emit("producer-closed", { producerId: producer.id });
        };
        producer.on("transportclose", closeProducer);
        producer.on("close", closeProducer);

        callback({ id: producer.id });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 5. Consume
    socket.on("consume", async ({ communityId, transportId, producerId, rtpCapabilities }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        const router = community.router;
        if (!router.canConsume({ producerId, rtpCapabilities })) return callback({ error: "cannot consume" });

        const tEntry = community.transports.get(transportId);
        if (!tEntry) throw new Error("transport not found");
        const producerInfo = community.producers.get(producerId);
        if (!producerInfo) return callback({ error: "producer not found" });

        const consumer = await tEntry.transport.consume({
          producerId,
          rtpCapabilities,
          paused: true,
        });
        community.consumers.set(consumer.id, { consumer, ownerSocketId: socket.id });

        consumer.on("transportclose", () => community.consumers.delete(consumer.id));
        consumer.on("producerclose", () => {
          community.consumers.delete(consumer.id);
          socket.emit("producer-closed", { producerId });
        });

        callback({
          id: consumer.id,
          producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          ownerSocketId: producerInfo.ownerSocketId,
        });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 6. Resume Consumer
    socket.on("resume-consumer", async ({ communityId, consumerId }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        const cEntry = community.consumers.get(consumerId);
        if (!cEntry) return callback({ error: "consumer not found" });
        await cEntry.consumer.resume();
        callback({ ok: true });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 7. Pause/Resume Producer (mute/unmute)
    socket.on("pause-producer", async ({ communityId, producerId }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        const pEntry = community.producers.get(producerId);
        if (!pEntry || pEntry.ownerSocketId !== socket.id)
          return callback({ error: "producer not found or not owned" });
        await pEntry.producer.pause();
        socket.to(communityId).emit("producer-paused", { producerId });
        callback({ ok: true });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    socket.on("resume-producer", async ({ communityId, producerId }, callback) => {
      try {
        const community = await ensureCommunity(worker, communityId);
        const pEntry = community.producers.get(producerId);
        if (!pEntry || pEntry.ownerSocketId !== socket.id)
          return callback({ error: "producer not found or not owned" });
        await pEntry.producer.resume();
        socket.to(communityId).emit("producer-resumed", { producerId });
        callback({ ok: true });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // 8. Leave Room
    socket.on("leave-room", ({ communityId }) => {
      const communities = getCommunities();
      const community = communities.get(communityId);
      if (!community) return;
      const member = community.members.get(socket.id);
      if (!member) return;

      (member.producers || []).forEach((pid) => {
        const pEntry = community.producers.get(pid);
        if (pEntry && pEntry.producer) pEntry.producer.close();
        community.producers.delete(pid);
      });
      (member.transports || []).forEach((tid) => {
        const tEntry = community.transports.get(tid);
        if (tEntry && tEntry.transport) tEntry.transport.close();
        community.transports.delete(tid);
      });
      community.members.delete(socket.id);
      socket.to(communityId).emit("peer-left", { socketId: socket.id });
      socket.leave(communityId);
      if (community.members.size === 0) cleanupCommunity(communityId);
    });

    // 9. Disconnect = auto-leave all rooms
    socket.on("disconnect", () => {
      const communities = getCommunities();
      for (const [communityId, community] of communities.entries()) {
        if (!community.members.has(socket.id)) continue;
        const member = community.members.get(socket.id);
        (member.producers || []).forEach((pid) => {
          const pEntry = community.producers.get(pid);
          if (pEntry && pEntry.producer) pEntry.producer.close();
          community.producers.delete(pid);
        });
        (member.transports || []).forEach((tid) => {
          const tEntry = community.transports.get(tid);
          if (tEntry && tEntry.transport) tEntry.transport.close();
          community.transports.delete(tid);
        });
        community.members.delete(socket.id);
        socket.to(communityId).emit("peer-left", { socketId: socket.id });
        if (community.members.size === 0) cleanupCommunity(communityId);
      }
    });
  });
}
