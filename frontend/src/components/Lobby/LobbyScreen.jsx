import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const LobbyScreen = () => {
  const navigate = useNavigate();

  const [communityId, setCommunityId] = useState("");
  const [userId, setUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const goRoom = useCallback(() => {
    navigate(`/room/${communityId}?userId=${userId}&isAdmin=${isAdmin}`);
  }, [navigate, communityId, userId, isAdmin]);

  const handleJoinRoom = () => {
    if (!communityId.trim()) {
      alert("Please enter a Community ID");
      return;
    }
    if (!userId.trim()) {
      alert("Please enter a User ID");
      return;
    }
    goRoom();
  };

  return (
    <div style={{ padding: 16, maxWidth: 400, margin: '0 auto' }}>
      <h2>Community Video Call</h2>
      <p>Enter your Community ID and User ID to join the video call.</p>
      {/* ...rest unchanged... */}
    </div>
  );
};

export default LobbyScreen;