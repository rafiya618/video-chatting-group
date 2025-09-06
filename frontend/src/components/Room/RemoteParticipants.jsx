import React from "react";

export default function RemoteParticipants({ remoteStreams, isJoined }) {
  const remoteStreamArray = Array.from(remoteStreams.values());
  return (
    <div style={{ marginBottom: 16 }}>
      <h4>Remote Participants ({remoteStreamArray.length})</h4>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {remoteStreamArray.map((streamData, i) => (
          <div key={`${streamData.ownerSocketId}-${i}`} style={{ textAlign: "center" }}>
            <video
              ref={(el) => {
                if (el && el.srcObject !== streamData.stream) {
                  el.srcObject = streamData.stream;
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
  );
}