import React, { useState, useEffect } from "react";
import useMediaSoupRoom from "../../hooks/useMediaSoupRoom";
import useChat from "../../hooks/useChat";
import LocalVideo from "./LocalVideo";
import RemoteParticipants from "./RemoteParticipants";
import ChatPanel from "./ChatPanel";

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

  // MediaSoup and socket logic
  const mediaSoup = useMediaSoupRoom(communityId);

  // Chat logic
  const chat = useChat(communityId);

  // Join room and load chat history
  const handleJoinRoom = () => {
    mediaSoup.joinRoom(chat.setChatMessages);
  };

  return (
    <div style={{ padding: 12 }}>
      <h2>Room: {communityId || 'Loading...'}</h2>
      <p>Status: {mediaSoup.isJoined ? 'Connected' : 'Disconnected'}</p>
      <p>Participants: {mediaSoup.participants.size + (mediaSoup.isJoined ? 1 : 0)} (including you)</p>

      <LocalVideo />

      <ChatPanel
        chatMessages={chat.chatMessages}
        chatInput={chat.chatInput}
        setChatInput={chat.setChatInput}
        sendMessage={chat.sendMessage}
      />

      <RemoteParticipants
        remoteStreams={mediaSoup.remoteStreams}
        isJoined={mediaSoup.isJoined}
      />

      <div style={{ marginTop: 12 }}>
        <button
          onClick={handleJoinRoom}
          disabled={mediaSoup.isJoined || !communityId}
          style={{
            marginRight: 8,
            backgroundColor: (mediaSoup.isJoined || !communityId) ? '#ccc' : '#4CAF50',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: (mediaSoup.isJoined || !communityId) ? 'not-allowed' : 'pointer'
          }}
        >
          {mediaSoup.isJoined ? 'Joined' : 'Join Room'}
        </button>

        <button
          onClick={mediaSoup.leaveRoom}
          disabled={!mediaSoup.isJoined}
          style={{
            marginRight: 8,
            backgroundColor: !mediaSoup.isJoined ? '#ccc' : '#f44336',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: !mediaSoup.isJoined ? 'not-allowed' : 'pointer'
          }}
        >
          Leave Room
        </button>

        <button
          onClick={mediaSoup.toggleMic}
          disabled={!mediaSoup.isJoined}
          style={{
            marginRight: 8,
            backgroundColor: !mediaSoup.isJoined ? '#ccc' : (mediaSoup.micEnabled ? '#2196F3' : '#FF9800'),
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: !mediaSoup.isJoined ? 'not-allowed' : 'pointer'
          }}
        >
          {mediaSoup.micEnabled ? "Mute Mic" : "Unmute Mic"}
        </button>

        <button
          onClick={mediaSoup.toggleCam}
          disabled={!mediaSoup.isJoined}
          style={{
            backgroundColor: !mediaSoup.isJoined ? '#ccc' : (mediaSoup.camEnabled ? '#2196F3' : '#FF9800'),
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            cursor: !mediaSoup.isJoined ? 'not-allowed' : 'pointer'
          }}
        >
          {mediaSoup.camEnabled ? "Turn Off Camera" : "Turn On Camera"}
        </button>
      </div>

      {/* Debug information */}
      <div style={{ marginTop: 16, padding: 8, background: '#f5f5f5', fontSize: 12 }}>
        <strong>Debug Info:</strong>
        <br />
        Device ready: {mediaSoup.device ? 'Yes' : 'No'}
        <br />
        Send transport: {mediaSoup.sendTransportRef.current ? 'Ready' : 'Not ready'}
        <br />
        Recv transport: {mediaSoup.recvTransportRef.current ? 'Ready' : 'Not ready'}
        <br />
        Consumed producers: {mediaSoup.consumedProducersRef.current.size}
        <br />
        Active consumers: {mediaSoup.consumersRef.current.size}
        <br />
        Remote streams: {Array.from(mediaSoup.remoteStreams.values()).length}
        <br />
        Participants: {Array.from(mediaSoup.participants).join(', ')}
      </div>
    </div>
  );
}