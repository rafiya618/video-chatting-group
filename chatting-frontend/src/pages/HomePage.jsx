import { useNavigate } from "react-router-dom";
import { API } from "../api";
import { dummyUser } from "../globals";

function HomePage() {
  const navigate = useNavigate();

  const joinChat = async () => {
    const res = await API.post("/rooms/join", dummyUser);
    navigate(`/room/${res.data.room_id}?user_id=${dummyUser.user_id}`);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>ByteHive Communities</h1>
      <button onClick={joinChat}>Join Community Chat</button>
    </div>
  );
}

export default HomePage;
