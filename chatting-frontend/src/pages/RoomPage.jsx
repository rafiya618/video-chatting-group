import { useEffect, useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { API } from "../api";
import { dummyUser } from "../globals";

function RoomPage() {
  const { roomId } = useParams();
  const [threads, setThreads] = useState([]);
  const [threadName, setThreadName] = useState("");
  const navigate = useNavigate();

  const loadThreads = async () => {
    const res = await API.get(`/threads/${roomId}`);
    setThreads(res.data.threads);
  };

  const createThread = async () => {
    if (!threadName) return;
    await API.post("/threads/create", { room_id: roomId, thread_name: threadName, user_id: dummyUser.user_id });
    setThreadName("");
    loadThreads();
  };

  const deleteThread = async (thread_id) => {
    await API.delete("/threads/delete", { data: { room_id: roomId, thread_id, user_id: dummyUser.user_id } });
    loadThreads();
  };

  useEffect(() => {
    loadThreads();
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Room: {roomId}</h2>
      <input value={threadName} onChange={(e) => setThreadName(e.target.value)} placeholder="Thread name" />
      <button onClick={createThread}>Create Thread</button>
      <ul>
        {threads.map((t) => (
          <li key={t.thread_id}>
            {t.thread_name}{" "}
            <button onClick={() => navigate(`/thread/${t.thread_id}?user_id=${dummyUser.user_id}&room_id=${roomId}`)}>
              Open
            </button>{" "}
            <button onClick={() => deleteThread(t.thread_id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RoomPage;
