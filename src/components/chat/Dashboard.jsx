import { useEffect } from "react";

function App() {
  useEffect(() => {
    console.log("🚀 VITE_API_URL =", import.meta.env.VITE_API_URL);
    console.log("🌐 VITE_SOCKET_URL =", import.meta.env.VITE_SOCKET_URL);
  }, []);

  return (
    <div>
      <h1>Chat App</h1>
      <p>Check your browser console to see env variable values.</p>
    </div>
  );
}

export default App;
