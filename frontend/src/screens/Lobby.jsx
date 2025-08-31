import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

const LobbyScreen = () => {
  const navigate = useNavigate();

  const [communityId, setCommunityId] = useState("");
  const [userId, setUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  const goRoom = useCallback(() => {
    // Navigate to room with the communityId
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

    console.log("Navigating to room:", communityId, "with userId:", userId, "isAdmin:", isAdmin);
    goRoom();
  };

  return (
    <div style={{ padding: 16, maxWidth: 400, margin: '0 auto' }}>
      <h2>Community Video Call</h2>
      <p>Enter your Community ID and User ID to join the video call.</p>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
          Community ID:
        </label>
        <input
          value={communityId}
          onChange={(e) => setCommunityId(e.target.value)}
          placeholder="e.g., 68a786296dff60f3da16f53e"
          style={{ 
            width: '100%', 
            padding: 8, 
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 14
          }}
        />
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ display: 'block', marginBottom: 4, fontWeight: 'bold' }}>
          User ID:
        </label>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="e.g., 1, 2, 3..."
          style={{ 
            width: '100%', 
            padding: 8, 
            border: '1px solid #ccc',
            borderRadius: 4,
            fontSize: 14
          }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={isAdmin}
            onChange={(e) => setIsAdmin(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          I am an Admin
        </label>
      </div>

      <button 
        onClick={handleJoinRoom}
        disabled={!communityId.trim() || !userId.trim()}
        style={{
          width: '100%',
          padding: 12,
          backgroundColor: (!communityId.trim() || !userId.trim()) ? '#ccc' : '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: 4,
          fontSize: 16,
          cursor: (!communityId.trim() || !userId.trim()) ? 'not-allowed' : 'pointer'
        }}
      >
        {isAdmin ? "Start/Join Call as Admin" : "Join Call"}
      </button>

      <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
        <p><strong>Instructions:</strong></p>
        <ul style={{ paddingLeft: 20 }}>
          <li>Enter a unique Community ID (can be any string)</li>
          <li>Enter your User ID (any number or string)</li>
          <li>Check "I am an Admin" if you're starting the call</li>
          <li>Click the button to join the video call</li>
        </ul>
      </div>
    </div>
  );
};

export default LobbyScreen;