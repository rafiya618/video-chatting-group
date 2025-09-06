import React, { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

const socket = io("http://localhost:8000");

export default function Room({ communityId: propCommunityId }) {
  // Get communityId from URL params if not provided as prop
  const [communityId, setCommunityId] = useState(propCommunityId);
  
  useEffect(() => {
    if (!communityId) {
      const urlParts = window.location.pathname.split('/');
      const roomId = urlParts[urlParts.length - 1];
      if (roomId && roomId !== 'room') {
        setCommunityId(roomId);
      }
    }
  }, [communityId]);

  const [device, setDevice] = useState(null);
  const sendTransportRef = useRef(null);
  const recvTransportRef = useRef(null);
  const localStreamRef = useRef(null);
  const [remoteStreams, setRemoteStreams] = useState(new Map());
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [isJoined, setIsJoined] = useState(false);
  const [participants, setParticipants] = useState(new Set());

  const [chatMessages, setChatMessages] = useState([]);
const [chatInput, setChatInput] = useState("");

  // Keep track of consumed producers and consumers
  const consumedProducersRef = useRef(new Set());
  const consumersRef = useRef(new Map()); // consumerId -> consumer
  const audioProducerRef = useRef(null);
  const videoProducerRef = useRef(null);

  useEffect(() => {
    const handleNewProducer = async ({ producerId, ownerSocketId, kind }) => {
      console.log("New producer:", producerId, "from:", ownerSocketId, "kind:", kind);
      
      // Skip consuming our own producers
      if (ownerSocketId === socket.id) {
        console.log("Skipping own producer:", producerId);
        return;
      }

      // Add to participants list
      setParticipants(prev => new Set([...prev, ownerSocketId]));
      
      // Wait a bit to ensure transports are ready
      if (device && recvTransportRef.current && !consumedProducersRef.current.has(producerId)) {
        console.log("Attempting to consume producer:", producerId);
        setTimeout(() => consume(producerId), 500);
      } else {
        console.log("Cannot consume yet - device/transport not ready or already consumed");
      }
    };

    const handleProducerClosed = ({ producerId }) => {
      console.log("Producer closed:", producerId);
      
      // Clean up consumer if exists
      for (const [consumerId, consumer] of consumersRef.current.entries()) {
        if (consumer.producerId === producerId) {
          consumer.close();
          consumersRef.current.delete(consumerId);
          break;
        }
      }
      
      setRemoteStreams((prev) => {
        const newStreams = new Map(prev);
        // Find and remove the stream that contains this producer
        for (const [streamId, streamData] of newStreams.entries()) {
          if (streamData.producerId === producerId) {
            newStreams.delete(streamId);
            break;
          }
        }
        return newStreams;
      });
      consumedProducersRef.current.delete(producerId);
    };

    const handlePeerLeft = ({ socketId }) => {
      console.log("Peer left:", socketId);
      // Remove from participants
      setParticipants(prev => {
        const newSet = new Set(prev);
        newSet.delete(socketId);
        return newSet;
      });
      
      // Remove all streams from this peer
      setRemoteStreams((prev) => {
        const newStreams = new Map(prev);
        for (const [streamId, streamData] of newStreams.entries()) {
          if (streamData.ownerSocketId === socketId) {
            newStreams.delete(streamId);
          }
        }
        return newStreams;
      });
    };

    const handlePeerJoined = ({ socketId }) => {
      console.log("Peer joined:", socketId);
      setParticipants(prev => new Set([...prev, socketId]));
    };

    socket.on("new-producer", handleNewProducer);
    socket.on("producer-closed", handleProducerClosed);
    socket.on("peer-left", handlePeerLeft);
    socket.on("peer-joined", handlePeerJoined);

    return () => {
      socket.off("new-producer", handleNewProducer);
      socket.off("producer-closed", handleProducerClosed);
      socket.off("peer-left", handlePeerLeft);
      socket.off("peer-joined", handlePeerJoined);
    };
  }, [device]);


// receive incoming messages
useEffect(() => {
  socket.on("call:chat-message", (msg) => {
    setChatMessages((prev) => [...prev, msg]);
  });

  return () => {
    socket.off("call:chat-message");
  };
}, []);

  // join the room
  const joinRoom = async () => {
    if (isJoined || !communityId) return;
    
    console.log("Joining room:", communityId);
    
    socket.emit("join-room", { communityId }, async (res) => {
      if (res?.error) {
        console.error("join-room error", res.error);
        alert("Failed to join room: " + res.error);
        return;
      }

      console.log("Joined room successfully", res);
      const { routerRtpCapabilities, existingProducers, allProducersByRoom ,chatHistory} = res;
      setChatMessages(chatHistory || []);

      try {
        // Initialize device
        const dev = new mediasoupClient.Device();
        await dev.load({ routerRtpCapabilities });
        setDevice(dev);

        // Create transports
        console.log("Creating transports...");
        const [sendTransport, recvTransport] = await Promise.all([
          createSendTransport(dev),
          createRecvTransport(dev)
        ]);
        
        if (!sendTransport || !recvTransport) {
          throw new Error("Failed to create transports");
        }
        
        sendTransportRef.current = sendTransport;
        recvTransportRef.current = recvTransport;
        console.log("Transports created successfully");

        // Start local media and produce
        await startCameraAndProduce(sendTransport);

        // After producing local media, consume all producers in allProducersByRoom for this room
        if (allProducersByRoom && allProducersByRoom[communityId]) {
          const producersToConsume = allProducersByRoom[communityId];
          for (const p of producersToConsume) {
            if (p.ownerSocketId === socket.id) continue; // skip own
            setParticipants(prev => new Set([...prev, p.ownerSocketId]));
            if (!consumedProducersRef.current.has(p.producerId)) {
              await consume(p.producerId);
            }
          }
        }

        setIsJoined(true);
        console.log("Room setup completed successfully");
      } catch (err) {
        console.error("Error setting up room:", err);
        alert("Failed to setup room: " + err.message);
      }
    });
  };

  const sendMessage = () => {
  if (!chatInput.trim()) return;
  socket.emit("call:chat-message", { communityId, message: chatInput });
  setChatInput("");
};

  const createSendTransport = (dev) =>
    new Promise((resolve, reject) => {
      socket.emit("create-transport", { communityId }, (params) => {
        if (params?.error) {
          console.error("create-transport error", params.error);
          return reject(new Error(params.error));
        }
        
        console.log("Creating send transport with params:", params);
        const transport = dev.createSendTransport(params);

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
          console.log("Send transport connecting...");
          socket.emit("connect-transport", { communityId, transportId: params.id, dtlsParameters }, (res) => {
            if (res?.error) {
              console.error("Send transport connect error:", res.error);
              errback(new Error(res.error));
            } else {
              console.log("Send transport connected");
              callback();
            }
          });
        });

        transport.on("produce", ({ kind, rtpParameters }, callback, errback) => {
          console.log("Producing:", kind);
          socket.emit("produce", { communityId, transportId: params.id, kind, rtpParameters }, (res) => {
            if (res?.error) {
              console.error("Produce error:", res.error);
              return errback(new Error(res.error));
            }
            console.log("Produced:", kind, "with id:", res.id);
            callback({ id: res.id });
          });
        });

        transport.on("connectionstatechange", (state) => {
          console.log("Send transport connection state:", state);
          if (state === 'failed' || state === 'disconnected') {
            console.error("Send transport failed, attempting to reconnect...");
          }
        });

        resolve(transport);
      });
    });

  const createRecvTransport = (dev) =>
    new Promise((resolve, reject) => {
      socket.emit("create-transport", { communityId }, (params) => {
        if (params?.error) {
          console.error("create-transport error", params.error);
          return reject(new Error(params.error));
        }
        
        console.log("Creating recv transport with params:", params);
        const transport = dev.createRecvTransport(params);

        transport.on("connect", ({ dtlsParameters }, callback, errback) => {
          console.log("Recv transport connecting...");
          socket.emit("connect-transport", { communityId, transportId: params.id, dtlsParameters }, (res) => {
            if (res?.error) {
              console.error("Recv transport connect error:", res.error);
              errback(new Error(res.error));
            } else {
              console.log("Recv transport connected");
              callback();
            }
          });
        });

        transport.on("connectionstatechange", (state) => {
          console.log("Recv transport connection state:", state);
          if (state === 'failed' || state === 'disconnected') {
            console.error("Recv transport failed");
          }
        });

        resolve(transport);
      });
    });

  const startCameraAndProduce = async (sendTransport) => {
    try {
      console.log("Starting camera and microphone...");
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }, 
        video: { 
          width: { ideal: 640 }, 
          height: { ideal: 480 },
          frameRate: { ideal: 15 }
        } 
      });
      
      localStreamRef.current = stream;
      const localVideo = document.getElementById("localVideo");
      if (localVideo) {
        localVideo.srcObject = stream;
        console.log("Local video element setup");
      }

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      // Produce both tracks
      const promises = [];
      
      if (videoTrack) {
        console.log("Producing video track");
        promises.push(
          sendTransport.produce({ track: videoTrack }).then(producer => {
            videoProducerRef.current = producer;
            console.log("Video producer created:", producer.id);
            
            producer.on('transportclose', () => {
              console.log('Video producer transport closed');
            });
            
            producer.on('trackended', () => {
              console.log('Video track ended');
            });
          })
        );
      }
      
      if (audioTrack) {
        console.log("Producing audio track");
        promises.push(
          sendTransport.produce({ track: audioTrack }).then(producer => {
            audioProducerRef.current = producer;
            console.log("Audio producer created:", producer.id);
            
            producer.on('transportclose', () => {
              console.log('Audio producer transport closed');
            });
            
            producer.on('trackended', () => {
              console.log('Audio track ended');
            });
          })
        );
      }
      
      await Promise.all(promises);
      console.log("Local media production completed");
    } catch (err) {
      console.error("getUserMedia error:", err);
      alert("Failed to access camera/microphone: " + err.message);
      throw err;
    }
  };

  const consume = (producerId) =>
    new Promise((resolve) => {
      (async () => {
        try {
          if (!device || !recvTransportRef.current) {
            console.log("Device or recv transport not ready for consuming, retrying in 1000ms");
            setTimeout(() => consume(producerId).then(resolve), 1000);
            return;
          }
          
          if (consumedProducersRef.current.has(producerId)) {
            console.log("Producer already consumed:", producerId);
            return resolve();
          }

          console.log("Consuming producer:", producerId);

          socket.emit(
            "consume",
            { 
              communityId, 
              transportId: recvTransportRef.current.id, 
              producerId, 
              rtpCapabilities: device.rtpCapabilities 
            },
            async (res) => {
              if (res?.error) {
                console.error("consume error:", res.error);
                return resolve();
              }

              console.log("Consumer response:", res);

              try {
                const consumer = await recvTransportRef.current.consume({
                  id: res.id,
                  producerId: res.producerId,
                  kind: res.kind,
                  rtpParameters: res.rtpParameters,
                });

                console.log("Consumer created successfully:", consumer.kind, consumer.id);
                
                // Store consumer reference
                consumersRef.current.set(consumer.id, consumer);

                // Handle remote stream creation/updating
                const peerKey = res.ownerSocketId;
                
                setRemoteStreams((prevStreams) => {
                  const newStreams = new Map(prevStreams);
                  
                  let existingStreamData = null;
                  
                  // Find existing stream for this peer
                  for (const [key, streamData] of newStreams.entries()) {
                    if (streamData.ownerSocketId === peerKey) {
                      existingStreamData = streamData;
                      break;
                    }
                  }
                  
                  if (existingStreamData) {
                    // Add track to existing stream
                    console.log("Adding", consumer.kind, "track to existing stream for peer", peerKey);
                    
                    // Remove existing track of the same kind if it exists
                    const existingTrack = existingStreamData.stream.getTracks().find(t => t.kind === consumer.track.kind);
                    if (existingTrack) {
                      existingStreamData.stream.removeTrack(existingTrack);
                    }
                    
                    existingStreamData.stream.addTrack(consumer.track);
                    
                    // Update stream data
                    const updatedStreamData = {
                      ...existingStreamData,
                      [`${consumer.kind}ProducerId`]: res.producerId,
                      [`${consumer.kind}ConsumerId`]: consumer.id
                    };
                    
                    newStreams.set(peerKey, updatedStreamData);
                  } else {
                    // Create new stream for this peer
                    console.log("Creating new stream for peer", peerKey, "kind:", consumer.kind);
                    const newStream = new MediaStream([consumer.track]);
                    
                    const streamData = {
                      stream: newStream,
                      ownerSocketId: peerKey,
                      [`${consumer.kind}ProducerId`]: res.producerId,
                      [`${consumer.kind}ConsumerId`]: consumer.id
                    };
                    
                    newStreams.set(peerKey, streamData);
                  }
                  
                  return newStreams;
                });

                consumedProducersRef.current.add(producerId);

                // Set up consumer event handlers
                consumer.on("transportclose", () => {
                  console.log("Consumer transport closed:", consumer.id);
                  consumersRef.current.delete(consumer.id);
                });
                
                consumer.on("producerclose", () => {
                  console.log("Consumer producer closed:", consumer.id);
                  consumersRef.current.delete(consumer.id);
                  
                  setRemoteStreams((prev) => {
                    const newStreams = new Map(prev);
                    for (const [key, streamData] of newStreams.entries()) {
                      if (streamData[`${consumer.kind}ProducerId`] === producerId) {
                        // Remove track from stream
                        const trackToRemove = streamData.stream.getTracks().find(t => t.kind === consumer.kind);
                        if (trackToRemove) {
                          streamData.stream.removeTrack(trackToRemove);
                        }
                        
                        // If no tracks left, remove entire stream
                        if (streamData.stream.getTracks().length === 0) {
                          newStreams.delete(key);
                        }
                        break;
                      }
                    }
                    return newStreams;
                  });
                  
                  consumedProducersRef.current.delete(producerId);
                });

                // Resume consumer to start receiving media
                console.log("Resuming consumer:", consumer.id);
                socket.emit("resume-consumer", { communityId, consumerId: consumer.id }, (resumeRes) => {
                  if (resumeRes?.error) {
                    console.error("Failed to resume consumer:", resumeRes.error);
                  } else {
                    console.log("Consumer resumed successfully:", consumer.id);
                  }
                });

                resolve();
              } catch (consumerError) {
                console.error("Error creating consumer:", consumerError);
                resolve();
              }
            }
          );
        } catch (err) {
          console.error("consume exception", err);
          resolve();
        }
      })();
    });

  const leaveRoom = () => {
    console.log("Leaving room");
    
    socket.emit("leave-room", { communityId });
    
    // Clean up local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        console.log("Stopped local track:", track.kind);
      });
      localStreamRef.current = null;
    }
    
    // Close all consumers
    for (const [consumerId, consumer] of consumersRef.current.entries()) {
      try {
        consumer.close();
        console.log("Closed consumer:", consumerId);
      } catch (e) {
        console.error("Error closing consumer:", consumerId, e);
      }
    }
    consumersRef.current.clear();
    
    // Clear local video
    const localVideo = document.getElementById("localVideo");
    if (localVideo) localVideo.srcObject = null;
    
    setRemoteStreams(new Map());
    setParticipants(new Set());
    consumedProducersRef.current.clear();

    // Close transports
    try {
      if (sendTransportRef.current) {
        sendTransportRef.current.close();
        sendTransportRef.current = null;
      }
      if (recvTransportRef.current) {
        recvTransportRef.current.close();
        recvTransportRef.current = null;
      }
    } catch (e) {
      console.error("Error closing transports:", e);
    }

    // Reset refs
    audioProducerRef.current = null;
    videoProducerRef.current = null;
    setDevice(null);
    setIsJoined(false);
    
    console.log("Left room successfully");
  };

  const toggleMic = async () => {
    if (!audioProducerRef.current || !localStreamRef.current) return;
    
    try {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !micEnabled;
        setMicEnabled(!micEnabled);
        console.log("Microphone", !micEnabled ? "enabled" : "disabled");
      }
    } catch (err) {
      console.error("Error toggling microphone:", err);
    }
  };

  const toggleCam = async () => {
    if (!videoProducerRef.current || !localStreamRef.current) return;
    
    try {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !camEnabled;
        setCamEnabled(!camEnabled);
        console.log("Camera", !camEnabled ? "enabled" : "disabled");
      }
    } catch (err) {
      console.error("Error toggling camera:", err);
    }
  };

  // Convert Map to Array for rendering
  const remoteStreamArray = Array.from(remoteStreams.values());

  return (
    <div style={{ padding: 12 }}>
      <h2>Room: {communityId || 'Loading...'}</h2>
      <p>Status: {isJoined ? 'Connected' : 'Disconnected'}</p>
      <p>Participants: {participants.size + (isJoined ? 1 : 0)} (including you)</p>

      <div style={{ marginBottom: 16 }}>
        <h4>Local Video (You)</h4>
        <video 
          id="localVideo" 
          autoPlay 
          playsInline 
          muted 
          style={{ 
            width: 240, 
            height: 180, 
            background: "black",
            border: "2px solid #2196F3"
          }}
          onLoadedMetadata={() => console.log("Local video metadata loaded")}
          onPlaying={() => console.log("Local video is playing")}
          onError={(e) => console.error("Local video error:", e)}
        />
      </div>

      <div style={{ marginTop: 16, border: "1px solid #ccc", borderRadius: 6, padding: 8, width: 300 }}>
  <h4>In-Call Chat</h4>
  <div style={{ 
    height: 200, 
    overflowY: "auto", 
    background: "#f9f9f9", 
    padding: 8, 
    marginBottom: 8 
  }}>
    {chatMessages.length === 0 ? (
      <p style={{ color: "#888" }}>No messages yet</p>
    ) : (
      chatMessages.map((msg, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <strong>{msg.socketId.slice(-4)}:</strong> {msg.message}
        </div>
      ))
    )}
  </div>
  <div style={{ display: "flex", gap: 8 }}>
    <input
      type="text"
      value={chatInput}
      onChange={(e) => setChatInput(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && sendMessage()}
      style={{ flex: 1, padding: 6 }}
      placeholder="Type a message..."
    />
    <button onClick={sendMessage} style={{ padding: "6px 12px" }}>
      Send
    </button>
  </div>
</div>


      <div style={{ marginBottom: 16 }}>
        <h4>Remote Participants ({remoteStreamArray.length})</h4>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {remoteStreamArray.map((streamData, i) => (
            <div key={`${streamData.ownerSocketId}-${i}`} style={{ textAlign: "center" }}>
              <video 
                ref={(el) => {
                  if (el && el.srcObject !== streamData.stream) {
                    el.srcObject = streamData.stream;
                    console.log("Assigned stream to video element for peer:", streamData.ownerSocketId, 
                      "tracks:", streamData.stream.getTracks().map(t => t.kind).join(', '));
                  }
                }}
                autoPlay 
                playsInline 
                style={{ 
                  width: 240, 
                  height: 180, 
                  background: "black",
                  border: "2px solid #4CAF50"
                }} 
                onLoadedMetadata={() => console.log(`Remote video ${i} metadata loaded`)}
                onPlaying={() => console.log(`Remote video ${i} is playing`)}
                onError={(e) => console.error(`Remote video ${i} error:`, e)}
              />
              <div style={{ fontSize: 12, marginTop: 4 }}>
                Peer {streamData.ownerSocketId.slice(-4)} 
                ({streamData.stream.getTracks().length} tracks: {streamData.stream.getTracks().map(t => t.kind).join(', ')})
              </div>
            </div>
          ))}
        </div>
        {remoteStreamArray.length === 0 && isJoined && (
          <p style={{ color: "#666" }}>No other participants yet</p>
        )}
      </div>

      <div style={{ marginTop: 12 }}>
        <button 
          onClick={joinRoom} 
          disabled={isJoined || !communityId}
          style={{ 
            marginRight: 8,
            backgroundColor: (isJoined || !communityId) ? '#ccc' : '#4CAF50',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: (isJoined || !communityId) ? 'not-allowed' : 'pointer'
          }}
        >
          {isJoined ? 'Joined' : 'Join Room'}
        </button>
        
        <button 
          onClick={leaveRoom} 
          disabled={!isJoined}
          style={{ 
            marginRight: 8,
            backgroundColor: !isJoined ? '#ccc' : '#f44336',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: !isJoined ? 'not-allowed' : 'pointer'
          }}
        >
          Leave Room
        </button>
        
        <button 
          onClick={toggleMic} 
          disabled={!isJoined}
          style={{ 
            marginRight: 8,
            backgroundColor: !isJoined ? '#ccc' : (micEnabled ? '#2196F3' : '#FF9800'),
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: !isJoined ? 'not-allowed' : 'pointer'
          }}
        >
          {micEnabled ? "Mute Mic" : "Unmute Mic"}
        </button>
        
        <button 
          onClick={toggleCam} 
          disabled={!isJoined}
          style={{ 
            backgroundColor: !isJoined ? '#ccc' : (camEnabled ? '#2196F3' : '#FF9800'),
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: !isJoined ? 'not-allowed' : 'pointer'
          }}
        >
          {camEnabled ? "Turn Off Camera" : "Turn On Camera"}
        </button>
      </div>

      {/* Debug information */}
      <div style={{ marginTop: 16, padding: 8, background: '#f5f5f5', fontSize: 12 }}>
        <strong>Debug Info:</strong>
        <br />
        Device ready: {device ? 'Yes' : 'No'}
        <br />
        Send transport: {sendTransportRef.current ? 'Ready' : 'Not ready'}
        <br />
        Recv transport: {recvTransportRef.current ? 'Ready' : 'Not ready'}
        <br />
        Consumed producers: {consumedProducersRef.current.size}
        <br />
        Active consumers: {consumersRef.current.size}
        <br />
        Remote streams: {remoteStreamArray.length}
        <br />
        Participants: {Array.from(participants).join(', ')}
      </div>
    </div>
  );
}