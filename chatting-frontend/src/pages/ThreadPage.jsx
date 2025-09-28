import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { API } from "../api";
import { io } from "socket.io-client";

const socket = io("http://localhost:5050");

function ThreadPage() {
  const { threadId } = useParams();
  const [searchParams] = useSearchParams();
  const user_id = searchParams.get("user_id");
  const room_id = searchParams.get("room_id");

  const [messages, setMessages] = useState([]);
  const [content, setContent] = useState("");

  const loadMessages = async () => {
    const res = await API.get(`/messages/${threadId}`);
    setMessages(res.data.messages);
  };

  const sendMessage = async () => {
    if (!content) return;
    await API.post("/messages/send", { sender_id: user_id, room_id, thread_id: threadId, content });
    setContent("");
  };

  useEffect(() => {
    loadMessages();
    socket.emit("join_thread", { thread_id: threadId, user_id });

    socket.on("new_message", (data) => {
      setMessages((prev) => [...prev, data.message]);
    });

    return () => socket.off("new_message");
  }, [threadId]);

  return (
    <div style={{ padding: 20 }}>
      <h2>Thread: {threadId}</h2>
      <div style={{ border: "1px solid gray", padding: 10, height: 200, overflowY: "scroll" }}>
        {messages.map((m) => (
          <div key={m.message_id}><b>{m.sender_id}:</b> {m.content}</div>
        ))}
      </div>
      <input value={content} onChange={(e) => setContent(e.target.value)} placeholder="Type message" />
      <button onClick={sendMessage}>Send</button>
    </div>
  );
}

export default ThreadPage;
