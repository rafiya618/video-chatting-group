const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const mediasoup = require("mediasoup");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { 
  cors: { 
    origin: "*",
    methods: ["GET", "POST"]
  } 
});

let worker;
const communities = new Map(); // communityId -> { router, transports, producers, consumers, members }

async function createWorker() {
  worker = await mediasoup.createWorker({
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
    ],
  });
  
  console.log("Mediasoup worker created, PID:", worker.pid);
  
  worker.on("died", (error) => {
    console.error("mediasoup worker died:", error);
    process.exit(1);
  });
}

async function ensureCommunity(communityId) {
  if (!communities.has(communityId)) {
    console.log("Creating new community:", communityId);
    
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
        parameters: {
          "x-google-start-bitrate": 1000,
        },
      },
      {
        kind: "video",
        mimeType: "video/VP9",
        clockRate: 90000,
        parameters: {
          "profile-id": 2,
          "x-google-start-bitrate": 1000,
        },
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
    
    const router = await worker.createRouter({ mediaCodecs });
    
    communities.set(communityId, {
      router,
      transports: new Map(), // transportId -> { transport, ownerSocketId }
      producers: new Map(), // producerId -> { producer, ownerSocketId, kind }
      consumers: new Map(), // consumerId -> { consumer, ownerSocketId }
      members: new Map(), // socketId -> { transports: [], producers: [] }
    });
    
    console.log("Community created:", communityId);
  }
  return communities.get(communityId);
}

