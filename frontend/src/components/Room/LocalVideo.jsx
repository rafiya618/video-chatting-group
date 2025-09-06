import React from "react";

export default function LocalVideo() {
  return (
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
      />
    </div>
  );
}