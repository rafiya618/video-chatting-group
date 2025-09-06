import { useEffect, useState } from "react";
import socket from "../utils/socket";

export default function useChat(communityId) {
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  useEffect(() => {
    socket.on("call:chat-message", (msg) => {
      setChatMessages((prev) => [...prev, msg]);
    });
    return () => {
      socket.off("call:chat-message");
    };
  }, []);

  const sendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit("call:chat-message", { communityId, message: chatInput });
    setChatInput("");
  };

  return {
    chatMessages,
    chatInput,
    setChatInput,
    sendMessage,
    setChatMessages
  };
}