io.on("connection", (socket) => {
  console.log("Socket connected:", socket.id);

  socket.on("join-room", async ({ communityId }, callback) => {
    try {
      console.log(`Socket ${socket.id} joining community ${communityId}`);
      
      const community = await ensureCommunity(communityId);

      if (!community.members.has(socket.id)) {
        community.members.set(socket.id, { transports: [], producers: [] });
      }

      // Join socket.io room for easy broadcasts
      socket.join(communityId);

      // Build a mapping: { [roomId]: [ { producerId, kind, ownerSocketId } ] }
      // For now, roomId is communityId, but this allows for future multi-room support
      const allProducersByRoom = {};
      for (const [cid, comm] of communities.entries()) {
        allProducersByRoom[cid] = [...comm.producers.values()].map((p) => ({
          producerId: p.producer.id,
          kind: p.kind,
          ownerSocketId: p.ownerSocketId,
        }));
      }

      // Get existing producers (exclude those from the same socket)
      const existing = [...community.producers.values()]
        .filter(p => p.ownerSocketId !== socket.id)
        .map((p) => ({
          id: p.producer.id,
          kind: p.kind,
          ownerSocketId: p.ownerSocketId,
        }));

      console.log(`Socket ${socket.id} joined community ${communityId}, existing producers:`, existing.length);

      // Notify existing members about the new peer
      socket.to(communityId).emit("peer-joined", { socketId: socket.id });

      callback({ 
        routerRtpCapabilities: community.router.rtpCapabilities, 
        existingProducers: existing,
        allProducersByRoom // send the mapping to the client
      });
    } catch (err) {
      console.error("join-room error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("create-transport", async ({ communityId }, callback) => {
    try {
      const community = await ensureCommunity(communityId);
      const member = community.members.get(socket.id);
      if (!member) {
        console.error(`Socket ${socket.id} not in community ${communityId}`);
        return callback({ error: "join-room first" });
      }

      console.log(`Creating transport for socket ${socket.id} in community ${communityId}`);

      const transport = await community.router.createWebRtcTransport({
        listenIps: [
          { 
            ip: "0.0.0.0", 
            announcedIp: "127.0.0.1" // Set to your server's public IP in production
          }
        ],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      community.transports.set(transport.id, { transport, ownerSocketId: socket.id });
      member.transports.push(transport.id);

      console.log(`Transport created: ${transport.id} for socket ${socket.id}`);

      callback({
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      });
    } catch (err) {
      console.error("create-transport error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("connect-transport", async ({ communityId, transportId, dtlsParameters }, callback) => {
    try {
      const community = await ensureCommunity(communityId);
      const tEntry = community.transports.get(transportId);
      if (!tEntry) {
        console.error(`Transport ${transportId} not found`);
        throw new Error("transport not found");
      }

      console.log(`Connecting transport ${transportId} for socket ${socket.id}`);
      await tEntry.transport.connect({ dtlsParameters });
      console.log(`Transport ${transportId} connected successfully`);
      
      callback({ ok: true });
    } catch (err) {
      console.error("connect-transport error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("produce", async ({ communityId, transportId, kind, rtpParameters }, callback) => {
    try {
      const community = await ensureCommunity(communityId);
      const tEntry = community.transports.get(transportId);
      if (!tEntry) {
        console.error(`Transport ${transportId} not found for produce`);
        throw new Error("transport not found");
      }

      console.log(`Producing ${kind} for socket ${socket.id} via transport ${transportId}`);

      const producer = await tEntry.transport.produce({ kind, rtpParameters });
      community.producers.set(producer.id, { 
        producer, 
        ownerSocketId: socket.id, 
        kind 
      });
      
      const member = community.members.get(socket.id);
      if (member) member.producers.push(producer.id);

      console.log(`Producer created: ${producer.id} (${kind}) for socket ${socket.id}`);

      // Broadcast to everyone else in this community (exclude the producer)
      const broadcastData = { 
        producerId: producer.id, 
        kind: kind, 
        ownerSocketId: socket.id 
      };
      
      console.log(`Broadcasting new-producer to room ${communityId}:`, broadcastData);
      socket.to(communityId).emit("new-producer", broadcastData);

      producer.on("transportclose", () => {
        console.log(`Producer ${producer.id} transport closed`);
        community.producers.delete(producer.id);
        io.to(communityId).emit("producer-closed", { producerId: producer.id });
      });
      
      producer.on("close", () => {
        console.log(`Producer ${producer.id} closed`);
        community.producers.delete(producer.id);
        io.to(communityId).emit("producer-closed", { producerId: producer.id });
      });

      callback({ id: producer.id });
    } catch (err) {
      console.error("produce error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("consume", async ({ communityId, transportId, producerId, rtpCapabilities }, callback) => {
    try {
      const community = await ensureCommunity(communityId);
      const router = community.router;

      if (!router.canConsume({ producerId, rtpCapabilities })) {
        console.error(`Cannot consume producer ${producerId}`);
        return callback({ error: "cannot consume" });
      }

      const tEntry = community.transports.get(transportId);
      if (!tEntry) {
        console.error(`Transport ${transportId} not found for consume`);
        throw new Error("transport not found");
      }

      const producerInfo = community.producers.get(producerId);
      if (!producerInfo) {
        console.error(`Producer ${producerId} not found`);
        return callback({ error: "producer not found" });
      }

      console.log(`Creating consumer for producer ${producerId} (${producerInfo.kind}) on transport ${transportId}`);

      // Create consumer with proper initial state
      const consumer = await tEntry.transport.consume({
        producerId,
        rtpCapabilities,
        paused: true, // Start paused and resume after setup
      });

      community.consumers.set(consumer.id, { consumer, ownerSocketId: socket.id });

      console.log(`Consumer created: ${consumer.id} for producer ${producerId} (${consumer.kind})`);

      consumer.on("transportclose", () => {
        console.log(`Consumer ${consumer.id} transport closed`);
        community.consumers.delete(consumer.id);
      });
      
      consumer.on("producerclose", () => {
        console.log(`Consumer ${consumer.id} producer closed`);
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
      console.error("consume error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("resume-consumer", async ({ communityId, consumerId }, callback) => {
    try {
      const community = await ensureCommunity(communityId);
      const cEntry = community.consumers.get(consumerId);
      if (!cEntry) {
        console.error(`Consumer ${consumerId} not found`);
        return callback({ error: "consumer not found" });
      }
      
      console.log(`Resuming consumer ${consumerId}`);
      await cEntry.consumer.resume();
      callback({ ok: true });
    } catch (err) {
      console.error("resume-consumer error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("pause-producer", async ({ communityId, producerId }, callback) => {
    try {
      const community = await ensureCommunity(communityId);
      const pEntry = community.producers.get(producerId);
      if (!pEntry || pEntry.ownerSocketId !== socket.id) {
        return callback({ error: "producer not found or not owned" });
      }
      
      console.log(`Pausing producer ${producerId}`);
      await pEntry.producer.pause();
      
      // Notify all consumers
      socket.to(communityId).emit("producer-paused", { producerId });
      callback({ ok: true });
    } catch (err) {
      console.error("pause-producer error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("resume-producer", async ({ communityId, producerId }, callback) => {
    try {
      const community = await ensureCommunity(communityId);
      const pEntry = community.producers.get(producerId);
      if (!pEntry || pEntry.ownerSocketId !== socket.id) {
        return callback({ error: "producer not found or not owned" });
      }
      
      console.log(`Resuming producer ${producerId}`);
      await pEntry.producer.resume();
      
      // Notify all consumers
      socket.to(communityId).emit("producer-resumed", { producerId });
      callback({ ok: true });
    } catch (err) {
      console.error("resume-producer error:", err);
      callback({ error: err.message });
    }
  });

  socket.on("leave-room", ({ communityId }) => {
    try {
      console.log(`Socket ${socket.id} leaving community ${communityId}`);
      
      const community = communities.get(communityId);
      if (!community) {
        console.log(`Community ${communityId} not found`);
        return;
      }

      const member = community.members.get(socket.id);
      if (!member) {
        console.log(`Socket ${socket.id} not a member of community ${communityId}`);
        return;
      }

      // Close all producers
      (member.producers || []).forEach((pid) => {
        const pEntry = community.producers.get(pid);
        if (pEntry && pEntry.producer) {
          console.log(`Closing producer ${pid}`);
          pEntry.producer.close();
          community.producers.delete(pid);
        }
      });

      // Close all transports
      (member.transports || []).forEach((tid) => {
        const tEntry = community.transports.get(tid);
        if (tEntry && tEntry.transport) {
          console.log(`Closing transport ${tid}`);
          tEntry.transport.close();
          community.transports.delete(tid);
        }
      });

      // Remove member
      community.members.delete(socket.id);
      
      // Notify others
      socket.to(communityId).emit("peer-left", { socketId: socket.id });
      socket.leave(communityId);

      console.log(`Socket ${socket.id} left community ${communityId}`);
      
      // Clean up empty community
      if (community.members.size === 0) {
        console.log(`Community ${communityId} is empty, cleaning up router`);
        community.router.close();
        communities.delete(communityId);
      }
    } catch (err) {
      console.error("leave-room error:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("Socket disconnected:", socket.id);
    
    // Clean up all communities this socket was part of
    for (const [communityId, community] of communities.entries()) {
      if (community.members.has(socket.id)) {
        console.log(`Cleaning up socket ${socket.id} from community ${communityId}`);
        
        const member = community.members.get(socket.id);
        
        // Close all producers
        (member.producers || []).forEach((pid) => {
          const pEntry = community.producers.get(pid);
          if (pEntry && pEntry.producer) {
            console.log(`Closing producer ${pid} on disconnect`);
            pEntry.producer.close();
            community.producers.delete(pid);
          }
        });
        
        // Close all transports
        (member.transports || []).forEach((tid) => {
          const tEntry = community.transports.get(tid);
          if (tEntry && tEntry.transport) {
            console.log(`Closing transport ${tid} on disconnect`);
            tEntry.transport.close();
            community.transports.delete(tid);
          }
        });
        
        // Remove member
        community.members.delete(socket.id);
        
        // Notify others
        socket.to(communityId).emit("peer-left", { socketId: socket.id });
        
        // Clean up empty community
        if (community.members.size === 0) {
          console.log(`Community ${communityId} is empty after disconnect, cleaning up router`);
          community.router.close();
          communities.delete(communityId);
        }
      }
    }
  });

  // Handle legacy events from old lobby (if still being used)
  socket.on("call:initiate", ({ communityId, userId }) => {
    console.log(`Legacy call:initiate from ${socket.id} for community ${communityId}`);
    // Just acknowledge - the actual room joining happens via join-room
    socket.emit("server:ok", "Call initiated - please join the room");
  });

  socket.on("call:join", ({ communityId, userId }) => {
    console.log(`Legacy call:join from ${socket.id} for community ${communityId}`);
    // Just acknowledge - the actual room joining happens via join-room
    socket.emit("server:ok", "Ready to join - please join the room");
  });
});

// Error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully...');
  
  // Close all communities
  for (const [communityId, community] of communities.entries()) {
    console.log(`Closing community ${communityId}`);
    try {
      community.router.close();
    } catch (err) {
      console.error(`Error closing router for community ${communityId}:`, err);
    }
  }
  
  // Close worker
  if (worker) {
    worker.close();
  }
  
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

server.listen(8000, async () => {
  try {
    await createWorker();
    console.log("🚀 Server listening on port 8000");
    console.log("📹 Mediasoup SFU ready for video calls");
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});