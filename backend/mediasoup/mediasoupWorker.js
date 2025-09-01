import mediasoup from "mediasoup";

export async function createMediasoupWorker() {
  const worker = await mediasoup.createWorker({
    logLevel: 'warn',
    logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
  });
  console.log("Mediasoup worker created, PID:", worker.pid);

  worker.on("died", (error) => {
    console.error("mediasoup worker died:", error);
    process.exit(1);
  });

  return worker;
}