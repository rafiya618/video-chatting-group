import io from "socket.io-client";

// Singleton socket for the app
const socket = io("http://localhost:8000");

export default socket;