import React from 'react';
import { BrowserRouter as Router, Routes, Route, useParams } from 'react-router-dom';
import LobbyScreen from './screens/Lobby';
import Room from './screens/Room';

// Wrapper component to extract params and pass to Room
function RoomWrapper() {
  const { communityId } = useParams();
  return <Room communityId={communityId} />;
}

// App.jsx
function App() {
  return (
    <div className="App">
      <Routes>
        <Route path="/" element={<LobbyScreen />} />
        <Route path="/lobby" element={<LobbyScreen />} />
        <Route path="/room/:communityId" element={<RoomWrapper />} />
      </Routes>
    </div>
  );
}


export default App;