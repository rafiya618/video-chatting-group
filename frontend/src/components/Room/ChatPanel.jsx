import React from "react";

export default function ChatPanel({
  chatMessages,
  chatInput,
  setChatInput,
  sendMessage
}) {
  return (
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
  );
}